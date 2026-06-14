/**
 * client.ts — a typed HTTP+SSE client over the BrainPilot Runtime contract
 * (TS_PI_REFACTOR_DESIGN §15.4). Drives a session without the web UI: create a
 * session, send a message, subscribe to the AG-UI event stream. Reusable in
 * integration smoke tests.
 *
 * Routes come from `@brainpilot/protocol` `RUNTIME_ROUTES` (SSOT) so this never
 * hardcodes path strings.
 */
import {
  RUNTIME_ROUTES,
  type AgUiEvent,
  type CreateSessionResponse,
  type SendMessageResponse,
} from "@brainpilot/protocol";

/** Fill `:id`-style params into a route path template. */
export function fillPath(
  template: string,
  params: Record<string, string> = {},
): string {
  return template.replace(/:([A-Za-z0-9_]+)/g, (_, name: string) => {
    const v = params[name];
    if (v === undefined) {
      throw new Error(`Missing path param ":${name}" for "${template}"`);
    }
    return encodeURIComponent(v);
  });
}

export interface BrainPilotClientOptions {
  /**
   * Base URL. For the backend use `http://localhost:9001/api`; for the runtime
   * directly use `http://localhost:8081`. No trailing slash required.
   */
  baseUrl?: string;
  /** Injectable fetch (tests). Defaults to global fetch. */
  fetchFn?: typeof fetch;
}

/** Default base URL — the backend's `/api` mount (§11A.3). */
export const DEFAULT_BASE_URL = "http://localhost:9001/api";

export class BrainPilotClient {
  readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: BrainPilotClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetchFn = options.fetchFn ?? fetch;
  }

  /** Build an absolute URL from a RUNTIME_ROUTES path template + params. */
  url(template: string, params?: Record<string, string>): string {
    return this.baseUrl + fillPath(template, params);
  }

  /** GET /health → true if reachable and ok. */
  async health(): Promise<boolean> {
    try {
      const res = await this.fetchFn(this.url(RUNTIME_ROUTES.health.path));
      return res.ok;
    } catch {
      return false;
    }
  }

  /** POST /sessions → the new session id. */
  async createSession(body: { id?: string; title?: string } = {}): Promise<string> {
    const res = await this.fetchFn(this.url(RUNTIME_ROUTES.createSession.path), {
      method: RUNTIME_ROUTES.createSession.method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`createSession failed: ${res.status} ${res.statusText}`);
    }
    const json = (await res.json()) as CreateSessionResponse;
    return json.id;
  }

  /** POST /sessions/:id/messages. */
  async sendMessage(
    sessionId: string,
    content: string,
    agent?: string,
  ): Promise<SendMessageResponse> {
    const res = await this.fetchFn(
      this.url(RUNTIME_ROUTES.sendMessage.path, { id: sessionId }),
      {
        method: RUNTIME_ROUTES.sendMessage.method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content, ...(agent ? { agent } : {}) }),
      },
    );
    if (!res.ok) {
      throw new Error(`sendMessage failed: ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as SendMessageResponse;
  }

  /**
   * Subscribe to the session's AG-UI event stream (GET /sse/:id). Yields
   * parsed events until the underlying stream ends or `signal` aborts.
   */
  async *streamEvents(
    sessionId: string,
    signal?: AbortSignal,
  ): AsyncGenerator<AgUiEvent> {
    const res = await this.fetchFn(
      this.url(RUNTIME_ROUTES.sessionEvents.path, { id: sessionId }),
      { headers: { accept: "text/event-stream" }, ...(signal ? { signal } : {}) },
    );
    if (!res.ok || res.body === null) {
      throw new Error(`stream failed: ${res.status} ${res.statusText}`);
    }
    yield* parseSseStream(res.body);
  }
}

/**
 * Parse a ReadableStream of SSE bytes into AG-UI events. Handles multi-line
 * `data:` frames split across chunk boundaries. Non-JSON `data` payloads and
 * comment lines (`:`) are skipped.
 */
export async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<AgUiEvent> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: true });
      // SSE frames are separated by a blank line.
      let sep: number;
      while ((sep = indexOfFrameBoundary(buffer)) !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep).replace(/^(\r?\n){1,2}/, "");
        const evt = decodeFrame(frame);
        if (evt) yield evt;
      }
      if (done) break;
    }
    // Flush any trailing frame without a terminating blank line.
    const evt = decodeFrame(buffer);
    if (evt) yield evt;
  } finally {
    reader.releaseLock();
  }
}

/** Find the index of the next frame boundary (blank line), or -1. */
function indexOfFrameBoundary(buf: string): number {
  const a = buf.indexOf("\n\n");
  const b = buf.indexOf("\r\n\r\n");
  if (a === -1) return b;
  if (b === -1) return a;
  return Math.min(a, b);
}

/** Decode one SSE frame's `data:` lines into an AgUiEvent, or null. */
function decodeFrame(frame: string): AgUiEvent | null {
  const dataLines = frame
    .split(/\r?\n/)
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).replace(/^ /, ""));
  if (dataLines.length === 0) return null;
  const payload = dataLines.join("\n").trim();
  if (payload === "" || payload === "[DONE]") return null;
  try {
    return JSON.parse(payload) as AgUiEvent;
  } catch {
    return null;
  }
}

/** True when an event is a terminal run boundary (used to stop driving). */
export function isTerminalEvent(evt: AgUiEvent): boolean {
  const t = (evt as { type?: string }).type;
  return t === "RUN_FINISHED" || t === "RUN_ERROR";
}
