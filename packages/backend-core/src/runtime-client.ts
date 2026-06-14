/**
 * RuntimeClient — thin typed HTTP client over `RUNTIME_ROUTES`
 * (TS_PI_REFACTOR_DESIGN §15.4). Two responsibilities:
 *
 *  1. REST forwarding — build the runtime URL from a route name + params and
 *     forward method/headers/body. Per 修正4, the backend is a byte-level
 *     passthrough: we do NOT re-validate runtime responses, we return them as
 *     they are. Protocol schemas only TYPE the calls.
 *
 *  2. SSE passthrough — open the runtime's event stream and hand back the raw
 *     `Response` whose `body` is a byte `ReadableStream`. The caller pipes
 *     those bytes straight to the browser without parsing (no state held).
 */
import { RUNTIME_ROUTES, type RuntimeRouteName } from "@brainpilot/protocol";

export interface RuntimeClientOptions {
  /** Runtime base URL, e.g. http://127.0.0.1:8081. No trailing slash. */
  baseUrl: string;
  /** Injectable fetch (for tests). Defaults to global fetch. */
  fetchFn?: typeof fetch;
}

/** Fill `:param` placeholders in a route path template. */
export function buildPath(
  template: string,
  params: Record<string, string> = {},
): string {
  return template.replace(/:([A-Za-z0-9_]+)/g, (_m, key: string) => {
    const value = params[key];
    if (value === undefined) {
      throw new Error(`missing path param ":${key}" for "${template}"`);
    }
    return encodeURIComponent(value);
  });
}

export interface ForwardOptions {
  params?: Record<string, string>;
  /** Raw, already-serialized request body to forward. */
  body?: string | null;
  headers?: Record<string, string>;
  /** Query string to append (without leading `?`). */
  query?: string;
  signal?: AbortSignal;
}

export class RuntimeClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: RuntimeClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchFn = options.fetchFn ?? fetch;
  }

  /** Resolve a route name to a concrete URL. */
  urlFor(route: RuntimeRouteName, params?: Record<string, string>, query?: string): string {
    const def = RUNTIME_ROUTES[route];
    const path = buildPath(def.path, params);
    return `${this.baseUrl}${path}${query ? `?${query}` : ""}`;
  }

  /**
   * Forward a REST call to the runtime and return the raw `Response`. The body
   * is NOT parsed or validated here (修正4); callers stream/relay it as-is.
   */
  async forward(route: RuntimeRouteName, opts: ForwardOptions = {}): Promise<Response> {
    const def = RUNTIME_ROUTES[route];
    const url = this.urlFor(route, opts.params, opts.query);
    return this.fetchFn(url, {
      method: def.method,
      headers: opts.headers,
      body: opts.body ?? undefined,
      signal: opts.signal,
    });
  }

  /**
   * Open the runtime SSE stream for a session. Returns the raw `Response`;
   * `response.body` is a byte `ReadableStream` the caller pipes to the client.
   * Defaults to the canonical `/sse/:id` route (§15.4).
   */
  async openSse(
    sessionId: string,
    opts: { route?: RuntimeRouteName; query?: string; signal?: AbortSignal } = {},
  ): Promise<Response> {
    const route = opts.route ?? "sessionEvents";
    const url = this.urlFor(route, { id: sessionId, sessionId }, opts.query);
    return this.fetchFn(url, {
      method: "GET",
      headers: { accept: "text/event-stream" },
      signal: opts.signal,
    });
  }
}
