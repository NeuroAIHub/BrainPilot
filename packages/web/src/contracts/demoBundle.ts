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

/** Runtime validation for imported bundles. */
export function isDemoBundle(value: unknown): value is DemoBundle {
  if (!value || typeof value !== "object") {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    v.format === DEMO_BUNDLE_FORMAT &&
    typeof v.version === "number" &&
    typeof v.session === "object" &&
    v.session !== null &&
    typeof v.trace === "object" &&
    v.trace !== null &&
    Array.isArray(v.files)
  );
}
