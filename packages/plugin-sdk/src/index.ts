import { satisfies, valid, validRange } from "semver";

export const PLUGIN_API_VERSION = "1" as const;
export const PREVIEW_RPC_VERSION = "1" as const;
export const AGENT_INSTRUCTIONS_PROTOCOL_VERSION = "1" as const;
export const KNOWLEDGE_SERVICE_PROTOCOL_VERSION = "1" as const;
export const LITERATURE_SERVICE_PROTOCOL_VERSION = "1" as const;

export const SUPPORTED_PLUGIN_PROTOCOLS = {
  preview: PREVIEW_RPC_VERSION,
  agentInstructions: AGENT_INSTRUCTIONS_PROTOCOL_VERSION,
  knowledgeService: KNOWLEDGE_SERVICE_PROTOCOL_VERSION,
  literatureService: LITERATURE_SERVICE_PROTOCOL_VERSION,
} as const;

export type PluginCategory = "skills" | "knowledge" | "visualization" | "analysis" | "workflow" | "other";
export type LegacyPluginKind = "skill-pack" | "knowledge-base" | "previewer" | "ui-panel" | "literature-provider" | "workflow";
export type PluginPermission = "read:workspace" | "read:data" | "compute:worker" | "compute:container" | "network";
export type PluginEnvironment = "local" | "cloud" | "browser";

export interface PluginDependency {
  id: string;
  version: string;
  optional?: boolean;
}

export interface PreviewDatasetRule {
  kind: "stem-siblings";
  companions: string[];
  required?: string[];
}

export interface PreviewerMatch {
  extensions?: string[];
  mimeTypes?: string[];
  dataset?: string | PreviewDatasetRule;
}

export interface PreviewerContribution {
  id: string;
  match?: PreviewerMatch;
  /** Legacy v0 form; normalized into match.extensions by parsePluginManifest. */
  extensions?: string[];
  priority?: number;
  mode?: "readonly" | "editable";
  delivery?: "whole" | "range" | "derived";
  entry: string;
}

export interface EntryContribution { id: string; title: string; entry: string; }
export interface SkillContribution extends EntryContribution { description?: string; }
export interface KnowledgeBaseContribution extends EntryContribution { format?: "html" | "markdown" | "json"; }
export interface PanelContribution extends EntryContribution { placement?: "marketplace" | "workspace"; }
export interface LiteratureProviderContribution extends EntryContribution { format?: "html" | "csl-json"; }
export interface WorkflowContribution extends EntryContribution { format?: "html" | "json"; }
export interface AgentInstructionContribution extends EntryContribution {
  targets: string[];
  mode: "append";
  priority?: number;
}

export interface PluginContributions extends Record<string, unknown> {
  previewers?: PreviewerContribution[];
  commands?: unknown[];
  panels?: PanelContribution[];
  skills?: SkillContribution[];
  knowledgeBases?: KnowledgeBaseContribution[];
  literatureProviders?: LiteratureProviderContribution[];
  computeProviders?: unknown[];
  workflows?: WorkflowContribution[];
  agentInstructions?: AgentInstructionContribution[];
}

export interface PluginManifest {
  id: string;
  version: string;
  apiVersion: typeof PLUGIN_API_VERSION;
  displayName: string;
  description: string;
  categories?: PluginCategory[];
  /** Retained for v0 bundle compatibility; new plugins should use categories + contributes. */
  kind?: LegacyPluginKind;
  engines?: { brainpilot?: string };
  protocols?: Record<string, string>;
  environments?: PluginEnvironment[];
  dependencies?: PluginDependency[];
  conflicts?: string[];
  permissions?: PluginPermission[];
  contributes?: PluginContributions;
}

export interface PluginCompatibilityIssue {
  code: string;
  severity: "warning" | "error";
  message: string;
  subject?: string;
}

export interface PluginCompatibility {
  brainpilotVersion: string;
  requiredRange?: string;
  declared: boolean;
  compatible: boolean;
  status: "compatible" | "warning" | "incompatible";
  issues: PluginCompatibilityIssue[];
}

export interface PluginArtifact { url: string; sha256: string; }

export interface MarketplaceRelease {
  version: string;
  manifest: PluginManifest;
  artifact: PluginArtifact;
  publishedAt: string;
  releaseNotes: string;
}

export interface MarketplaceEntry {
  manifest: PluginManifest;
  publisher: string;
  artifact?: PluginArtifact;
  verified?: boolean;
  homepage?: string;
  status?: "test";
  releases?: MarketplaceRelease[];
  compatibility?: PluginCompatibility;
  latestCompatibleVersion?: string;
  source?: { id: string; type: "builtin" | "local" | "https" };
}

