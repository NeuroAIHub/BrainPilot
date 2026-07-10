import type { AgentStatus, ChatMessage } from "../../contracts/backend";
import {
  DEMO_BUNDLE_FORMAT,
  DEMO_BUNDLE_VERSION,
  DemoBundle,
  DemoFile,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  isDemoBundle,
} from "../../contracts/demoBundle";
import { api } from "../../utils/api";
import { getPreviewKind, mimeFromName } from "../files/filePreview";

export interface BuildDemoOptions {
  session: { id: string; title: string; createdAt?: string; updatedAt?: string };
  /**
   * The running sandbox to read produced files from. Optional: when absent (no
   * running sandbox), the conversation / trace / events are still packed from
   * host-persisted storage and every produced file is recorded as unreadable.
   */
  sandboxId?: string;
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

/** Normalize a trace artifact path to a sandbox `/workspace/...` path. */
function toWorkspacePath(path: string): string {
  if (path.startsWith("/workspace")) {
    return path;
  }
  // Absolute paths outside /workspace (e.g. "/data/out.csv", "/tmp/x") are
  // remapped under /workspace by their basename-bearing tail, since the sandbox
  // file API only serves /workspace. A bare relative path is joined directly.
  const rel = path.replace(/^\/+/, "").replace(/^\.\//, "");
  return `/workspace/${rel}`;
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
async function fetchCandidate(sandboxId: string, rawPath: string): Promise<FileCandidate> {
  const path = toWorkspacePath(rawPath);
  const name = path.split("/").pop() ?? path;
  const mime = mimeFromName(name);
  const isText = getPreviewKind(name) === "text";
  const encoding: "utf8" | "base64" = isText ? "utf8" : "base64";
  try {
    if (isText) {
      const content = await api.sandbox.readFile(sandboxId, path);
      const size = content.size ?? utf8ByteLength(content.content);
      const encodedLen = utf8ByteLength(content.content);
      if (size > MAX_FILE_BYTES) {
        return { path: rawPath, mime, encoding, status: "tooLarge", size };
      }
      return { path: rawPath, mime, encoding, status: "ok", size, encodedLen, data: content.content };
    }
    const blob = await api.sandbox.readRawFile(sandboxId, path);
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
  sandboxId: string | undefined,
  paths: string[],
  onProgress?: (message: string) => void,
  unavailableDetail?: string,
  signal?: AbortSignal,
): Promise<DemoFile[]> {
  // No running sandbox to read from: the file bytes live in a sandbox workspace
  // we can't reach right now. Record each as unreadable (with an honest reason)
  // instead of failing the whole export — the conversation, trace and events
  // still pack fine from host-persisted storage.
  if (!sandboxId) {
    return paths.map((rawPath) => {
      const name = toWorkspacePath(rawPath).split("/").pop() ?? rawPath;
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
      const candidate = await fetchCandidate(sandboxId, rawPath);
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
  const { session, sandboxId, fallbackMessages, filesUnavailableDetail, onProgress, signal } = opts;

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
  // silently vanish from the replay. The 25 MB embed budget (MAX_TOTAL_BYTES)
  // still bounds the bundle's real footprint via the files section.
  const historyEnvelope = await api.sessions.getHistory(session.id, { limit: 0 });
  let events: typeof historyEnvelope.events | undefined = historyEnvelope.events;
  let messages: ChatMessage[] | undefined;
  if (!events || events.length === 0) {
    timeline = "ordered";
    events = undefined;
    messages = fallbackMessages ?? [];
  }

  // Collect produced-file paths from trace artifacts (dedupe, skip dirs).
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const node of trace.nodes) {
    for (const artifact of node.artifacts ?? []) {
      if (!artifact.path || artifact.type === "dir") {
        continue;
      }
      if (!seen.has(artifact.path)) {
        seen.add(artifact.path);
        paths.push(artifact.path);
      }
    }
  }

  const files = await collectFiles(sandboxId, paths, onProgress, filesUnavailableDetail, signal);

  throwIfAborted(signal);
  onProgress?.("assembling bundle…");
  return {
    format: DEMO_BUNDLE_FORMAT,
    version: DEMO_BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion,
    timeline,
    packedWithSandbox: !!sandboxId,
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
}

/** Parse + validate an imported bundle file. Throws on invalid input. */
export function parseDemoBundle(text: string): DemoBundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON file.");
  }
  if (!isDemoBundle(parsed)) {
    throw new Error("Not a valid live-demo bundle.");
  }
  return parsed;
}
