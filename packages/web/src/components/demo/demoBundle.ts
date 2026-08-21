import type { AgentStatus, ChatMessage, TraceNode } from "../../contracts/backend";
import {
  DEMO_BUNDLE_FORMAT,
  DEMO_BUNDLE_VERSION,
  DemoBundle,
  DemoFile,
  MAX_DEMO_BUNDLE_BYTES,
  MAX_FILE_BYTES,
  MAX_TIMELINE_BYTES,
  MAX_TOTAL_BYTES,
  isDemoBundle,
} from "../../contracts/demoBundle";
import { api } from "../../utils/api";
import { getPreviewKind, mimeFromName } from "../files/filePreview";

export interface BuildDemoOptions {
  session: { id: string; title: string; createdAt?: string; updatedAt?: string };
  /**
   * Whether the selected session's files are currently accessible. When false
   * (no running sandbox), the conversation / trace / events are still packed
   * from host-persisted storage and every produced file is recorded as
   * unreadable. The actual file-route id is always `session.id`, which prevents
   * a container/sandbox id from accidentally addressing the wrong workspace.
   */
  filesAvailable?: boolean;
  /** In-memory folded messages, used only when no timestamped events exist. */
  fallbackMessages?: ChatMessage[];
  /** Detail shown on files that could not be read because no sandbox was available. */
  filesUnavailableDetail?: string;
  /** Progress notices for the UI (e.g. "packing 3 files…"). */
  onProgress?: (message: string) => void;
  /** Aborts the in-flight pack (e.g. the user navigated away). */
  signal?: AbortSignal;
}

/** Thrown when a pack is cancelled via its AbortSignal. */
export class PackAbortedError extends Error {
  constructor() {
    super("Demo pack aborted.");
    this.name = "PackAbortedError";
  }
}

/** Thrown when generated/imported data would create an unsafe in-memory bundle. */
export class DemoBundleTooLargeError extends Error {
  constructor(section: "timeline" | "bundle") {
    const limit = section === "timeline" ? MAX_TIMELINE_BYTES : MAX_DEMO_BUNDLE_BYTES;
    super(`Live Demo ${section} exceeds the ${Math.floor(limit / 1024 / 1024)} MB limit.`);
    this.name = "DemoBundleTooLargeError";
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new PackAbortedError();
  }
}

/** Max concurrent sandbox file reads while packing. */
const FILE_FETCH_CONCURRENCY = 6;

