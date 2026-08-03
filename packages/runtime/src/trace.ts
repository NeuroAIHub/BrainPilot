/**
 * TraceGraphV2 — canonical Graph of Trace storage.
 *
 * Nodes own their causal parent references. The legacy dependency collection
 * is a compatibility projection only and is never persisted by new writes.
 * `getGraph()` still materializes the old shape for older clients.
 */
import { appendFile, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname } from "node:path";
import type {
  AuditReport,
  TraceArtifact,
  TraceArtifactV2,
  TraceCheckpointRef,
  TraceChange,
  TraceCausalParent,
  TraceDependency,
  TraceDependencyEvidence,
  TraceDependencyOrigin,
  TraceDependencyState,
  TraceEpisode,
  TraceGraph,
  TraceDocumentV2,
  TraceGraphV2,
  TraceNode,
  TraceNodeConfidence,
  TraceNodeRecord,
  TraceNodeReviewConclusion,
  TraceNodeV2,
  TraceDeltaV2,
} from "@brainpilot/protocol";
interface CheckpointFileProvenance {
  path: string;
  previousPath?: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions?: number;
  deletions?: number;
  binary: boolean;
  baseBlobId?: string;
  resultBlobId?: string;
}
function now(): string {
  return new Date().toISOString();
}

function stableId(prefix: string, ...parts: Array<string | undefined>): string {
  const hash = createHash("sha256").update(parts.map((part) => part ?? "").join("\u0000")).digest("hex").slice(0, 20);
  return `${prefix}_${hash}`;
}