export interface InstalledPlugin {
  manifest: PluginManifest;
  publisher: string;
  verified: boolean;
  enabled: boolean;
  installedAt: string;
  activeVersion: string;
  previousVersion?: string;
  updatedAt?: string;
  compatibility?: PluginCompatibility;
}

export interface PluginUpdateStatus {
  pluginId: string;
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  previousVersion?: string;
  releaseNotes?: string;
  publishedAt?: string;
}

export interface PreviewFileDescriptor {
  name: string;
  size: number;
  mime?: string;
  handle?: string;
}

/** A host-selected sibling file for a compound dataset (for example BrainVision). */
export interface PreviewCompanionFile extends PreviewFileDescriptor { buffer?: ArrayBuffer; }
export interface PreviewDatasetDescriptor { kind: string; primaryHandle: string; members: PreviewFileDescriptor[]; }

export type PreviewHostToPluginMessage =
  | { type: "preview/initialize"; rpcVersion: typeof PREVIEW_RPC_VERSION; token: string; theme?: "light" | "dark" }
  | { type: "preview/open"; rpcVersion: typeof PREVIEW_RPC_VERSION; token: string; requestId: string; file: PreviewFileDescriptor; buffer: ArrayBuffer; companions?: PreviewCompanionFile[]; dataset?: PreviewDatasetDescriptor; derived?: unknown }
  | { type: "preview/range-result"; rpcVersion: typeof PREVIEW_RPC_VERSION; token: string; requestId: string; handle: string; offset: number; totalSize: number; buffer: ArrayBuffer }
  | { type: "preview/dispose"; rpcVersion: typeof PREVIEW_RPC_VERSION; token: string };

export type PreviewPluginToHostMessage =
  | { type: "preview/ready"; rpcVersion: typeof PREVIEW_RPC_VERSION; token: string }
  | { type: "preview/rendered"; rpcVersion: typeof PREVIEW_RPC_VERSION; token: string; requestId: string; metadata?: Record<string, unknown> }
  | { type: "preview/error"; rpcVersion: typeof PREVIEW_RPC_VERSION; token: string; requestId?: string; message: string }
  | { type: "preview/resize"; rpcVersion: typeof PREVIEW_RPC_VERSION; token: string; height: number }
  | { type: "preview/read-range"; rpcVersion: typeof PREVIEW_RPC_VERSION; token: string; requestId: string; handle: string; offset: number; length: number };

export interface KnowledgeServiceCapabilities {
  protocolVersion: typeof KNOWLEDGE_SERVICE_PROTOCOL_VERSION;
  collections?: boolean;
  documentRetrieval?: boolean;
  citations: boolean;
}

export interface KnowledgeQueryRequest { query: string; collectionId?: string; limit?: number; }
export interface ServiceCitation { id: string; title: string; url?: string; authors?: string[]; publishedAt?: string; }
export interface KnowledgeQueryResult { text: string; score?: number; citation: ServiceCitation; }
export type LiteratureSubscriptionState = "unsubscribed" | "subscribed" | "connected" | "enabled";
export interface LiteratureSearchRequest { query: string; limit?: number; }
export interface LiteratureSearchResult { citation: ServiceCitation; abstract?: string; }

const ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)+$/;
const KINDS = new Set<LegacyPluginKind>(["skill-pack", "knowledge-base", "previewer", "ui-panel", "literature-provider", "workflow"]);
const CATEGORIES = new Set<PluginCategory>(["skills", "knowledge", "visualization", "analysis", "workflow", "other"]);
const PERMISSIONS = new Set<PluginPermission>(["read:workspace", "read:data", "compute:worker", "compute:container", "network"]);
const ENVIRONMENTS = new Set<PluginEnvironment>(["local", "cloud", "browser"]);

function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function stringArray(value: unknown): string[] | null { return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null; }
function uniqueIds(values: Array<{ id: string }>): boolean { return new Set(values.map((value) => value.id)).size === values.length; }
export function isSafePluginPath(value: string): boolean { return Boolean(value) && !value.startsWith("/") && !value.startsWith("\\") && !/^[A-Za-z]:/.test(value) && !value.split(/[\\/]/).includes(".."); }
export function previewerExtensions(value: PreviewerContribution): string[] { return value.match?.extensions ?? value.extensions ?? []; }