/**
 * Map `items` through `worker` with at most `limit` in flight at once. Results
 * preserve input order. Stops launching new work once `signal` is aborted.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const run = async (): Promise<void> => {
    while (next < items.length) {
      const current = next;
      next += 1;
      throwIfAborted(signal);
      results[current] = await worker(items[current], current);
    }
  };
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => run());
  await Promise.all(workers);
  return results;
}

/** Normalize a trace artifact path to one of the file API's supported roots. */
export function toDemoFilePath(path: string): string {
  // Preserve explicit roots. `/data` and `/shared` are first-class file API
  // roots, not directories inside the per-session workspace.
  if (/^\/(workspace|data|shared)(?:\/|$)/.test(path)) {
    return path;
  }
  // Tolerate root-qualified paths without a leading slash.
  if (/^(workspace|data|shared)(?:\/|$)/.test(path)) {
    return `/${path}`;
  }
  // Unknown absolute paths and bare relative paths are workspace artifacts.
  const rel = path.replace(/^\/+/, "").replace(/^\.\//, "");
  return `/workspace/${rel}`;
}

type DemoArtifactLike = { path?: string; type?: string };

/** Shared artifact gate for both bundle packing and replay. */
export function isDemoFileArtifact(
  artifact: DemoArtifactLike,
): artifact is DemoArtifactLike & { path: string } {
  const path = artifact.path?.trim();
  return Boolean(
    path
    && artifact.type !== "dir"
    && artifact.type !== "checkpoint"
    && !path.startsWith("checkpoint:"),
  );
}

/** Collect only real files, deduped by the canonical file-API path. */
export function collectDemoArtifactPaths(
  nodes: ReadonlyArray<{ artifacts?: ReadonlyArray<{ path?: string; type?: string }> }>,
): string[] {
  const seenCanonical = new Set<string>();
  const paths: string[] = [];
  for (const node of nodes) {
    for (const artifact of node.artifacts ?? []) {
      if (!isDemoFileArtifact(artifact)) continue;
      const rawPath = artifact.path.trim();
      const canonical = toDemoFilePath(rawPath);
      if (seenCanonical.has(canonical)) continue;
      seenCanonical.add(canonical);
      paths.push(rawPath);
    }
  }
  return paths;
}

/**
 * Resolve Trace artifact aliases onto the exact path spelling retained in
 * bundle.files. Pseudo artifacts and paths absent from the bundle disappear,
 * so every replay consumer can safely use exact string identity afterwards.
 */
export function normalizeDemoReplayNodes(
  nodes: readonly TraceNode[],
  files: ReadonlyArray<Pick<DemoFile, "path">>,
): TraceNode[] {
  const retainedPathByCanonical = new Map(
    files.map((file) => [toDemoFilePath(file.path), file.path]),
  );
  return nodes.map((node) => {
    const seen = new Set<string>();
    const artifacts = node.artifacts.flatMap((artifact) => {
      if (!isDemoFileArtifact(artifact)) return [];
      const retainedPath = retainedPathByCanonical.get(toDemoFilePath(artifact.path.trim()));
      if (!retainedPath || seen.has(retainedPath)) return [];
      seen.add(retainedPath);
      return [{ ...artifact, path: retainedPath }];
    });
    return { ...node, artifacts };
  });
}

/** Clean file entries produced by older v1 exporters before replay or re-export. */
function normalizeImportedDemoFiles(files: readonly DemoFile[]): DemoFile[] {
  const seenCanonical = new Set<string>();
  const retained: DemoFile[] = [];
  for (const file of files) {
    if (!isDemoFileArtifact(file)) continue;
    const path = file.path.trim();
    const canonical = toDemoFilePath(path);
    if (seenCanonical.has(canonical)) continue;
    seenCanonical.add(canonical);
    retained.push(path === file.path ? file : { ...file, path });
  }
  return retained;
}

/** Chunked base64 encode of binary data (avoids call-stack overflow). */
async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const end = Math.min(i + chunk, bytes.length);
    // Build the chunk with an explicit loop rather than
    // String.fromCharCode(...subarray): the spread pushes every byte as a
    // separate argument, and a 32 KB chunk sits close to some engines' argument
    // limit — a per-byte loop has no such ceiling and is allocation-free.
    for (let j = i; j < end; j += 1) {
      binary += String.fromCharCode(bytes[j]);
    }
  }
  return btoa(binary);
}

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function assertTimelineFits(events: unknown[]): void {
  // Measure each event separately and stop at the limit. This avoids creating a
  // second giant JSON string just to discover that a full history is too large.
  let bytes = 2; // opening + closing array brackets
  for (const event of events) {
    bytes += utf8ByteLength(JSON.stringify(event)) + 1; // comma allowance
    if (bytes > MAX_TIMELINE_BYTES) {
      throw new DemoBundleTooLargeError("timeline");
    }
  }
}

/**
 * Outcome of fetching + encoding a single file, before the total-size budget is
 * applied. An "ok" candidate carries the embeddable `data` (utf8 text or base64)
 * and its `encodedLen`; the caller decides whether it fits the total budget.
 */
type FileCandidate =
  | { path: string; mime: string; encoding: "utf8" | "base64"; status: "ok"; size: number; encodedLen: number; data: string }
  | { path: string; mime: string; encoding: "utf8" | "base64"; status: "tooLarge"; size: number }
  | { path: string; mime: string; encoding: "utf8" | "base64"; status: "unreadable"; detail?: string };

