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
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Collect the produced-file set referenced by the trace, fetch each, and embed
 * it (utf8 for text, base64 for binary) honoring per-file and total size caps.
 */
async function collectFiles(
  sandboxId: string | undefined,
  paths: string[],
  onProgress?: (message: string) => void,
  unavailableDetail?: string,
): Promise<DemoFile[]> {
  const files: DemoFile[] = [];
  let totalEncoded = 0;
  let index = 0;
  for (const rawPath of paths) {
    index += 1;
    onProgress?.(`packing ${index}/${paths.length}: ${rawPath.split("/").pop() ?? rawPath}`);
    const path = toWorkspacePath(rawPath);
    const name = path.split("/").pop() ?? path;
    const mime = mimeFromName(name);
    const isText = getPreviewKind(name) === "text";
    // No running sandbox to read from: the file bytes live in a sandbox
    // workspace we can't reach right now. Record each as unreadable (with an
    // honest reason) instead of failing the whole export — the conversation,
    // trace and events still pack fine from host-persisted storage.
    if (!sandboxId) {
      files.push({
        path: rawPath,
        mime,
        encoding: isText ? "utf8" : "base64",
        size: 0,
        truncated: true,
        reason: "unreadable",
        detail: unavailableDetail,
      });
      continue;
    }
    try {
      if (isText) {
        const content = await api.sandbox.readFile(sandboxId, path);
        const size = content.size ?? utf8ByteLength(content.content);
        const encodedLen = utf8ByteLength(content.content);
        if (size > MAX_FILE_BYTES || totalEncoded + encodedLen > MAX_TOTAL_BYTES) {
          files.push({ path: rawPath, mime, encoding: "utf8", size, truncated: true, reason: "tooLarge" });
          continue;
        }
        totalEncoded += encodedLen;
        files.push({ path: rawPath, mime, encoding: "utf8", size, truncated: false, data: content.content });
      } else {
        const blob = await api.sandbox.readRawFile(sandboxId, path);
        const size = blob.size;
        if (size > MAX_FILE_BYTES) {
          files.push({ path: rawPath, mime, encoding: "base64", size, truncated: true, reason: "tooLarge" });
          continue;
        }
        const data = await blobToBase64(blob);
        if (totalEncoded + data.length > MAX_TOTAL_BYTES) {
          files.push({ path: rawPath, mime, encoding: "base64", size, truncated: true, reason: "tooLarge" });
          continue;
        }
        totalEncoded += data.length;
        files.push({ path: rawPath, mime, encoding: "base64", size, truncated: false, data });
      }
    } catch (err) {
      // Read failed (missing, path rejected, outside workspace, wrong sandbox).
      // Record it as unreadable — NOT as "too large" — so the player can show
      // an honest reason instead of a misleading size notice.
      files.push({
        path: rawPath,
        mime,
        encoding: isText ? "utf8" : "base64",
        size: 0,
        truncated: true,
        reason: "unreadable",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return files;
}

/** Build a portable demo bundle for an arbitrary session. */
export async function buildDemoBundle(opts: BuildDemoOptions): Promise<DemoBundle> {
  const { session, sandboxId, fallbackMessages, filesUnavailableDetail, onProgress } = opts;

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

  onProgress?.("reading conversation timeline…");
  let timeline: DemoBundle["timeline"] = "timestamped";
  let events = await api.sessions.getEvents(session.id);
  let messages: ChatMessage[] | undefined;
  if (!events || events.length === 0) {
    timeline = "ordered";
    events = undefined as never;
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

  const files = await collectFiles(sandboxId, paths, onProgress, filesUnavailableDetail);

  onProgress?.("assembling bundle…");
  return {
    format: DEMO_BUNDLE_FORMAT,
    version: DEMO_BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion,
    timeline,
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
