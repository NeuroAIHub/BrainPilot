import { AgentStatus, ChatMessage, TraceGraph } from "./backend";

/**
 * Portable "live demo" bundle — a single self-contained JSON file capturing a
 * session's conversation, reasoning/trace graph, and produced files so it can be
 * shared and replayed offline (in-app import). See the demo player in
 * components/demo/DemoView.tsx.
 */

export const DEMO_BUNDLE_FORMAT = "neuro-demo-bundle";
export const DEMO_BUNDLE_VERSION = 1;

/** Per-file embed cap (original bytes). Larger files are recorded but skipped. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
/** Total embed budget, counted on encoded (base64/utf8) length. */
export const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
/** Maximum encoded raw-event timeline retained in one bundle. */
export const MAX_TIMELINE_BYTES = 12 * 1024 * 1024;
/** Hard limit for a complete imported or generated bundle. */
export const MAX_DEMO_BUNDLE_BYTES = 40 * 1024 * 1024;

/** A raw AG-UI event line from frontend_events.jsonl, carrying a real `_ts`. */
export interface RawAgUiEvent {
  _ts?: string | number;
  type: string;
  [key: string]: unknown;
}

export interface DemoFile {
  /** Workspace-relative path, e.g. "results/fig1.png". */
  path: string;
  /** Best-effort MIME from the extension. */
  mime: string;
  encoding: "utf8" | "base64";
  /** Original byte size. */
  size: number;
  /** True when the file was not embedded (too large, over budget, or unreadable). */
  truncated: boolean;
  /** Why it was not embedded — distinguishes a real size cap from a read failure. */
  reason?: "tooLarge" | "unreadable";
  /** Human-readable detail for `reason: "unreadable"` (e.g. the backend error). */
  detail?: string;
  /** Omitted when truncated. */
  data?: string;
}

export interface DemoBundle {
  format: typeof DEMO_BUNDLE_FORMAT;
  version: number;
  exportedAt: string;
  appVersion?: string;
  /** "timestamped" = real `events`; "ordered" = pre-folded `messages` fallback. */
  timeline: "timestamped" | "ordered";
  /**
   * Whether a running sandbox was available at pack time to read produced files.
   * When false, every produced file is recorded as `unreadable` — re-packing
   * later with a sandbox running yields the real bytes, so the cache must not
   * serve such a bundle once a sandbox becomes available (see DemoView cache
   * lookup). Optional for backward compatibility with older bundles.
   */
  packedWithSandbox?: boolean;

  session: {
    id: string;
    title: string;
    createdAt?: string;
    updatedAt?: string;
  };

  /** Present iff timeline === "timestamped". Folded by the player at replay. */
  events?: RawAgUiEvent[];
  /** Present iff timeline === "ordered". Already folded ChatMessages. */
  messages?: ChatMessage[];

  trace: TraceGraph;
  agents: AgentStatus[];
  files: DemoFile[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRawEvent(value: unknown): value is RawAgUiEvent {
  return (
    isRecord(value) &&
    typeof value.type === "string" &&
    (value._ts === undefined || typeof value._ts === "string" || typeof value._ts === "number")
  );
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === "string" &&
    (value.role === "user" || value.role === "assistant" || value.role === "system") &&
    typeof value.content === "string" &&
    typeof value.createdAt === "string"
  );
}

function isTraceNode(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.type === "string" &&
    typeof value.status === "string" &&
    Array.isArray(value.parents) &&
    value.parents.every((parent) => isRecord(parent) && typeof parent.id === "string") &&
    Array.isArray(value.artifacts) &&
    value.artifacts.every((artifact) => isRecord(artifact) && typeof artifact.path === "string") &&
    isStringArray(value.parentIds) &&
    isStringArray(value.childIds) &&
    isStringArray(value.toolCalls)
  );
}

function isTraceGraph(value: unknown): value is TraceGraph {
  return (
    isRecord(value) &&
    isRecord(value.meta) &&
    typeof value.meta.sessionId === "string" &&
    Array.isArray(value.nodes) &&
    value.nodes.every(isTraceNode)
  );
}

function isAgent(value: unknown): value is AgentStatus {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.status === "string" &&
    typeof value.task === "string"
  );
}

function isDemoFile(value: unknown): value is DemoFile {
  if (!isRecord(value)) {
    return false;
  }
  const reasonValid =
    value.reason === undefined || value.reason === "tooLarge" || value.reason === "unreadable";
  const dataValid =
    (value.data === undefined || typeof value.data === "string") &&
    (value.truncated === true || typeof value.data === "string");
  return (
    typeof value.path === "string" &&
    typeof value.mime === "string" &&
    (value.encoding === "utf8" || value.encoding === "base64") &&
    typeof value.size === "number" &&
    Number.isFinite(value.size) &&
    value.size >= 0 &&
    typeof value.truncated === "boolean" &&
    reasonValid &&
    dataValid
  );
}

/** Strict runtime validation for untrusted imported bundles. */
export function isDemoBundle(value: unknown): value is DemoBundle {
  if (!isRecord(value)) {
    return false;
  }
  if (
    value.format !== DEMO_BUNDLE_FORMAT ||
    value.version !== DEMO_BUNDLE_VERSION ||
    typeof value.exportedAt !== "string" ||
    !Number.isFinite(Date.parse(value.exportedAt)) ||
    (value.appVersion !== undefined && typeof value.appVersion !== "string") ||
    (value.packedWithSandbox !== undefined && typeof value.packedWithSandbox !== "boolean") ||
    !isRecord(value.session) ||
    typeof value.session.id !== "string" ||
    typeof value.session.title !== "string" ||
    (value.session.createdAt !== undefined && typeof value.session.createdAt !== "string") ||
    (value.session.updatedAt !== undefined && typeof value.session.updatedAt !== "string") ||
    !isTraceGraph(value.trace) ||
    !Array.isArray(value.agents) ||
    !value.agents.every(isAgent) ||
    !Array.isArray(value.files) ||
    !value.files.every(isDemoFile)
  ) {
    return false;
  }
  if (value.timeline === "timestamped") {
    return Array.isArray(value.events) && value.events.every(isRawEvent);
  }
  if (value.timeline === "ordered") {
    return Array.isArray(value.messages) && value.messages.every(isChatMessage);
  }
  return false;
}