/** Fetch + encode one file, applying only the per-file cap (not the total). */
async function fetchCandidate(fileSessionId: string, rawPath: string): Promise<FileCandidate> {
  const path = toDemoFilePath(rawPath);
  const name = path.split("/").pop() ?? path;
  const mime = mimeFromName(name);
  const isText = getPreviewKind(name) === "text";
  const encoding: "utf8" | "base64" = isText ? "utf8" : "base64";
  try {
    if (isText) {
      const content = await api.sandbox.readFile(fileSessionId, path);
      const size = content.size ?? utf8ByteLength(content.content);
      const encodedLen = utf8ByteLength(content.content);
      if (size > MAX_FILE_BYTES) {
        return { path: rawPath, mime, encoding, status: "tooLarge", size };
      }
      return { path: rawPath, mime, encoding, status: "ok", size, encodedLen, data: content.content };
    }
    const blob = await api.sandbox.readRawFile(fileSessionId, path);
    const size = blob.size;
    if (size > MAX_FILE_BYTES) {
      return { path: rawPath, mime, encoding, status: "tooLarge", size };
    }
    const data = await blobToBase64(blob);
    return { path: rawPath, mime, encoding, status: "ok", size, encodedLen: data.length, data };
  } catch (err) {
    // Read failed (missing, path rejected, outside workspace, wrong sandbox).
    // Record it as unreadable — NOT as "too large" — so the player can show an
    // honest reason instead of a misleading size notice.
    return { path: rawPath, mime, encoding, status: "unreadable", detail: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Collect the produced-file set referenced by the trace, fetch each, and embed
 * it (utf8 for text, base64 for binary) honoring per-file and total size caps.
 *
 * Files are fetched + encoded concurrently (bounded by FILE_FETCH_CONCURRENCY)
 * for speed, but the total-size budget is then applied in deterministic path
 * order so the same session always packs to the same bundle regardless of which
 * read finished first.
 */
async function collectFiles(
  fileSessionId: string | undefined,
  paths: string[],
  onProgress?: (message: string) => void,
  unavailableDetail?: string,
  signal?: AbortSignal,
): Promise<DemoFile[]> {
  // No running sandbox to read from: the file bytes live in a sandbox workspace
  // we can't reach right now. Record each as unreadable (with an honest reason)
  // instead of failing the whole export — the conversation, trace and events
  // still pack fine from host-persisted storage.
  if (!fileSessionId) {
    return paths.map((rawPath) => {
      const name = toDemoFilePath(rawPath).split("/").pop() ?? rawPath;
      return {
        path: rawPath,
        mime: mimeFromName(name),
        encoding: getPreviewKind(name) === "text" ? "utf8" : "base64",
        size: 0,
        truncated: true,
        reason: "unreadable" as const,
        detail: unavailableDetail,
      };
    });
  }

  let done = 0;
  const candidates = await mapWithConcurrency(
    paths,
    FILE_FETCH_CONCURRENCY,
    async (rawPath) => {
      const candidate = await fetchCandidate(fileSessionId, rawPath);
      done += 1;
      onProgress?.(`packing ${done}/${paths.length}: ${rawPath.split("/").pop() ?? rawPath}`);
      return candidate;
    },
    signal,
  );

  // Apply the total embed budget in path order (deterministic, fetch-order
  // independent). A file that would push past the budget is recorded tooLarge.
  let totalEncoded = 0;
  return candidates.map((c): DemoFile => {
    if (c.status === "unreadable") {
      return { path: c.path, mime: c.mime, encoding: c.encoding, size: 0, truncated: true, reason: "unreadable", detail: c.detail };
    }
    if (c.status === "tooLarge") {
      return { path: c.path, mime: c.mime, encoding: c.encoding, size: c.size, truncated: true, reason: "tooLarge" };
    }
    if (totalEncoded + c.encodedLen > MAX_TOTAL_BYTES) {
      return { path: c.path, mime: c.mime, encoding: c.encoding, size: c.size, truncated: true, reason: "tooLarge" };
    }
    totalEncoded += c.encodedLen;
    return { path: c.path, mime: c.mime, encoding: c.encoding, size: c.size, truncated: false, data: c.data };
  });
}

/** Build a portable demo bundle for an arbitrary session. */
export async function buildDemoBundle(opts: BuildDemoOptions): Promise<DemoBundle> {
  const { session, filesAvailable = false, fallbackMessages, filesUnavailableDetail, onProgress, signal } = opts;

  throwIfAborted(signal);
  onProgress?.("reading reasoning trace…");
  const trace = await api.sessions.getTrace(session.id);

  let appVersion: string | undefined;
  try {
    appVersion = (await api.getVersion()).version;
  } catch {
    appVersion = undefined;
  }

  let agents: AgentStatus[] = [];
  try {
    agents = (await api.sessions.state(session.id)).agents;
  } catch {
    agents = [];
  }

  throwIfAborted(signal);
  onProgress?.("reading conversation timeline…");
  let timeline: DemoBundle["timeline"] = "timestamped";
  // Pull the persisted event timeline from the new history endpoint (the
  // legacy `/sessions/:id/events` path is an SSE alias and returns no JSON).
  // Request the FULL log (`limit: 0`) — same as the live chat rehydrate path
  // (HISTORY_REHYDRATE_LIMIT). A positive cap returns the *tail* of the log,
  // which slices off the oldest events: the leading TEXT_MESSAGE_START of the
  // earliest messages is dropped, leaving orphaned CONTENT/END that the
  // reducer can't attach to anything, so the conversation's opening replies
  // silently vanish from the replay. assertTimelineFits + the final whole-file
  // cap below keep requesting the full history from producing an unbounded
  // shareable bundle.
  const historyEnvelope = await api.sessions.getHistory(session.id, { limit: 0 });
  let events: typeof historyEnvelope.events | undefined = historyEnvelope.events;
  let messages: ChatMessage[] | undefined;
  if (!events || events.length === 0) {
    timeline = "ordered";
    events = undefined;
    messages = fallbackMessages ?? [];
  } else {
    assertTimelineFits(events);
  }

  // Trace also carries metadata pseudo-artifacts (for example
  // checkpoint:checkpoint_...). They are not workspace files and must never be
  // fetched or rendered in a replay.
  const paths = collectDemoArtifactPaths(trace.nodes);

  const files = await collectFiles(filesAvailable ? session.id : undefined, paths, onProgress, filesUnavailableDetail, signal);

  throwIfAborted(signal);
  onProgress?.("assembling bundle…");
  const bundle: DemoBundle = {
    format: DEMO_BUNDLE_FORMAT,
    version: DEMO_BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion,
    timeline,
    packedWithSandbox: filesAvailable,
    session: {
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    },
    events: timeline === "timestamped" ? events : undefined,
    messages: timeline === "ordered" ? messages : undefined,
    trace,
    agents,
    files,
  };
  if (utf8ByteLength(JSON.stringify(bundle)) > MAX_DEMO_BUNDLE_BYTES) {
    throw new DemoBundleTooLargeError("bundle");
  }
  return bundle;
}

/** Parse + validate an imported bundle file. Throws on invalid input. */
export function parseDemoBundle(text: string): DemoBundle {
  if (utf8ByteLength(text) > MAX_DEMO_BUNDLE_BYTES) {
    throw new DemoBundleTooLargeError("bundle");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON file.");
  }
  if (!isDemoBundle(parsed)) {
    throw new Error("Not a valid live-demo bundle.");
  }
  return {
    ...parsed,
    files: normalizeImportedDemoFiles(parsed.files),
  };
}