export function parsePluginManifest(value: unknown): PluginManifest | null {
  if (!object(value)) return null;
  const { id, version, apiVersion, displayName, description } = value;
  if (typeof id !== "string" || !ID.test(id) || typeof version !== "string" || valid(version) !== version || apiVersion !== PLUGIN_API_VERSION || typeof displayName !== "string" || !displayName.trim() || typeof description !== "string" || !description.trim()) return null;
  const kind = value.kind === undefined ? undefined : value.kind;
  if (kind !== undefined && (typeof kind !== "string" || !KINDS.has(kind as LegacyPluginKind))) return null;
  const categories = value.categories === undefined ? undefined : stringArray(value.categories);
  if (categories?.some((category) => !CATEGORIES.has(category as PluginCategory))) return null;
  const permissions = value.permissions === undefined ? undefined : stringArray(value.permissions);
  if (permissions?.some((permission) => !PERMISSIONS.has(permission as PluginPermission))) return null;
  let contributes: PluginContributions | undefined;
  if (value.contributes !== undefined) {
    if (!object(value.contributes)) return null;
    contributes = { ...value.contributes };
    if (value.contributes.previewers !== undefined) {
      if (!Array.isArray(value.contributes.previewers)) return null;
      const previewers: PreviewerContribution[] = [];
      for (const raw of value.contributes.previewers) {
        if (!object(raw) || typeof raw.id !== "string" || !raw.id.trim() || typeof raw.entry !== "string" || !isSafePluginPath(raw.entry)) return null;
        if (raw.mode !== undefined && raw.mode !== "readonly" && raw.mode !== "editable") return null;
        if (raw.delivery !== undefined && raw.delivery !== "whole" && raw.delivery !== "range" && raw.delivery !== "derived") return null;
        if (raw.priority !== undefined && (typeof raw.priority !== "number" || !Number.isFinite(raw.priority))) return null;
        const legacy = raw.extensions === undefined ? undefined : stringArray(raw.extensions);
        if (raw.extensions !== undefined && !legacy) return null;
        let match: PreviewerMatch | undefined;
        if (raw.match !== undefined) {
          if (!object(raw.match)) return null;
          const extensions = raw.match.extensions === undefined ? undefined : stringArray(raw.match.extensions);
          const mimeTypes = raw.match.mimeTypes === undefined ? undefined : stringArray(raw.match.mimeTypes);
          if ((raw.match.extensions !== undefined && !extensions) || (raw.match.mimeTypes !== undefined && !mimeTypes)) return null;
          let dataset: PreviewerMatch["dataset"];
          if (typeof raw.match.dataset === "string") dataset = raw.match.dataset;
          else if (raw.match.dataset !== undefined) {
            if (!object(raw.match.dataset) || raw.match.dataset.kind !== "stem-siblings") return null;
            const companions = stringArray(raw.match.dataset.companions);
            const required = raw.match.dataset.required === undefined ? undefined : stringArray(raw.match.dataset.required);
            if (!companions || companions.some((suffix) => !suffix.startsWith(".")) || (raw.match.dataset.required !== undefined && !required)) return null;
            dataset = { kind: "stem-siblings", companions, ...(required ? { required } : {}) };
          }
          match = { ...(extensions ? { extensions } : {}), ...(mimeTypes ? { mimeTypes } : {}), ...(dataset ? { dataset } : {}) };
        }
        const extensions = match?.extensions ?? legacy ?? [];
        if (extensions.length === 0 || extensions.some((extension) => !extension.startsWith("."))) return null;
        previewers.push({ id: raw.id, entry: raw.entry, match: { ...match, extensions }, ...(typeof raw.priority === "number" ? { priority: raw.priority } : {}), ...(raw.mode ? { mode: raw.mode as "readonly" | "editable" } : {}), ...(raw.delivery ? { delivery: raw.delivery as PreviewerContribution["delivery"] } : {}) });
      }
      if (!uniqueIds(previewers)) return null;
      contributes.previewers = previewers;
    }
    const entryGroups = [
      ["skills", false], ["knowledgeBases", true], ["panels", true], ["literatureProviders", true], ["workflows", true],
    ] as const;
    for (const [key, titleRequired] of entryGroups) {
      const group = value.contributes[key];
      if (group === undefined) continue;
      if (!Array.isArray(group)) return null;
      const normalized: Array<Record<string, unknown>> = [];
      for (const item of group) {
        if (!object(item) || typeof item.id !== "string" || !item.id.trim() || typeof item.entry !== "string" || !isSafePluginPath(item.entry)) return null;
        const title = typeof item.title === "string" && item.title.trim() ? item.title.trim() : titleRequired ? null : item.id;
        if (!title) return null;
        normalized.push({ ...item, id: item.id, title, entry: item.entry });
      }
      if (!uniqueIds(normalized as Array<{ id: string }>)) return null;
      contributes[key] = normalized as never;
    }
    if (value.contributes.agentInstructions !== undefined) {
      if (!Array.isArray(value.contributes.agentInstructions)) return null;
      const instructions: AgentInstructionContribution[] = [];
      for (const item of value.contributes.agentInstructions) {
        if (!object(item) || typeof item.id !== "string" || !item.id.trim() || typeof item.title !== "string" || !item.title.trim() || typeof item.entry !== "string" || !isSafePluginPath(item.entry)) return null;
        const targets = stringArray(item.targets);
        if (!targets?.length || targets.some((target) => !target.trim()) || item.mode !== "append") return null;
        if (item.priority !== undefined && (typeof item.priority !== "number" || !Number.isFinite(item.priority))) return null;
        instructions.push({ id: item.id, title: item.title.trim(), entry: item.entry, targets, mode: "append", ...(typeof item.priority === "number" ? { priority: item.priority } : {}) });
      }
      if (!uniqueIds(instructions)) return null;
      contributes.agentInstructions = instructions;
    }
  }
  const engines = object(value.engines) && typeof value.engines.brainpilot === "string" ? { brainpilot: value.engines.brainpilot } : undefined;
  let protocols: Record<string, string> | undefined;
  if (value.protocols !== undefined) {
    if (!object(value.protocols)) return null;
    protocols = {};
    for (const [name, version] of Object.entries(value.protocols)) {
      if (!name.trim() || typeof version !== "string" || !version.trim()) return null;
      protocols[name] = version.trim();
    }
  }
  const environments = value.environments === undefined ? undefined : stringArray(value.environments);
  if (environments?.some((environment) => !ENVIRONMENTS.has(environment as PluginEnvironment))) return null;
  let dependencies: PluginDependency[] | undefined;
  if (value.dependencies !== undefined) {
    if (!Array.isArray(value.dependencies)) return null;
    dependencies = [];
    for (const dependency of value.dependencies) {
      if (!object(dependency) || typeof dependency.id !== "string" || !ID.test(dependency.id) || typeof dependency.version !== "string" || !isBrainPilotVersionRange(dependency.version) || (dependency.optional !== undefined && typeof dependency.optional !== "boolean")) return null;
      dependencies.push({ id: dependency.id, version: dependency.version, ...(dependency.optional === true ? { optional: true } : {}) });
    }
    if (!uniqueIds(dependencies) || dependencies.some((dependency) => dependency.id === id)) return null;
  }
  const conflicts = value.conflicts === undefined ? undefined : stringArray(value.conflicts);
  if (conflicts?.some((conflict) => !ID.test(conflict) || conflict === id)) return null;
  return { id, version, apiVersion: PLUGIN_API_VERSION, displayName: displayName.trim(), description: description.trim(), ...(categories ? { categories: [...new Set(categories)] as PluginCategory[] } : {}), ...(kind ? { kind: kind as LegacyPluginKind } : {}), ...(engines ? { engines } : {}), ...(protocols ? { protocols } : {}), ...(environments ? { environments: [...new Set(environments)] as PluginEnvironment[] } : {}), ...(dependencies ? { dependencies } : {}), ...(conflicts ? { conflicts: [...new Set(conflicts)] } : {}), ...(permissions ? { permissions: [...new Set(permissions)] as PluginPermission[] } : {}), ...(contributes ? { contributes } : {}) };
}

/** Marketplace publication is stricter than legacy installation parsing. */
export function parsePublishablePluginManifest(value: unknown): PluginManifest | null {
  const manifest = parsePluginManifest(value);
  return manifest?.engines?.brainpilot && isBrainPilotVersionRange(manifest.engines.brainpilot) ? manifest : null;
}

export function isPreviewPluginMessage(value: unknown): value is PreviewPluginToHostMessage {
  if (!object(value) || value.rpcVersion !== PREVIEW_RPC_VERSION || typeof value.token !== "string" || typeof value.type !== "string") return false;
  if (value.type === "preview/read-range") return typeof value.requestId === "string" && typeof value.handle === "string" && typeof value.offset === "number" && value.offset >= 0 && typeof value.length === "number" && value.length > 0;
  return value.type === "preview/ready" || value.type === "preview/rendered" || value.type === "preview/error" || value.type === "preview/resize";
}

export function isBrainPilotVersionRange(range: string | undefined): range is string {
  return Boolean(range?.trim()) && validRange(range) !== null;
}

/** Standard npm SemVer range compatibility. */
export function isBrainPilotVersionCompatible(range: string | undefined, current: string): boolean {
  if (!range?.trim()) return true;
  return valid(current) !== null && satisfies(current, range);
}