function clone<T>(value: T): T {
  // Trace records are JSON-only by design. JSON cloning makes returned views
  // safe for HTTP consumers without leaking mutable Map values.
  return JSON.parse(JSON.stringify(value)) as T;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function evidenceKey(evidence: TraceDependencyEvidence): string {
  return JSON.stringify([
    evidence.source,
    evidence.kind,
    evidence.detail ?? "",
    evidence.artifactId ?? "",
    evidence.reportId ?? "",
    evidence.path ?? "",
    evidence.checkpointId ?? "",
    evidence.baseBlobId ?? "",
    evidence.resultBlobId ?? "",
    evidence.deterministic ?? false,
  ]);
}

function isDeterministicHostEvidence(evidence: readonly TraceDependencyEvidence[]): boolean {
  return evidence.some((item) =>
    item.deterministic === true ||
    item.kind === "artifact_producer_consumer" ||
    item.kind === "delegation",
  );
}

/** Legacy callback operation retained for older hosting code and tests. */
export type TraceChangeOp = "created" | "updated";

export interface TraceDependencyInput {
  prerequisiteId: string;
  dependentId: string;
  reason?: string;
  origin?: TraceDependencyOrigin;
  evidence?: TraceDependencyEvidence[];
}

export interface TraceArtifactInput {
  id?: string;
  path: string;
  kind?: string;
  type?: string;
  producerNodeId?: string | null;
  checkpointId?: string;
  checkpoint?: TraceCheckpointRef;
  blobHash?: string;
  changeStatus?: "added" | "modified" | "deleted" | "renamed";
  previousPath?: string;
  exists?: "unknown" | "present" | "missing";
  verificationStatus?: "unverified" | "reserved" | "verified" | "missing";
  role?: "input" | "output" | "checkpoint" | "reference";
  createdAt?: string;
  updatedAt?: string;
  /** Used only by V1 normalization so an absent historical time stays absent. */
  preserveUnknownTimestamps?: boolean;
}

export interface TraceNodeDetail {
  node: TraceNodeV2;
  dependencies: { incoming: TraceDependency[]; outgoing: TraceDependency[] };
  episode?: TraceEpisode;
  artifacts: TraceArtifactV2[];
}

export interface TraceChangeActor {
  type: "user" | "agent" | "host";
  name?: string;
}

export interface TraceAuditTarget {
  nodeId: string;
  parentNodeId?: string;
  fingerprint: string;
}

type TraceChangeDraft = Omit<TraceChange, "id" | "revision" | "createdAt">;

/**
 * Canonical V2 storage with a deliberately narrow mutation surface.
 *
 * A Trace dependency starts proposed/low. It can only become active/high by a
 * user decision, an explicit direct declaration, or deterministic Host
 * evidence. Trace-generated repetition never raises confidence; independent
 * non-Trace reports may only raise it to medium.
 */
export class GraphOfTrace {
  private readonly nodes = new Map<string, TraceNodeV2>();
  private readonly dependencies = new Map<string, TraceDependency>();
  private readonly episodes = new Map<string, TraceEpisode>();
  private readonly artifacts = new Map<string, TraceArtifactV2>();
  private readonly changes: TraceChange[] = [];
  /** Journal tail embedded in trace.json until its JSONL append is durable. */
  private pendingChanges: TraceChange[] = [];
  private meta: TraceGraphV2["meta"];
  private revision = 0;
  private writeChain: Promise<void> = Promise.resolve();
  /** Id of the most recently created node — only a presentation-chain helper. */
  private lastNodeId: string | undefined;
  /** True only after V1 was loaded; controls one-time backup on first mutation. */
  private loadedV1 = false;
  private wroteV2AfterV1 = false;

  /**
   * @param onChange legacy V1 projection event. Kept during the transition.
   * @param onDelta canonical V2 snapshot event. The manager emits it as
   * `CUSTOM:trace_delta`; snapshot events favor correctness during rollout.
   */
  constructor(
    readonly sessionId: string,
    private readonly persistPath?: string,
    private readonly onChange?: (op: TraceChangeOp, node: TraceNode) => void,
    private readonly onDelta?: (delta: TraceDeltaV2) => void,
  ) {
    this.meta = { sessionId, createdAt: now() };
    this.ensureSessionRoot();
  }

  createNode(input: {
    title: string;
    type?: string;
    status?: string;
    agent?: string;
    description?: string;
    summary?: string;
    content?: string;
    reason?: string;
    context?: string;
    parents?: Array<{ id: string; relation?: string; explanation?: string }>;
    artifacts?: Array<{ path: string; type?: string }>;
    artifactInputs?: TraceArtifactInput[];
    artifactOutputs?: TraceArtifactInput[];
    metadata?: Record<string, unknown>;
    checkpoints?: TraceCheckpointRef[];
    id?: string;
    primaryEpisodeId?: string;
    episodeTags?: string[];
    records?: TraceNodeRecord[];
    causalParents?: TraceCausalParent[];
    executionResult?: "completed" | "failed";
    revoked?: boolean;
    reviewConclusion?: TraceNodeReviewConclusion;
    reviewReason?: string;
    confidence?: TraceNodeConfidence;
    confidenceReason?: string;
    changeActor?: TraceChangeActor;
  }): TraceNode {
    this.ensureSessionRoot();
    const id = input.id ?? `node_${randomUUID()}`;
    if (this.nodes.has(id)) throw new Error(`trace node already exists: ${id}`);
    const createdAt = now();
    const report = input.summary !== undefined || input.content !== undefined
      ? { kind: "agent_report" as const, summary: input.summary, content: input.content, author: input.agent }
      : undefined;
    const node: TraceNodeV2 = {
      id,
      title: input.title,
      type: input.type ?? "task",
      status: input.status ?? input.executionResult ?? "completed",
      agent: input.agent,
      description: input.description,
      reason: input.reason,
      context: input.context,
      ...(report ? { report } : {}),
      createdAt,
      updatedAt: createdAt,
      toolCalls: [],
      artifactIds: [],
      ...(input.primaryEpisodeId ? { primaryEpisodeId: input.primaryEpisodeId } : {}),
      ...(input.episodeTags?.length ? { episodeTags: unique(input.episodeTags) } : { episodeTags: [] }),
      ...(input.metadata ? { metadata: clone(input.metadata) } : {}),
      records: clone(input.records ?? []),
      parents: clone(input.causalParents ?? []),
      executionResult: input.executionResult ?? (input.status === "error" || input.status === "failed" ? "failed" : "completed"),
      revoked: input.revoked ?? false,
      ...(input.confidence ? { confidence: input.confidence } : {}),
      ...(input.confidenceReason ? { confidenceReason: input.confidenceReason } : {}),
      reviewConclusion: input.reviewConclusion ?? "unreviewed",
      ...(input.reviewReason ? { reviewReason: input.reviewReason } : {}),
    };
    this.nodes.set(id, node);

    for (const artifact of input.artifacts ?? []) {
      this.registerArtifactInternal(id, { path: artifact.path, type: artifact.type, kind: artifact.type ?? "file", role: "output" });
    }
    for (const artifact of input.artifactOutputs ?? []) {
      this.registerArtifactInternal(id, { ...artifact, role: "output" });
    }
    for (const artifact of input.artifactInputs ?? []) {
      this.attachArtifactInputInternal(id, artifact);
    }
    for (const checkpoint of input.checkpoints ?? []) {
      this.registerArtifactInternal(id, {
        path: `checkpoint:${checkpoint.id}`,
        kind: "checkpoint",
        type: "checkpoint",
        checkpointId: checkpoint.id,
        checkpoint,
        exists: checkpoint.status === "ready" || checkpoint.status === "partial" ? "present" : "unknown",
        verificationStatus: "reserved",
        role: "checkpoint",
      });
    }
    for (const parent of input.parents ?? []) {
      this.addLegacyRelationInternal(parent.id, id, parent.relation, parent.explanation, "trace");
    }
    this.normalizeCausalGraph();
    this.lastNodeId = id;
    this.commit("created", id, {
      actor: input.changeActor ?? { type: "host" },
      action: "node_created",
      target: { nodeId: id },
      after: {
        title: node.title,
        executionResult: node.executionResult,
        confidence: node.confidence,
        confidenceReason: node.confidenceReason,
      },
    });
    return this.getNode(id)!;
  }

  /** Creates the next presentation milestone without manufacturing causality. */
  createChainedNode(input: {
    title: string;
    type?: string;
    status?: string;
    agent?: string;
    description?: string;
    metadata?: Record<string, unknown>;
  }): TraceNode {
    return this.createNode({
      title: input.title,
      type: input.type ?? "milestone",
      status: input.status ?? "completed",
      agent: input.agent,
      description: input.description,
      metadata: { auto: true, ...input.metadata },
    });
  }

  /**
   * Legacy-shaped update. Parent/child fields are intentionally ignored: they
   * are derived from the canonical relation collections at read time.
   */
  updateNode(id: string, updates: Partial<TraceNode>, actor: TraceChangeActor = { type: "host" }): TraceNode | undefined {
    const node = this.nodes.get(id);
    if (!node || this.isSessionRoot(id)) return undefined;
    const patch = updates as Record<string, unknown>;
    const before = {
      confidence: node.confidence,
      confidenceReason: node.confidenceReason,
      reviewConclusion: node.reviewConclusion,
    };
    for (const key of ["title", "type", "status", "agent", "description", "reason", "context", "durationMs", "errorMessage", "timestamp"]) {
      if (patch[key] !== undefined) (node as Record<string, unknown>)[key] = clone(patch[key]);
    }
    if (Array.isArray(patch.toolCalls)) node.toolCalls = asStringArray(patch.toolCalls);
    if (patch.metadata && typeof patch.metadata === "object") node.metadata = clone(patch.metadata as Record<string, unknown>);
    if (patch.executionResult === "completed" || patch.executionResult === "failed") {
      node.executionResult = patch.executionResult;
      node.status = patch.executionResult;
    }
    if (typeof patch.revoked === "boolean") node.revoked = patch.revoked;
    if (patch.confidence === "low" || patch.confidence === "medium" || patch.confidence === "high") {
      node.confidence = patch.confidence;
    }
    if (typeof patch.confidenceReason === "string") node.confidenceReason = patch.confidenceReason;
    if (patch.reviewConclusion === "unreviewed" || patch.reviewConclusion === "approved" || patch.reviewConclusion === "rejected" || patch.reviewConclusion === "uncertain") {
      node.reviewConclusion = patch.reviewConclusion;
    }
    if (typeof patch.reviewReason === "string") node.reviewReason = patch.reviewReason;
    if (patch.summary !== undefined || patch.content !== undefined) {
      node.report = {
        kind: "agent_report",
        summary: patch.summary !== undefined ? asString(patch.summary) : node.report?.summary,
        content: patch.content !== undefined ? asString(patch.content) : node.report?.content,
        author: node.agent,
      };
    }
    if (Array.isArray(patch.artifacts)) {
      for (const raw of patch.artifacts) {
        const artifact = asRecord(raw);
        const path = asString(artifact.path);
        if (path) this.registerArtifactInternal(id, { path, type: asString(artifact.type) || undefined, kind: asString(artifact.type, "file"), role: "output" });
      }
    }
    if (Array.isArray(patch.checkpoints)) {
      for (const raw of patch.checkpoints) {
        const checkpoint = raw as TraceCheckpointRef;
        if (checkpoint?.id) {
          this.registerArtifactInternal(id, {
            path: `checkpoint:${checkpoint.id}`,
            kind: "checkpoint",
            type: "checkpoint",
            checkpointId: checkpoint.id,
            checkpoint,
            role: "checkpoint",
          });
        }
      }
    }
    // Any substantive Trace edit invalidates the previous independent review.
    // Its old conclusion/reason remain available in trace-changes.jsonl.
    if (actor.type === "agent" && actor.name === "trace") {
      node.reviewConclusion = "unreviewed";
      delete node.reviewReason;
    }
    this.normalizeCausalGraph();
    node.updatedAt = now();
    this.commit("updated", id, {
      actor,
      action: "node_updated",
      target: { nodeId: id },
      before,
      after: clone(updates),
      ...(node.confidenceReason ? { reason: node.confidenceReason } : {}),
    });
    return this.getNode(id);
  }

  appendRecord(id: string, record: TraceNodeRecord, actor: TraceChangeActor): TraceNode | undefined {
    const node = this.nodes.get(id);
    if (!node || node.revoked || this.isSessionRoot(id)) return undefined;
    const duplicate = node.records.some((item) =>
      item.sourceAgent === record.sourceAgent &&
      item.createdAt === record.createdAt &&
      item.description === record.description,
    );
    if (!duplicate) node.records.push(clone(record));
    node.updatedAt = now();
    this.commit("updated", id, {
      actor,
      action: "record_attached",
      target: { nodeId: id },
      after: { sourceAgent: record.sourceAgent, checkpointId: record.checkpointId },
    });
    return this.getNode(id);
  }

  proposeCausalParent(childNodeId: string, parentNodeId: string, reason: string, actor: TraceChangeActor): boolean {
    const child = this.nodes.get(childNodeId);
    const parent = this.nodes.get(parentNodeId);
    if (!child || !parent || child.revoked || parent.revoked || this.isSessionRoot(childNodeId) || this.isSessionRoot(parentNodeId) || childNodeId === parentNodeId) return false;
    const existing = child.parents.find((item) => item.nodeId === parentNodeId);
    if (existing?.conclusion === "rejected") return false;
    if (!existing && this.wouldCreateCycle(parentNodeId, childNodeId)) return false;
    const before = existing ? clone(existing) : undefined;
    if (existing) {
      if (existing.conclusion === "confirmed" && existing.reason === reason) return true;
      existing.conclusion = "candidate";
      existing.reason = reason;
    } else {
      child.parents.push({ nodeId: parentNodeId, conclusion: "candidate", ...(reason ? { reason } : {}) });
    }
    this.syncCompatibilityDependency(parentNodeId, childNodeId, "candidate", reason);
    child.updatedAt = now();
    this.commit("updated", childNodeId, {
      actor,
      action: "parent_proposed",
      target: { nodeId: childNodeId, parentNodeId },
      before,
      after: { conclusion: "candidate" },
      reason,
    });
    return true;
  }

  review(
    nodeId: string,
    conclusion: "approve" | "reject" | "uncertain",
    reason: string,
    actor: TraceChangeActor,
    parentNodeId?: string,
    expectedFingerprint?: string,
  ): boolean {
    const node = this.nodes.get(nodeId);
    if (!node || node.revoked || this.isSessionRoot(nodeId)) return false;
    if (expectedFingerprint && this.auditFingerprint(nodeId, parentNodeId) !== expectedFingerprint) return false;
    if (!parentNodeId) {
      const before = node.reviewConclusion;
      node.reviewConclusion = conclusion === "approve" ? "approved" : conclusion === "reject" ? "rejected" : "uncertain";
      node.reviewReason = reason;
      node.updatedAt = now();
      this.commit("updated", nodeId, {
        actor,
        action: "node_reviewed",
        target: { nodeId },
        before,
        after: node.reviewConclusion,
        reason,
      });
      return true;
    }
    if (this.isSessionRoot(parentNodeId)) return false;
    const parent = this.nodes.get(parentNodeId);
    const ref = node.parents.find((item) => item.nodeId === parentNodeId);
    if (!parent || parent.revoked || !ref) return false;
    if (conclusion === "approve" && parent.reviewConclusion === "rejected") return false;
    const before = ref.conclusion;
    ref.conclusion = conclusion === "approve" ? "confirmed" : conclusion === "reject" ? "rejected" : "uncertain";
    ref.reason = reason;
    this.normalizeCausalGraph();
    node.updatedAt = now();
    this.commit("updated", nodeId, {
      actor,
      action: "parent_reviewed",
      target: { nodeId, parentNodeId },
      before,
      after: ref.conclusion,
      reason,
    });
    return true;
  }

  listPendingAuditTargets(nodeIds?: Iterable<string>): TraceAuditTarget[] {
    const selected = nodeIds ? new Set(nodeIds) : undefined;
    const targets: TraceAuditTarget[] = [];
    for (const node of this.nodes.values()) {
      if (node.revoked || this.isSessionRoot(node.id) || (selected && !selected.has(node.id))) continue;
      if (node.reviewConclusion === "unreviewed") {
        targets.push({ nodeId: node.id, fingerprint: this.auditFingerprint(node.id)! });
      }
      for (const parent of node.parents) {
        if (parent.conclusion !== "candidate") continue;
        const fingerprint = this.auditFingerprint(node.id, parent.nodeId);
        if (fingerprint) targets.push({ nodeId: node.id, parentNodeId: parent.nodeId, fingerprint });
      }
    }
    return targets;
  }

  auditFingerprint(nodeId: string, parentNodeId?: string): string | undefined {
    const node = this.nodes.get(nodeId);
    if (!node || node.revoked) return undefined;
    const payload = parentNodeId
      ? {
          child: this.auditNodeEvidence(node),
          parent: this.nodes.get(parentNodeId) ? this.auditNodeEvidence(this.nodes.get(parentNodeId)!) : undefined,
          relation: node.parents.find((parent) => parent.nodeId === parentNodeId),
        }
      : this.auditNodeEvidence(node);
    return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  }

  attachCheckpoint(id: string, checkpoint: TraceCheckpointRef, files: CheckpointFileProvenance[] = []): TraceNode | undefined {
    if (!this.nodes.has(id)) return undefined;
    this.registerArtifactInternal(id, {
      path: `checkpoint:${checkpoint.id}`,
      kind: "checkpoint",
      type: "checkpoint",
      checkpointId: checkpoint.id,
      checkpoint,
      exists: checkpoint.status === "ready" || checkpoint.status === "partial" ? "present" : "unknown",
      verificationStatus: "reserved",
      role: "checkpoint",
    });
    this.attachCheckpointFilesInternal(id, checkpoint, files);
    this.nodes.get(id)!.updatedAt = now();
    this.commit("updated", id);
    return this.getNode(id);
  }

  getCausalRollbackPlan(targetNodeId: string): { affectedNodeIds: string[]; checkpointIds: string[] } | undefined {
    if (!this.nodes.has(targetNodeId) || this.nodes.get(targetNodeId)?.revoked || this.isSessionRoot(targetNodeId)) return undefined;
    const visited = new Set<string>([targetNodeId]);
    const queue = [targetNodeId];
    const affected: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const children = [...this.nodes.values()]
        .filter((node) => !node.revoked && node.parents.some((parent) => parent.nodeId === current && parent.conclusion === "confirmed"))
        .map((node) => node.id);
      for (const child of children) {
        if (visited.has(child)) continue;
        visited.add(child);
        queue.push(child);
        affected.push(child);
      }
    }
    const checkpointIds = unique(affected.flatMap((nodeId) => this.nodes.get(nodeId)?.artifactIds.flatMap((artifactId) => {
      const id = this.artifacts.get(artifactId)?.checkpointId;
      return id ? [id] : [];
    }) ?? []));
    return { affectedNodeIds: affected, checkpointIds };
  }

  markNodesRolledBack(nodeIds: string[], targetNodeId: string): void {
    for (const id of nodeIds) {
      const node = this.nodes.get(id);
      if (!node || this.isSessionRoot(id)) continue;
      node.revoked = true;
      this.normalizeCausalGraph();
      node.updatedAt = now();
      this.commit("updated", id, {
        actor: { type: "user" }, action: "node_revoked", target: { nodeId: id },
        before: false, after: true, reason: `Causal rollback to ${targetNodeId}`,
      });
    }
  }

  /** Register an artifact and attach it to a node. IDs are stable across V1 migration. */
  registerArtifact(nodeId: string, input: TraceArtifactInput): TraceArtifactV2 | undefined {
    if (!this.nodes.has(nodeId) || !input.path) return undefined;
    const artifact = this.registerArtifactInternal(nodeId, input);
    this.nodes.get(nodeId)!.updatedAt = now();
    this.commit("updated", nodeId);
    return clone(artifact);
  }

  /** Attach an existing artifact to a consumer and infer a deterministic Host edge. */
  referenceArtifact(nodeId: string, artifactId: string, role: "input" | "reference" = "input"): boolean {
    const node = this.nodes.get(nodeId);
    const artifact = this.artifacts.get(artifactId);
    if (!node || !artifact) return false;
    node.artifactIds = unique([...node.artifactIds, artifactId]);
    node.updatedAt = now();
    if (!artifact.role) artifact.role = role;
    this.commit("updated", nodeId);
    return true;
  }

  /** Register/reference an input artifact and infer producer -> consumer only from Host evidence. */
  attachArtifactInput(nodeId: string, input: TraceArtifactInput): TraceArtifactV2 | undefined {
    if (!this.nodes.has(nodeId) || !input.path) return undefined;
    const artifact = this.attachArtifactInputInternal(nodeId, input);
    this.nodes.get(nodeId)!.updatedAt = now();
    this.commit("updated", nodeId);
    return clone(artifact);
  }

  /**
   * Trace-facing dependency proposal. Returns false for missing nodes, cycles,
   * and rejected tombstones. The method never uses timestamps to alter edges.
   */
  proposeDependency(input: TraceDependencyInput): { ok: boolean; dependency?: TraceDependency; reason?: string; error?: string } {
    const result = this.proposeDependencyInternal(input);
    if (!result.ok) return { ...result, error: result.reason };
    this.normalizeCausalGraph();
    this.commit("updated", input.dependentId);
    return { ok: true, dependency: clone(result.dependency!) };
  }

  /** User decision endpoint: accepted -> active/high; rejected is a tombstone. */
  decideDependency(id: string, decision: "accept" | "reject", reason?: string): TraceDependency | undefined {
    const dependency = this.dependencies.get(id);
    if (!dependency || this.isSessionRoot(dependency.prerequisiteId) || this.isSessionRoot(dependency.dependentId)) return undefined;
    dependency.state = decision === "accept" ? "active" : "rejected";
    dependency.confidence = decision === "accept" ? "high" : dependency.confidence;
    dependency.evidence = this.mergeEvidence(dependency.evidence, [{
      source: "user",
      kind: decision === "accept" ? "accepted" : "rejected",
      detail: reason,
      deterministic: true,
    }]);
    if (reason) dependency.reason = reason;
    dependency.updatedAt = now();
    const child = this.nodes.get(dependency.dependentId);
    const parentRef = child?.parents.find((parent) => parent.nodeId === dependency.prerequisiteId);
    if (parentRef) {
      parentRef.conclusion = decision === "accept" ? "confirmed" : "rejected";
      if (reason) parentRef.reason = reason;
    }
    this.normalizeCausalGraph();
    this.commit("updated", dependency.dependentId, {
      actor: { type: "user" },
      action: "parent_reviewed",
      target: { nodeId: dependency.dependentId, parentNodeId: dependency.prerequisiteId },
      after: dependency.state === "active" ? "confirmed" : "rejected",
      reason,
    });
    return clone(dependency);
  }

  /** Compatibility wrapper for V1 callers. `depends_on` now stays proposed. */
  addRelation(fromId: string, toId: string, explanation: string, relation = "depends_on"): boolean {
    if (!this.nodes.has(fromId) || !this.nodes.has(toId)) return false;
    if (relation === "depends_on") {
      return this.proposeDependency({
        prerequisiteId: fromId,
        dependentId: toId,
        reason: explanation,
        origin: "trace",
        evidence: [{ source: "trace", kind: "trace_inference", detail: explanation }],
      }).ok;
    }
    if (relation === "delegated") {
      return this.proposeDependency({
        prerequisiteId: fromId,
        dependentId: toId,
        reason: explanation,
        origin: "host",
        evidence: [{ source: "host", kind: "delegation", detail: explanation, deterministic: true }],
      }).ok;
    }
    if (relation === "necessitated_by" || relation === "used") {
      return this.proposeDependency({
        prerequisiteId: fromId,
        dependentId: toId,
        reason: explanation,
        origin: "legacy",
        evidence: [{ source: "legacy", kind: relation, detail: explanation }],
      }).ok;
    }
    return false;
  }

  createEpisode(input: { title: string; description?: string; id?: string }): TraceEpisode {
    const id = input.id ?? `episode_${randomUUID()}`;
    const stamp = now();
    const episode: TraceEpisode = { id, title: input.title, ...(input.description ? { description: input.description } : {}), createdAt: stamp, updatedAt: stamp };
    this.episodes.set(id, episode);
    this.commit("updated");
    return clone(episode);
  }

  renameEpisode(id: string, title: string, description?: string): TraceEpisode | undefined {
    const episode = this.episodes.get(id);
    if (!episode) return undefined;
    episode.title = title;
    if (description !== undefined) episode.description = description;
    episode.updatedAt = now();
    this.commit("updated");
    return clone(episode);
  }

  assignEpisode(nodeId: string, episodeId?: string, tags?: string[]): TraceNode | undefined {
    const node = this.nodes.get(nodeId);
    if (!node || (episodeId && !this.episodes.has(episodeId))) return undefined;
    node.primaryEpisodeId = episodeId;
    node.episodeTags = unique(tags ?? node.episodeTags);
    node.updatedAt = now();
    this.commit("updated", nodeId);
    return this.getNode(nodeId);
  }

  mergeEpisodes(targetId: string, sourceIds: string[]): TraceEpisode | undefined {
    const target = this.episodes.get(targetId);
    if (!target) return undefined;
    const sources = unique(sourceIds).filter((id) => id !== targetId && this.episodes.has(id));
    for (const node of this.nodes.values()) {
      if (node.primaryEpisodeId && sources.includes(node.primaryEpisodeId)) node.primaryEpisodeId = targetId;
      node.episodeTags = unique(node.episodeTags.map((tag) => sources.includes(tag) ? targetId : tag));
    }
    for (const id of sources) this.episodes.delete(id);
    target.updatedAt = now();
    this.commit("updated");
    return clone(target);
  }

  /** Split is a presentation-only reassignment; it cannot touch dependencies. */
  splitEpisode(sourceId: string, splits: Array<{ title: string; nodeIds: string[] }>): TraceEpisode[] | undefined {
    if (!this.episodes.has(sourceId) || splits.length === 0) return undefined;
    const created = splits.map((split) => this.createEpisode({ title: split.title }));
    const reassigned = new Map<string, string>();
    for (let index = 0; index < splits.length; index++) {
      for (const nodeId of unique(splits[index]!.nodeIds)) {
        const node = this.nodes.get(nodeId);
        if (node?.primaryEpisodeId === sourceId) node.primaryEpisodeId = created[index]!.id;
        if (node) reassigned.set(nodeId, created[index]!.id);
      }
    }
    for (const node of this.nodes.values()) {
      const replacement = reassigned.get(node.id);
      if (node.primaryEpisodeId === sourceId) node.primaryEpisodeId = replacement;
      node.episodeTags = unique(node.episodeTags.flatMap((tag) => {
        if (tag !== sourceId) return [tag];
        return replacement ? [replacement] : [];
      }));
    }
    this.episodes.delete(sourceId);
    this.commit("updated");
    return created;
  }

  getNode(id: string): TraceNode | undefined {
    const node = this.nodes.get(id);
    return node ? this.materializeNode(node) : undefined;
  }

  getNodeV2(id: string): TraceNodeV2 | undefined {
    const node = this.nodes.get(id);
    return node ? clone(node) : undefined;
  }

  getNodeDetail(id: string, includeRevoked = false): TraceNodeDetail | undefined {
    const node = this.nodes.get(id);
    if (!node || (!includeRevoked && node.revoked)) return undefined;
    const incoming = [...this.dependencies.values()].filter((edge) => edge.dependentId === id);
    const outgoing = [...this.dependencies.values()].filter((edge) => edge.prerequisiteId === id);
    return {
      node: clone(node),
      dependencies: { incoming: clone(incoming), outgoing: clone(outgoing) },
      ...(node.primaryEpisodeId && this.episodes.get(node.primaryEpisodeId)
        ? { episode: clone(this.episodes.get(node.primaryEpisodeId)!) }
        : {}),
      artifacts: clone(node.artifactIds.map((artifactId) => this.artifacts.get(artifactId)).filter((item): item is TraceArtifactV2 => Boolean(item))),
    };
  }

  getNeighborhood(id: string, depth = 1): { nodes: TraceNodeV2[]; dependencies: TraceDependency[] } | undefined {
    if (!this.nodes.has(id) || this.nodes.get(id)?.revoked) return undefined;
    const requestedDepth = Math.max(0, Math.min(4, Math.trunc(depth)));
    const seen = new Set<string>([id]);
    let frontier = [id];
    for (let level = 0; level < requestedDepth; level++) {
      const frontierSet = new Set(frontier);
      const next = new Set<string>();
      for (const edge of this.dependencies.values()) {
        const from = edge.prerequisiteId;
        const to = edge.dependentId;
        if (frontierSet.has(from) && !seen.has(to)) next.add(to);
        if (frontierSet.has(to) && !seen.has(from)) next.add(from);
      }
      frontier = [...next];
      for (const nextId of frontier) seen.add(nextId);
    }
    const included = (nodeId: string) => seen.has(nodeId);
    return {
      nodes: clone([...this.nodes.values()].filter((node) => seen.has(node.id) && !node.revoked)),
      dependencies: clone([...this.dependencies.values()].filter((edge) => included(edge.prerequisiteId) && included(edge.dependentId) && !this.nodes.get(edge.prerequisiteId)?.revoked && !this.nodes.get(edge.dependentId)?.revoked)),
    };
  }

  search(query: string, limit = 20): TraceNodeV2[] {
    const needle = query.trim().toLocaleLowerCase();
    const max = Math.max(1, Math.min(50, Math.trunc(limit)));
    const results = [...this.nodes.values()].filter((node) => {
      if (node.revoked || this.isSessionRoot(node.id)) return false;
      if (!needle) return true;
      const text = [node.title, node.description, node.reason, node.context, node.report?.summary, node.report?.content]
        .filter(Boolean).join("\n").toLocaleLowerCase();
      return text.includes(needle);
    });
    return clone(results.slice(0, max));
  }

  getLastNodeId(): string | undefined {
    return this.lastNodeId;
  }

  /** Backwards-compatible materialized view. Never persisted as V2. */
  getGraph(): TraceGraph {
    return {
      schemaVersion: "2.0",
      revision: this.revision,
      meta: clone(this.meta),
      nodes: [...this.nodes.values()].map((node) => this.materializeNode(node)),
      dependencies: clone([...this.dependencies.values()]),
      episodes: clone([...this.episodes.values()]),
      artifacts: clone([...this.artifacts.values()]),
    };
  }

  getActiveGraph(): TraceGraph {
    const activeIds = new Set([...this.nodes.values()].filter((node) => !node.revoked).map((node) => node.id));
    const graph = this.getGraph();
    return {
      ...graph,
      nodes: graph.nodes.filter((node) => activeIds.has(node.id)).map((node) => ({
        ...node,
        parents: node.parents.filter((parent) => activeIds.has(parent.id)),
        parentIds: node.parentIds.filter((id) => activeIds.has(id)),
        childIds: node.childIds.filter((id) => activeIds.has(id)),
      })),
      dependencies: graph.dependencies?.filter((edge) => activeIds.has(edge.prerequisiteId) && activeIds.has(edge.dependentId)),
      artifacts: graph.artifacts?.filter((artifact) => !artifact.producerNodeId || activeIds.has(artifact.producerNodeId)),
    };
  }

  /** Persisted V2 data. Node.parents is the causal source of truth; the legacy
   * dependency collection remains only as a compatibility projection. */
  getGraphV2(): TraceGraphV2 {
    return {
      schemaVersion: "2.0",
      revision: this.revision,
      meta: clone(this.meta),
      nodes: clone([...this.nodes.values()]),
      dependencies: clone([...this.dependencies.values()]),
      episodes: clone([...this.episodes.values()]),
      artifacts: clone([...this.artifacts.values()]),
    };
  }

  /** Disk shape: embedded parents are canonical; legacy edge collections stay out. */
  private getPersistedGraph(pendingChanges: TraceChange[] = []): TraceDocumentV2 {
    const { dependencies: _dependencies, ...canonical } = this.getGraphV2();
    return {
      ...canonical,
      ...(pendingChanges.length ? { pendingChanges: clone(pendingChanges) } : {}),
    };
  }

  getChanges(limit = 200): TraceChange[] {
    const max = Math.max(1, Math.min(2_000, Math.trunc(limit)));
    return clone(this.changes.slice(-max));
  }

  async recoverChanges(): Promise<void> {
    const path = this.changeLogPath();
    if (!path) return;
    let raw = "";
    try {
      raw = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return;
      await mkdir(dirname(path), { recursive: true }).catch(() => {});
    }

    this.changes.length = 0;
    const ids = new Set<string>();
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const value = JSON.parse(line) as TraceChange;
        if (value?.id && typeof value.revision === "number" && !ids.has(value.id)) {
          ids.add(value.id);
          this.changes.push(value);
        }
      } catch {
        // JSONL is intentionally record-oriented: preserve valid entries
        // before and after a torn/corrupt append.
      }
    }
    for (const change of this.pendingChanges) {
      if (!ids.has(change.id)) {
        try {
          await appendFile(path, `${JSON.stringify(change)}\n`, "utf8");
          ids.add(change.id);
        } catch {
          // Keep this and every later record embedded in trace.json. A future
          // mutation or restart can retry without losing the audit trail.
          break;
        }
      }
      if (!this.changes.some((item) => item.id === change.id)) this.changes.push(clone(change));
    }
    const remaining = this.pendingChanges.filter((change) => !ids.has(change.id));
    if (remaining.length !== this.pendingChanges.length && this.persistPath) {
      this.pendingChanges = remaining;
      await this.writeSnapshot(this.getPersistedGraph(this.pendingChanges)).catch(() => {});
    }
  }

  recordChange(draft: TraceChangeDraft): TraceChange {
    this.revision++;
    const change: TraceChange = {
      id: `change_${randomUUID()}`,
      revision: this.revision,
      createdAt: now(),
      ...clone(draft),
    };
    this.changes.push(change);
    this.persist(change);
    this.onDelta?.({ schemaVersion: "2.0", revision: this.revision, op: "snapshot", graph: this.getGraphV2() });
    return clone(change);
  }

  submitAuditReport(input: Omit<AuditReport, "id" | "createdAt" | "sharedWithPiAt">): AuditReport {
    const report: AuditReport = {
      id: `audit_${randomUUID()}`,
      ...clone(input),
      createdAt: now(),
    };
    this.recordChange({
      actor: { type: "agent", name: "auditor" },
      action: "audit_report_submitted",
      target: report.target ?? {},
      reason: report.summary,
      metadata: { auditReport: report },
    });
    return clone(report);
  }

  getAuditReports(): AuditReport[] {
    const reports = new Map<string, AuditReport>();
    const shared = new Map<string, string>();
    for (const change of this.changes) {
      if (change.action === "audit_report_submitted") {
        const raw = change.metadata?.auditReport;
        if (!raw || typeof raw !== "object") continue;
        const report = raw as AuditReport;
        if (typeof report.id === "string" && typeof report.summary === "string" && typeof report.report === "string") {
          reports.set(report.id, clone(report));
        }
      } else if (change.action === "audit_report_shared_with_pi") {
        const reportId = change.metadata?.auditReportId;
        if (typeof reportId === "string") shared.set(reportId, change.createdAt);
      }
    }
    return [...reports.values()].map((report) => ({
      ...report,
      ...(shared.has(report.id) ? { sharedWithPiAt: shared.get(report.id)! } : {}),
    }));
  }

  /**
   * Loads V1 without writing. A pure read/restore never migrates the file. The
   * first V2 mutation later makes `trace.v1.json.bak` and atomically replaces
   * trace.json with the canonical V2 representation.
   */
  load(graph: TraceGraph | TraceGraphV2 | TraceDocumentV2 | unknown): void {
    const raw = asRecord(graph);
    this.clear();
    if (raw.schemaVersion === "2.0") {
      const needsCanonicalRewrite = Array.isArray(raw.dependencies) || Array.isArray(raw.semanticLinks);
      this.loadV2(raw);
      this.loadedV1 = needsCanonicalRewrite;
      this.wroteV2AfterV1 = !needsCanonicalRewrite;
    } else {
      this.loadV1(raw);
      this.loadedV1 = true;
      this.wroteV2AfterV1 = false;
    }
    this.normalizeCausalGraph();
    this.refreshLastNode();
  }

  async flush(): Promise<void> {
    await this.writeChain;
  }

  private clear(): void {
    this.nodes.clear();
    this.dependencies.clear();
    this.episodes.clear();
    this.artifacts.clear();
    this.changes.length = 0;
    this.pendingChanges = [];
    this.revision = 0;
    this.meta = { sessionId: this.sessionId, createdAt: now() };
    this.lastNodeId = undefined;
  }

  private loadV2(raw: Record<string, unknown>): void {
    const meta = asRecord(raw.meta);
    this.meta = { ...clone(meta), sessionId: asString(meta.sessionId, this.sessionId) };
    this.revision = typeof raw.revision === "number" && Number.isFinite(raw.revision) ? Math.max(0, Math.trunc(raw.revision)) : 0;
    this.pendingChanges = (Array.isArray(raw.pendingChanges) ? raw.pendingChanges : []).flatMap((value) => {
      const parsed = value as TraceChange;
      return parsed && typeof parsed.id === "string" && typeof parsed.revision === "number" ? [clone(parsed)] : [];
    });
    for (const item of Array.isArray(raw.nodes) ? raw.nodes : []) {
      const node = asRecord(item);
      const id = asString(node.id);
      if (!id) continue;
      this.nodes.set(id, {
        id,
        title: asString(node.title, id),
        type: asString(node.type, "task"),
        status: asString(node.status, "pending"),
        ...(typeof node.agent === "string" ? { agent: node.agent } : {}),
        ...(typeof node.description === "string" ? { description: node.description } : {}),
        ...(typeof node.reason === "string" ? { reason: node.reason } : {}),
        ...(typeof node.context === "string" ? { context: node.context } : {}),
        ...(node.report && typeof node.report === "object" ? { report: clone(node.report) as TraceNodeV2["report"] } : {}),
        ...(typeof node.createdAt === "string" ? { createdAt: node.createdAt } : {}),
        ...(typeof node.updatedAt === "string" ? { updatedAt: node.updatedAt } : {}),
        ...(node.timestamp && typeof node.timestamp === "object" ? { timestamp: clone(node.timestamp) as TraceNodeV2["timestamp"] } : {}),
        ...(typeof node.durationMs === "number" ? { durationMs: node.durationMs } : {}),
        ...(typeof node.errorMessage === "string" ? { errorMessage: node.errorMessage } : {}),
        toolCalls: asStringArray(node.toolCalls),
        artifactIds: unique(asStringArray(node.artifactIds)),
        ...(typeof node.primaryEpisodeId === "string" ? { primaryEpisodeId: node.primaryEpisodeId } : {}),
        episodeTags: unique(asStringArray(node.episodeTags)),
        ...(node.metadata && typeof node.metadata === "object" ? { metadata: clone(node.metadata) as Record<string, unknown> } : {}),
        records: (Array.isArray(node.records) ? node.records : []).flatMap((value) => {
          const record = asRecord(value);
          if (typeof record.sourceAgent !== "string" || typeof record.description !== "string") return [];
          return [{
            sourceAgent: record.sourceAgent,
            description: record.description,
            ...(typeof record.context === "string" ? { context: record.context } : {}),
            ...(typeof record.checkpointId === "string" ? { checkpointId: record.checkpointId } : {}),
            createdAt: asString(record.createdAt, asString(node.createdAt, now())),
          }];
        }),
        parents: (Array.isArray(node.parents) ? node.parents : []).flatMap((value) => {
          const parent = asRecord(value);
          const nodeId = asString(parent.nodeId);
          if (!nodeId) return [];
          const conclusion = parent.conclusion === "confirmed" || parent.conclusion === "rejected" || parent.conclusion === "uncertain"
            ? parent.conclusion
            : "candidate";
          return [{ nodeId, conclusion, ...(typeof parent.reason === "string" ? { reason: parent.reason } : {}) }];
        }),
        executionResult: node.executionResult === "failed" || node.status === "failed" || node.status === "error" ? "failed" : "completed",
        revoked: node.revoked === true || node.status === "rolled_back" || node.status === "inactive",
        ...(node.confidence === "low" || node.confidence === "medium" || node.confidence === "high"
          ? { confidence: node.confidence }
          : {}),
        ...(typeof node.confidenceReason === "string" ? { confidenceReason: node.confidenceReason } : {}),
        reviewConclusion: node.reviewConclusion === "approved" || node.reviewConclusion === "rejected" || node.reviewConclusion === "uncertain"
          ? node.reviewConclusion
          : "unreviewed",
        ...(typeof node.reviewReason === "string" ? { reviewReason: node.reviewReason } : {}),
      });
    }
    for (const item of Array.isArray(raw.dependencies) ? raw.dependencies : []) {
      const edge = asRecord(item);
      const prerequisiteId = asString(edge.prerequisiteId);
      const dependentId = asString(edge.dependentId);
      if (!prerequisiteId || !dependentId || !this.nodes.has(prerequisiteId) || !this.nodes.has(dependentId)) continue;
      const id = asString(edge.id, stableId("dependency", prerequisiteId, dependentId));
      const state = edge.state === "active" || edge.state === "rejected" ? edge.state : "proposed";
      // Never hydrate a malformed persisted cycle into the canonical graph.
      if (this.wouldCreateCycle(prerequisiteId, dependentId)) {
        continue;
      }
      const dependency: TraceDependency = {
        id,
        prerequisiteId,
        dependentId,
        origin: this.validOrigin(edge.origin),
        confidence: edge.confidence === "high" || edge.confidence === "medium" ? edge.confidence : "low",
        state,
        ...(typeof edge.reason === "string" ? { reason: edge.reason } : {}),
        evidence: this.coerceEvidence(edge.evidence),
        ...(typeof edge.createdAt === "string" ? { createdAt: edge.createdAt } : {}),
        ...(typeof edge.updatedAt === "string" ? { updatedAt: edge.updatedAt } : {}),
      };
      // Old V2 files may only have the collection form. Migrate it once, but
      // never let it overwrite an embedded parent that already exists.
      const child = this.nodes.get(dependentId);
      if (child && !child.parents.some((parent) => parent.nodeId === prerequisiteId)) {
        this.syncParentFromDependency(dependency);
      }
    }
    this.normalizeCausalGraph();
    for (const item of Array.isArray(raw.episodes) ? raw.episodes : []) {
      const episode = asRecord(item);
      const id = asString(episode.id);
      if (!id) continue;
      this.episodes.set(id, { id, title: asString(episode.title, id), ...(typeof episode.description === "string" ? { description: episode.description } : {}), ...(typeof episode.createdAt === "string" ? { createdAt: episode.createdAt } : {}), ...(typeof episode.updatedAt === "string" ? { updatedAt: episode.updatedAt } : {}) });
    }
    for (const item of Array.isArray(raw.artifacts) ? raw.artifacts : []) {
      const artifact = asRecord(item);
      const id = asString(artifact.id);
      const path = asString(artifact.path);
      if (!id || !path) continue;
      this.artifacts.set(id, {
        id,
        ...(typeof artifact.producerNodeId === "string" || artifact.producerNodeId === null ? { producerNodeId: artifact.producerNodeId } : {}),
        path,
        kind: asString(artifact.kind, "file"),
        ...(typeof artifact.type === "string" ? { type: artifact.type } : {}),
        ...(typeof artifact.checkpointId === "string" ? { checkpointId: artifact.checkpointId } : {}),
        ...(artifact.checkpoint && typeof artifact.checkpoint === "object" ? { checkpoint: clone(artifact.checkpoint) as TraceCheckpointRef } : {}),
        ...(typeof artifact.blobHash === "string" ? { blobHash: artifact.blobHash } : {}),
        exists: artifact.exists === "present" || artifact.exists === "missing" ? artifact.exists : "unknown",
        verificationStatus: artifact.verificationStatus === "unverified" || artifact.verificationStatus === "verified" || artifact.verificationStatus === "missing" ? artifact.verificationStatus : "reserved",
        ...(artifact.role === "input" || artifact.role === "output" || artifact.role === "checkpoint" || artifact.role === "reference" ? { role: artifact.role } : {}),
        ...(typeof artifact.createdAt === "string" ? { createdAt: artifact.createdAt } : {}),
        ...(typeof artifact.updatedAt === "string" ? { updatedAt: artifact.updatedAt } : {}),
      });
    }
    // Defensively add any registered producer artifact ids missing from a
    // malformed V2 file, without serializing parent/child duplicates.
    for (const artifact of this.artifacts.values()) {
      if (artifact.producerNodeId && this.nodes.has(artifact.producerNodeId)) {
        const node = this.nodes.get(artifact.producerNodeId)!;
        node.artifactIds = unique([...node.artifactIds, artifact.id]);
      }
    }
  }

  private loadV1(raw: Record<string, unknown>): void {
    const rawMeta = asRecord(raw.meta);
    this.meta = { ...clone(rawMeta), sessionId: asString(rawMeta.sessionId, this.sessionId) };
    const legacyNodes = Array.isArray(raw.nodes) ? raw.nodes.map(asRecord) : [];
    // First pass creates every node, so relation migration is independent of
    // array order and can preserve multiple roots.
    for (const source of legacyNodes) {
      const id = asString(source.id);
      if (!id) continue;
      const report = source.summary !== undefined || source.content !== undefined
        ? { kind: "agent_report" as const, ...(typeof source.summary === "string" ? { summary: source.summary } : {}), ...(typeof source.content === "string" ? { content: source.content } : {}), ...(typeof source.agent === "string" ? { author: source.agent } : {}) }
        : undefined;
      const node: TraceNodeV2 = {
        id,
        title: asString(source.title, id),
        type: asString(source.type ?? source.nodeType, "task"),
        status: asString(source.status, "pending"),
        ...(typeof source.agent === "string" ? { agent: source.agent } : {}),
        ...(typeof source.description === "string" ? { description: source.description } : {}),
        ...(typeof source.reason === "string" ? { reason: source.reason } : {}),
        ...(typeof source.context === "string" ? { context: source.context } : {}),
        ...(report ? { report } : {}),
        ...(typeof source.createdAt === "string" ? { createdAt: source.createdAt } : {}),
        ...(typeof source.updatedAt === "string" ? { updatedAt: source.updatedAt } : {}),
        ...(source.timestamp && typeof source.timestamp === "object" ? { timestamp: clone(source.timestamp) as TraceNodeV2["timestamp"] } : {}),
        ...(typeof source.durationMs === "number" ? { durationMs: source.durationMs } : {}),
        ...(typeof source.errorMessage === "string" ? { errorMessage: source.errorMessage } : {}),
        toolCalls: asStringArray(source.toolCalls),
        artifactIds: [],
        episodeTags: [],
        ...(source.metadata && typeof source.metadata === "object" ? { metadata: clone(source.metadata) as Record<string, unknown> } : {}),
        records: (typeof source.description === "string" || report?.summary || report?.content) ? [{
          sourceAgent: asString(source.agent, "legacy"),
          description: asString(source.description, report?.summary ?? report?.content ?? "Legacy trace node"),
          ...(typeof source.context === "string" ? { context: source.context } : {}),
          createdAt: asString(source.createdAt, now()),
        }] : [],
        parents: [],
        executionResult: source.status === "failed" || source.status === "error" ? "failed" : "completed",
        revoked: source.revoked === true || source.status === "rolled_back" || source.status === "inactive",
        ...(source.confidence === "low" || source.confidence === "medium" || source.confidence === "high"
          ? { confidence: source.confidence }
          : {}),
        ...(typeof source.confidenceReason === "string" ? { confidenceReason: source.confidenceReason } : {}),
        reviewConclusion: "unreviewed",
      };
      this.nodes.set(id, node);
      for (const rawArtifact of Array.isArray(source.artifacts) ? source.artifacts : []) {
        const artifact = asRecord(rawArtifact);
        const path = asString(artifact.path);
        if (path) this.registerArtifactInternal(id, {
          path,
          type: asString(artifact.type) || undefined,
          kind: asString(artifact.type, "file"),
          role: "output",
          preserveUnknownTimestamps: true,
          ...(typeof source.createdAt === "string" ? { createdAt: source.createdAt } : {}),
          ...(typeof source.updatedAt === "string" ? { updatedAt: source.updatedAt } : {}),
        });
      }
      for (const rawCheckpoint of Array.isArray(source.checkpoints) ? source.checkpoints : []) {
        const checkpoint = rawCheckpoint as TraceCheckpointRef;
        if (checkpoint?.id) this.registerArtifactInternal(id, {
          path: `checkpoint:${checkpoint.id}`, kind: "checkpoint", type: "checkpoint", checkpointId: checkpoint.id, checkpoint, role: "checkpoint",
          preserveUnknownTimestamps: true,
          ...(typeof source.createdAt === "string" ? { createdAt: source.createdAt } : {}),
          ...(typeof source.updatedAt === "string" ? { updatedAt: source.updatedAt } : {}),
        });
      }
    }
    // Second pass maps V1 relation semantics. Relation arrays are not copied.
    for (const source of legacyNodes) {
      const dependentId = asString(source.id);
      if (!this.nodes.has(dependentId)) continue;
      const parents = Array.isArray(source.parents) ? source.parents.map(asRecord) : [];
      const seen = new Set<string>();
      for (const parent of parents) {
        const prerequisiteId = asString(parent.id);
        const relation = asString(parent.relation, "legacy");
        const key = `${prerequisiteId}\u0000${relation}`;
        if (!prerequisiteId || seen.has(key)) continue;
        seen.add(key);
        this.addLegacyRelationInternal(prerequisiteId, dependentId, relation, typeof parent.explanation === "string" ? parent.explanation : undefined, "legacy");
      }
      // parentIds without a typed relation are intentionally ignored: they do
      // not carry enough evidence to manufacture a causal claim.
    }
    this.normalizeCausalGraph();
    this.revision = 0;
  }

  private addLegacyRelationInternal(
    prerequisiteId: string,
    dependentId: string,
    relation: string | undefined,
    reason: string | undefined,
    source: "trace" | "legacy",
  ): void {
    if (!this.nodes.has(prerequisiteId) || !this.nodes.has(dependentId)) return;
    if (source === "trace") {
      if (relation === "depends_on") {
        this.proposeDependencyInternal({
          prerequisiteId,
          dependentId,
          origin: "trace",
          reason,
          evidence: [{ source: "trace", kind: "trace_inference", ...(reason ? { detail: reason } : {}) }],
        });
      } else if (relation === "delegated") {
        this.proposeDependencyInternal({
          prerequisiteId,
          dependentId,
          origin: "host",
          reason,
          evidence: [{ source: "host", kind: "delegation", ...(reason ? { detail: reason } : {}), deterministic: true }],
        });
      } else if (relation === "necessitated_by" || relation === "used") {
        this.proposeDependencyInternal({
          prerequisiteId,
          dependentId,
          origin: "trace",
          reason,
          evidence: [{ source: "trace", kind: relation, ...(reason ? { detail: reason } : {}) }],
        });
      }
      return;
    }
    if (relation === "depends_on") {
      this.upsertMigrationDependency(prerequisiteId, dependentId, "legacy", "medium", "active", reason, "legacy_depends_on");
    } else if (relation === "delegated") {
      this.upsertMigrationDependency(prerequisiteId, dependentId, "host", "high", "active", reason, "delegation");
    } else if (relation === "necessitated_by" || relation === "used") {
      this.upsertMigrationDependency(prerequisiteId, dependentId, "legacy", "medium", "proposed", reason, relation);
    }
  }

  private upsertMigrationDependency(
    prerequisiteId: string,
    dependentId: string,
    origin: TraceDependencyOrigin,
    confidence: "medium" | "high",
    state: TraceDependencyState,
    reason: string | undefined,
    kind: string,
  ): void {
    if (this.wouldCreateCycle(prerequisiteId, dependentId)) return;
    const id = stableId("dependency", prerequisiteId, dependentId);
    const existing = this.dependencies.get(id);
    if (existing) {
      existing.evidence = this.mergeEvidence(existing.evidence, [{ source: "v1", kind, detail: reason }]);
      this.syncParentFromDependency(existing);
      return;
    }
    const stamp = this.nodes.get(dependentId)?.createdAt;
    const dependency: TraceDependency = {
      id, prerequisiteId, dependentId, origin, confidence, state,
      ...(reason ? { reason } : {}),
      evidence: [{ source: "v1", kind, detail: reason }],
      ...(stamp ? { createdAt: stamp, updatedAt: stamp } : {}),
    };
    this.dependencies.set(id, dependency);
    this.syncParentFromDependency(dependency);
  }

  private proposeDependencyInternal(input: TraceDependencyInput): { ok: boolean; dependency?: TraceDependency; reason?: string } {
    const prerequisiteId = input.prerequisiteId;
    const dependentId = input.dependentId;
    if (!this.nodes.has(prerequisiteId) || !this.nodes.has(dependentId)) return { ok: false, reason: "node not found" };
    if (this.isSessionRoot(prerequisiteId) || this.isSessionRoot(dependentId)) return { ok: false, reason: "session root relations are Host-managed" };
    if (prerequisiteId === dependentId || this.wouldCreateCycle(prerequisiteId, dependentId)) return { ok: false, reason: "dependency cycle rejected" };
    const id = stableId("dependency", prerequisiteId, dependentId);
    const existing = this.dependencies.get(id);
    if (existing?.state === "rejected") return { ok: false, reason: "dependency was rejected" };
    const origin = input.origin ?? "trace";
    const evidence = this.mergeEvidence([], input.evidence ?? [{ source: origin, kind: origin === "trace" ? "trace_inference" : "reported", detail: input.reason }]);
    if (existing) {
      existing.evidence = this.mergeEvidence(existing.evidence, evidence);
      if (input.reason) existing.reason = input.reason;
      this.applyConfidencePolicy(existing, origin, evidence);
      this.syncParentFromDependency(existing);
      existing.updatedAt = now();
      return { ok: true, dependency: existing };
    }
    const stamp = now();
    const dependency: TraceDependency = {
      id,
      prerequisiteId,
      dependentId,
      origin,
      confidence: "low",
      state: "proposed",
      ...(input.reason ? { reason: input.reason } : {}),
      evidence,
      createdAt: stamp,
      updatedAt: stamp,
    };
    this.applyConfidencePolicy(dependency, origin, evidence);
    this.dependencies.set(id, dependency);
    this.syncParentFromDependency(dependency);
    return { ok: true, dependency };
  }

  private syncParentFromDependency(dependency: TraceDependency): void {
    const node = this.nodes.get(dependency.dependentId);
    if (!node) return;
    const conclusion: TraceCausalParent["conclusion"] = dependency.state === "active" && (
      dependency.origin === "user" ||
      dependency.origin === "explicit" ||
      (dependency.origin === "host" && isDeterministicHostEvidence(dependency.evidence)) ||
      (dependency.origin === "legacy" && dependency.evidence.some((item) =>
        item.source === "v1" && item.kind === "legacy_depends_on"
      ))
    )
      ? "confirmed"
      : dependency.state === "rejected"
        ? "rejected"
        : dependency.state === "active"
          ? "uncertain"
          : "candidate";
    const existing = node.parents.find((item) => item.nodeId === dependency.prerequisiteId);
    if (existing) {
      existing.conclusion = conclusion;
      if (dependency.reason) existing.reason = dependency.reason;
    } else {
      node.parents.push({
        nodeId: dependency.prerequisiteId,
        conclusion,
        ...(dependency.reason ? { reason: dependency.reason } : {}),
      });
    }
  }

  private applyConfidencePolicy(
    dependency: TraceDependency,
    incomingOrigin: TraceDependencyOrigin,
    incomingEvidence: TraceDependencyEvidence[],
  ): void {
    // Trace inference stays proposed/low forever. Repeating the same LLM view
    // is not independent corroboration.
    if (incomingOrigin === "trace") return;
    if (incomingOrigin === "user" || incomingOrigin === "explicit" || (incomingOrigin === "host" && isDeterministicHostEvidence(incomingEvidence))) {
      dependency.confidence = "high";
      dependency.state = "active";
      return;
    }
    if (dependency.state === "active") return;
    // Only distinct non-Trace report sources can lift a candidate to medium;
    // they still cannot make it official.
    const sources = new Set(
      dependency.evidence
        .filter((item) => item.source !== "trace" && item.kind !== "trace_inference")
        .map((item) => item.source),
    );
    if (sources.size >= 2) dependency.confidence = "medium";
    dependency.state = "proposed";
  }

  /**
   * Create the one Host-owned structural root for this session. The root is a
   * container/initial condition, not a scientific claim, so it is pre-approved
   * and never enters the Auditor queue.
   */
  private ensureSessionRoot(): TraceNodeV2 {
    const configured = typeof this.meta.rootNodeId === "string" ? this.meta.rootNodeId : undefined;
    const baseId = configured ?? stableId("node_session_start", this.sessionId);
    let id = baseId;
    let suffix = 0;
    while (this.nodes.has(id) && this.nodes.get(id)?.type !== "session_start") {
      suffix++;
      id = `${baseId}_${suffix}`;
    }
    this.meta.rootNodeId = id;
    const existing = this.nodes.get(id);
    const stamp = existing?.createdAt ?? this.meta.createdAt ?? now();
    const root: TraceNodeV2 = existing ?? {
      id,
      title: "Session Start",
      type: "session_start",
      status: "completed",
      agent: "host",
      description: "Initial context and structural root for this session.",
      createdAt: stamp,
      updatedAt: stamp,
      toolCalls: [],
      artifactIds: [],
      episodeTags: [],
      records: [],
      parents: [],
      executionResult: "completed",
      revoked: false,
      confidence: "high",
      confidenceReason: "Created deterministically by the Host for this session.",
      reviewConclusion: "approved",
      reviewReason: "System structural node; no scientific review required.",
    };
    root.title = "Session Start";
    root.type = "session_start";
    root.status = "completed";
    root.agent = "host";
    root.parents = [];
    root.executionResult = "completed";
    root.revoked = false;
    root.reviewConclusion = "approved";
    this.nodes.set(id, root);
    return root;
  }

  private isSessionRoot(nodeId: string): boolean {
    return nodeId === this.meta.rootNodeId;
  }

  /**
   * Enforce one DAG across every canonical parent conclusion after creates,
   * reviews, restores and loads. Candidate/uncertain/rejected edges remain
   * review history, but history is still graph structure and cannot cycle.
   */
  private normalizeCausalGraph(): void {
    const root = this.ensureSessionRoot();

    // Remove malformed references and duplicate parent entries first. A
    // rejected tombstone wins ties so a malformed duplicate cannot silently
    // resurrect a relation that was explicitly rejected.
    for (const node of this.nodes.values()) {
      if (node.id === root.id) {
        node.parents = [];
        continue;
      }
      const deduplicated = new Map<string, TraceCausalParent>();
      for (const parent of node.parents) {
        if (!this.nodes.has(parent.nodeId) || parent.nodeId === node.id) continue;
        const current = deduplicated.get(parent.nodeId);
        if (!current || parent.conclusion === "rejected") deduplicated.set(parent.nodeId, parent);
      }
      node.parents = [...deduplicated.values()];
    }

    // Accept all edges in stable insertion order. A manually edited or corrupt
    // persisted edge that closes a cycle is dropped: changing its conclusion
    // would not remove it from the all-state DAG.
    const outgoing = new Map<string, Set<string>>();
    const hasPath = (fromId: string, targetId: string): boolean => {
      const seen = new Set<string>();
      const visit = (id: string): boolean => {
        if (id === targetId) return true;
        if (seen.has(id)) return false;
        seen.add(id);
        for (const childId of outgoing.get(id) ?? []) {
          if (visit(childId)) return true;
        }
        return false;
      };
      return visit(fromId);
    };
    for (const node of this.nodes.values()) {
      if (node.id === root.id) continue;
      const accepted: TraceCausalParent[] = [];
      for (const parent of node.parents) {
        const parentNode = this.nodes.get(parent.nodeId);
        if (!parentNode || hasPath(node.id, parent.nodeId)) continue;
        accepted.push(parent);
        const children = outgoing.get(parent.nodeId) ?? new Set<string>();
        children.add(node.id);
        outgoing.set(parent.nodeId, children);
      }
      node.parents = accepted;
    }

    // A real confirmed parent replaces the temporary root link. Otherwise the
    // Host supplies the root as an immediately confirmed fallback.
    for (const node of this.nodes.values()) {
      if (node.revoked || node.id === root.id) continue;
      const hasRealConfirmedParent = node.parents.some((parent) => {
        const parentNode = this.nodes.get(parent.nodeId);
        return parent.nodeId !== root.id && parent.conclusion === "confirmed" && parentNode && !parentNode.revoked;
      });
      if (hasRealConfirmedParent) {
        node.parents = node.parents.filter((parent) => parent.nodeId !== root.id);
      } else {
        const rootRef = node.parents.find((parent) => parent.nodeId === root.id);
        if (rootRef) {
          rootRef.conclusion = "confirmed";
          rootRef.reason = "No more specific confirmed causal parent; attached to the session root by the Host.";
        } else {
          node.parents.unshift({
            nodeId: root.id,
            conclusion: "confirmed",
            reason: "No more specific confirmed causal parent; attached to the session root by the Host.",
          });
        }
      }
    }
    this.rebuildCompatibilityDependencies();
  }

  private wouldCreateCycle(prerequisiteId: string, dependentId: string): boolean {
    if (prerequisiteId === dependentId) return true;
    const seen = new Set<string>();
    const visit = (id: string): boolean => {
      if (id === prerequisiteId) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      for (const node of this.nodes.values()) {
        if (node.parents.some((parent) => parent.nodeId === id) && visit(node.id)) return true;
      }
      return false;
    };
    return visit(dependentId);
  }

  private syncCompatibilityDependency(
    prerequisiteId: string,
    dependentId: string,
    conclusion: "candidate" | "confirmed" | "rejected" | "uncertain",
    reason?: string,
    stampOverride?: string,
  ): void {
    const id = stableId("dependency", prerequisiteId, dependentId);
    const existing = this.dependencies.get(id);
    const stamp = stampOverride ?? now();
    const state: TraceDependencyState = conclusion === "confirmed" ? "active" : conclusion === "rejected" ? "rejected" : "proposed";
    if (existing) {
      existing.state = state;
      if (conclusion === "confirmed") existing.confidence = "high";
      else if (conclusion === "uncertain") existing.confidence = "low";
      if (reason) existing.reason = reason;
      existing.updatedAt = stamp;
      return;
    }
    this.dependencies.set(id, {
      id,
      prerequisiteId,
      dependentId,
      origin: "trace",
      confidence: conclusion === "confirmed" ? "high" : "low",
      state,
      ...(reason ? { reason } : {}),
      evidence: [],
      createdAt: stamp,
      updatedAt: stamp,
    });
  }

  /** Rebuild the legacy read model exclusively from embedded node parents. */
  private rebuildCompatibilityDependencies(): void {
    const retained = new Set<string>();
    for (const node of this.nodes.values()) {
      for (const parent of node.parents) {
        if (!this.nodes.has(parent.nodeId) || parent.nodeId === node.id) continue;
        retained.add(stableId("dependency", parent.nodeId, node.id));
        this.syncCompatibilityDependency(parent.nodeId, node.id, parent.conclusion, parent.reason, node.updatedAt ?? node.createdAt);
      }
    }
    for (const id of this.dependencies.keys()) {
      if (!retained.has(id)) this.dependencies.delete(id);
    }
  }

  private auditNodeEvidence(node: TraceNodeV2): unknown {
    return {
      id: node.id,
      title: node.title,
      type: node.type,
      description: node.description,
      report: node.report,
      records: node.records,
      artifactIds: node.artifactIds,
      executionResult: node.executionResult,
      confidence: node.confidence,
      confidenceReason: node.confidenceReason,
    };
  }

  private registerArtifactInternal(nodeId: string, input: TraceArtifactInput): TraceArtifactV2 {
    const id = input.id ?? stableId("artifact", input.producerNodeId ?? nodeId, input.path, input.type ?? input.kind, input.role);
    const stamp = now();
    const existing = this.artifacts.get(id);
    const createdAt = input.createdAt ?? existing?.createdAt ?? (input.preserveUnknownTimestamps ? undefined : stamp);
    const updatedAt = input.updatedAt ?? existing?.updatedAt ?? (input.preserveUnknownTimestamps ? undefined : stamp);
    const artifact: TraceArtifactV2 = {
      id,
      producerNodeId: input.producerNodeId === undefined ? nodeId : input.producerNodeId,
      path: input.path,
      kind: input.kind ?? input.type ?? "file",
      ...(input.type ? { type: input.type } : {}),
      ...(input.checkpointId ? { checkpointId: input.checkpointId } : {}),
      ...(input.checkpoint ? { checkpoint: clone(input.checkpoint) } : {}),
      ...(input.blobHash ? { blobHash: input.blobHash } : {}),
      ...(input.changeStatus ? { changeStatus: input.changeStatus } : {}),
      ...(input.previousPath ? { previousPath: input.previousPath } : {}),
      exists: input.exists ?? existing?.exists ?? "unknown",
      verificationStatus: input.verificationStatus ?? existing?.verificationStatus ?? "reserved",
      ...(input.role ? { role: input.role } : existing?.role ? { role: existing.role } : {}),
      ...(createdAt ? { createdAt } : {}),
      ...(updatedAt ? { updatedAt } : {}),
    };
    this.artifacts.set(id, artifact);
    const node = this.nodes.get(nodeId);
    if (node) node.artifactIds = unique([...node.artifactIds, id]);
    return artifact;
  }

  private attachCheckpointFilesInternal(
    nodeId: string,
    checkpoint: TraceCheckpointRef,
    files: CheckpointFileProvenance[],
  ): void {
    for (const file of files) {
      this.registerArtifactInternal(nodeId, {
        path: file.path,
        previousPath: file.previousPath,
        kind: file.binary ? "binary" : "file",
        type: file.binary ? "binary" : "file",
        checkpointId: checkpoint.id,
        blobHash: file.resultBlobId,
        changeStatus: file.status,
        exists: file.status === "deleted" ? "missing" : "present",
        verificationStatus: file.status === "deleted" ? "missing" : "verified",
        role: "output",
        createdAt: checkpoint.capturedAt,
        updatedAt: checkpoint.capturedAt,
      });
    }
  }

  private attachArtifactInputInternal(nodeId: string, input: TraceArtifactInput): TraceArtifactV2 {
    const existing = input.id ? this.artifacts.get(input.id) : undefined;
    if (existing) {
      const node = this.nodes.get(nodeId)!;
      node.artifactIds = unique([...node.artifactIds, existing.id]);
      return existing;
    }
    const artifact = this.registerArtifactInternal(nodeId, { ...input, producerNodeId: input.producerNodeId ?? null, role: "input" });
    return artifact;
  }

  private mergeEvidence(existing: TraceDependencyEvidence[], incoming: TraceDependencyEvidence[]): TraceDependencyEvidence[] {
    const seen = new Set(existing.map(evidenceKey));
    const out = [...existing];
    for (const item of incoming) {
      const normal: TraceDependencyEvidence = {
        source: item.source || "unknown",
        kind: item.kind || "reported",
        ...(item.detail ? { detail: item.detail } : {}),
        ...(item.artifactId ? { artifactId: item.artifactId } : {}),
        ...(item.reportId ? { reportId: item.reportId } : {}),
        ...(item.path ? { path: item.path } : {}),
        ...(item.checkpointId ? { checkpointId: item.checkpointId } : {}),
        ...(item.baseBlobId ? { baseBlobId: item.baseBlobId } : {}),
        ...(item.resultBlobId ? { resultBlobId: item.resultBlobId } : {}),
        ...(item.deterministic !== undefined ? { deterministic: item.deterministic } : {}),
      };
      const key = evidenceKey(normal);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(normal);
      }
    }
    return out;
  }

  private materializeNode(node: TraceNodeV2): TraceNode {
    const parentRefs: Array<{ id: string; relation?: string; explanation?: string; edgeType?: string }> = node.parents
      .filter((parent) => parent.conclusion === "confirmed" && this.nodes.has(parent.nodeId))
      .map((parent) => ({
        id: parent.nodeId,
        relation: "depends_on",
        ...(parent.reason ? { explanation: parent.reason } : {}),
        edgeType: "confirmed",
      }));
    const parentIds = unique(parentRefs.map((item) => item.id));
    const childIds = unique([...this.nodes.values()]
      .filter((child) => child.parents.some((parent) => parent.nodeId === node.id && parent.conclusion === "confirmed"))
      .map((child) => child.id));
    const nodeArtifacts = node.artifactIds
      .map((id) => this.artifacts.get(id))
      .filter((item): item is TraceArtifactV2 => Boolean(item));
    const artifacts: TraceArtifact[] = nodeArtifacts.map((artifact) => ({ path: artifact.path, ...(artifact.type ? { type: artifact.type } : { type: artifact.kind }) }));
    const checkpoints = nodeArtifacts
      .map((artifact) => artifact.checkpoint)
      .filter((checkpoint): checkpoint is TraceCheckpointRef => Boolean(checkpoint));
    return {
      id: node.id,
      title: node.title,
      type: node.type,
      status: node.status,
      ...(node.agent ? { agent: node.agent } : {}),
      ...(node.description ? { description: node.description } : {}),
      ...(node.report?.summary ? { summary: node.report.summary } : {}),
      ...(node.report?.content ? { content: node.report.content } : {}),
      ...(node.reason ? { reason: node.reason } : {}),
      ...(node.context ? { context: node.context } : {}),
      parents: parentRefs,
      artifacts,
      parentIds,
      childIds,
      ...(node.createdAt ? { createdAt: node.createdAt } : {}),
      ...(node.updatedAt ? { updatedAt: node.updatedAt } : {}),
      ...(node.timestamp ? { timestamp: clone(node.timestamp) } : {}),
      ...(node.durationMs !== undefined ? { durationMs: node.durationMs } : {}),
      ...(node.errorMessage ? { errorMessage: node.errorMessage } : {}),
      toolCalls: clone(node.toolCalls),
      ...(checkpoints.length ? { checkpoints } : {}),
      artifactIds: clone(node.artifactIds),
      ...(node.primaryEpisodeId ? { primaryEpisodeId: node.primaryEpisodeId } : {}),
      ...(node.episodeTags.length ? { episodeTags: clone(node.episodeTags) } : {}),
      ...(node.metadata ? { metadata: clone(node.metadata) } : {}),
      records: clone(node.records),
      causalParents: clone(node.parents),
      executionResult: node.executionResult,
      revoked: node.revoked,
      ...(node.confidence ? { confidence: node.confidence } : {}),
      ...(node.confidenceReason ? { confidenceReason: node.confidenceReason } : {}),
      reviewConclusion: node.reviewConclusion,
      ...(node.reviewReason ? { reviewReason: node.reviewReason } : {}),
    };
  }

  private refreshLastNode(): void {
    let last: TraceNodeV2 | undefined;
    for (const node of this.nodes.values()) {
      if (this.isSessionRoot(node.id)) continue;
      if (!last || (node.createdAt ?? "") >= (last.createdAt ?? "")) last = node;
    }
    this.lastNodeId = last?.id;
  }

  private validOrigin(value: unknown): TraceDependencyOrigin {
    return value === "agent_report" || value === "explicit" || value === "host" || value === "user" || value === "legacy" ? value : "trace";
  }

  private coerceEvidence(value: unknown): TraceDependencyEvidence[] {
    if (!Array.isArray(value)) return [];
    return value.map(asRecord).map((item) => ({
      source: asString(item.source, "unknown"),
      kind: asString(item.kind, "reported"),
      ...(typeof item.detail === "string" ? { detail: item.detail } : {}),
      ...(typeof item.artifactId === "string" ? { artifactId: item.artifactId } : {}),
      ...(typeof item.reportId === "string" ? { reportId: item.reportId } : {}),
      ...(typeof item.path === "string" ? { path: item.path } : {}),
      ...(typeof item.checkpointId === "string" ? { checkpointId: item.checkpointId } : {}),
      ...(typeof item.baseBlobId === "string" ? { baseBlobId: item.baseBlobId } : {}),
      ...(typeof item.resultBlobId === "string" ? { resultBlobId: item.resultBlobId } : {}),
      ...(typeof item.deterministic === "boolean" ? { deterministic: item.deterministic } : {}),
    }));
  }

  private commit(op: TraceChangeOp, nodeId?: string, draft?: TraceChangeDraft): void {
    this.revision++;
    const change: TraceChange = {
      id: `change_${randomUUID()}`,
      revision: this.revision,
      actor: draft?.actor ?? { type: "host" },
      action: draft?.action ?? (op === "created" ? "node_created" : "node_updated"),
      target: draft?.target ?? (nodeId ? { nodeId } : {}),
      ...(draft?.before !== undefined ? { before: clone(draft.before) } : {}),
      ...(draft?.after !== undefined ? { after: clone(draft.after) } : {}),
      ...(draft?.reason ? { reason: draft.reason } : {}),
      ...(draft?.metadata ? { metadata: clone(draft.metadata) } : {}),
      createdAt: now(),
    };
    this.changes.push(change);
    this.persist(change);
    if (nodeId) {
      const node = this.getNode(nodeId);
      if (node) this.onChange?.(op, node);
    }
    this.onDelta?.({ schemaVersion: "2.0", revision: this.revision, op: "snapshot", graph: this.getGraphV2() });
  }

  private changeLogPath(): string | undefined {
    if (!this.persistPath) return undefined;
    return this.persistPath.endsWith("trace.json")
      ? `${this.persistPath.slice(0, -"trace.json".length)}trace-changes.jsonl`
      : `${this.persistPath}.changes.jsonl`;
  }

  private persist(change?: TraceChange): void {
    if (!this.persistPath) return;
    if (change && !this.pendingChanges.some((item) => item.id === change.id)) {
      this.pendingChanges.push(clone(change));
    }
    // Every snapshot carries the complete non-durable journal tail. If an
    // earlier append failed, a later mutation therefore cannot overwrite and
    // lose that older change.
    const pending = clone(this.pendingChanges);
    const graph = this.getPersistedGraph(pending);
    this.writeChain = this.writeChain
      .then(async () => {
        await mkdir(dirname(this.persistPath!), { recursive: true });
        if (this.loadedV1 && !this.wroteV2AfterV1) {
          const backupPath = this.persistPath!.endsWith("trace.json")
            ? `${this.persistPath!.slice(0, -"trace.json".length)}trace.v1.json.bak`
            : `${this.persistPath!}.v1.json.bak`;
          try {
            await stat(backupPath);
          } catch {
            // Backup is made immediately before the first replacement, never on
            // pure V1 reads and never overwritten on later V2 writes.
            await copyFile(this.persistPath!, backupPath).catch(() => {});
          }
          this.wroteV2AfterV1 = true;
        }
        await this.writeSnapshot(graph);
        if (pending.length > 0) {
          const journalPath = this.changeLogPath()!;
          let journal = "";
          try {
            journal = await readFile(journalPath, "utf8");
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
          const durableIds = new Set<string>();
          for (const line of journal.split("\n")) {
            try {
              const value = JSON.parse(line) as TraceChange;
              if (typeof value?.id === "string") durableIds.add(value.id);
            } catch {
              // Ignore torn/corrupt records; valid records remain deduplicated.
            }
          }
          for (const item of pending) {
            if (!durableIds.has(item.id)) {
              await appendFile(journalPath, `${JSON.stringify(item)}\n`, "utf8");
              durableIds.add(item.id);
            }
          }
          this.pendingChanges = this.pendingChanges.filter((item) => !durableIds.has(item.id));
          // Use the current in-memory graph so a queued later mutation stays
          // embedded while this earlier write finishes.
          await this.writeSnapshot(this.getPersistedGraph(this.pendingChanges));
        }
      })
      // Persistence is best-effort by historical contract. The in-memory graph
      // and live event remain authoritative for this running session.
      .catch(() => {});
  }

  private async writeSnapshot(graph: Record<string, unknown>): Promise<void> {
    if (!this.persistPath) return;
    const tempPath = `${this.persistPath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(tempPath, JSON.stringify(graph, null, 2), "utf8");
      await rename(tempPath, this.persistPath);
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => {});
      throw error;
    }
  }
}
