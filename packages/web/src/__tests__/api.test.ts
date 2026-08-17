import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { api } from "../utils/api";
import {
  normalizeProviderProfile,
  serializeProviderCreate,
  serializeProviderUpdate,
} from "../contracts/backend";

// These exercise the real-fetch path (runtimeConfig.useMockBackend is false in
// tests — VITE_USE_MOCK_BACKEND is unset). We stub globalThis.fetch and a
// minimal localStorage so authHeaders()/getStoredToken() don't blow up in the
// node test environment.

type FetchResponseInit = {
  ok?: boolean;
  status?: number;
  contentType?: string;
  json?: unknown;
  /** When set, res.json() rejects with this (mirrors a non-JSON body). */
  jsonThrows?: boolean;
};

function makeResponse(init: FetchResponseInit): Response {
  const status = init.status ?? (init.ok === false ? 500 : 200);
  const ok = init.ok ?? (status >= 200 && status < 300);
  const headers = new Map<string, string>();
  if (init.contentType) headers.set("content-type", init.contentType);
  return {
    ok,
    status,
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    json: async () => {
      if (init.jsonThrows) throw new SyntaxError("Unexpected token '<'");
      return init.json;
    },
    text: async () => (typeof init.json === "string" ? init.json : JSON.stringify(init.json ?? "")),
    clone: () => makeResponse(init),
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("provider context-window contract", () => {
  it("serializes presets and uses null to restore automatic mode", () => {
    expect(serializeProviderCreate({
      name: "Long",
      baseUrl: "https://gw.example",
      apiKey: "key",
      contextWindow: 1_000_000,
    })).toMatchObject({ context_window: 1_000_000 });
    expect(serializeProviderUpdate({ contextWindow: null })).toEqual({ context_window: null });
  });

  it("normalizes the provider context window from snake_case", () => {
    const profile = normalizeProviderProfile({
      id: "p",
      name: "Long",
      models: ["m"],
      context_window: 262_144,
    });
    expect(profile.contextWindow).toBe(262_144);
  });
});

describe("api.sessions.list — unwraps { sessions } and tolerates shape", () => {
  it("unwraps the runtime's { sessions: [...] } envelope", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({ contentType: "application/json", json: { sessions: [{ id: "a" }, { id: "b" }] } }),
    );
    const out = await api.sessions.list();
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe("a");
  });

  it("tolerates a bare array response (legacy / mock shape)", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({ contentType: "application/json", json: [{ id: "x" }] }),
    );
    const out = await api.sessions.list();
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("x");
  });

  it("returns [] (never throws .map) for an unexpected shape", async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ contentType: "application/json", json: {} }));
    await expect(api.sessions.list()).resolves.toEqual([]);
  });

  it("returns [] for a null body", async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ contentType: "application/json", json: null }));
    await expect(api.sessions.list()).resolves.toEqual([]);
  });

  // handleJson guard: a 200 that isn't JSON (SPA index.html fallback for an
  // endpoint missing on this deployment) must throw a readable message, NOT the
  // raw "Unexpected token '<'" SyntaxError that res.json() would raise.
  it("throws a readable error (not a JSON SyntaxError) when a 200 returns non-JSON", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({ contentType: "text/html", jsonThrows: true, json: "<!doctype html>" }),
    );
    await expect(api.sessions.list()).rejects.toThrow(/unexpected \(non-JSON\) response/i);
  });
});

describe("api.sessions.create — unwraps the { id, session } envelope (#96)", () => {
  it("reads the real title from the runtime's { id, session } envelope", async () => {
    // The runtime's POST /sessions returns `{ id, session }` (server.ts), unlike
    // the GET routes which return the bare session. Before the fix the whole
    // envelope was handed to normalizeSession, so `raw.title` was undefined and
    // the sidebar/header fell back to `Session <id8>` until a reload.
    fetchMock.mockResolvedValueOnce(
      makeResponse({
        contentType: "application/json",
        json: { id: "f8f35032", session: { id: "f8f35032", title: "请用两句话介绍 BrainPilot" } },
      }),
    );
    const out = await api.sessions.create("请用两句话介绍 BrainPilot");
    expect(out.id).toBe("f8f35032");
    expect(out.title).toBe("请用两句话介绍 BrainPilot");
  });

  it("tolerates a bare session object (no envelope)", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({
        contentType: "application/json",
        json: { id: "abc", title: "bare title" },
      }),
    );
    const out = await api.sessions.create("bare title");
    expect(out.id).toBe("abc");
    expect(out.title).toBe("bare title");
  });

  it("sends the selected session-wide thinking level", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({
        contentType: "application/json",
        json: { id: "think", session: { id: "think", title: "t", thinkingLevel: "high", reasoningSupported: true } },
      }),
    );
    await expect(api.sessions.create("t", { thinkingLevel: "high" })).resolves.toMatchObject({
      reasoningSupported: true,
    });
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toMatchObject({
      thinkingLevel: "high",
    });
  });

  it("updates the shared thinking level on an existing session", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({
        contentType: "application/json",
        json: { id: "think", title: "t", thinkingLevel: "low" },
      }),
    );
    await expect(api.sessions.updateThinking("think", "low")).resolves.toMatchObject({ thinkingLevel: "low" });
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({
      thinkingLevel: "low",
    });
  });
});

describe("api.sessions.respondToInput", () => {
  it("returns the structured stale outcome for an expired question", async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({
      ok: false,
      status: 409,
      contentType: "application/json",
      json: { status: "stale", reason: "question_expired", error: "expired" },
    }));
    await expect(api.sessions.respondToInput("s1", { requestId: "r1", answer: "A" })).resolves.toEqual({
      status: "stale",
      reason: "question_expired",
    });
  });

  it("surfaces a 503 persistence failure so the picker can roll back", async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({
      ok: false,
      status: 503,
      contentType: "application/json",
      json: { error: "Could not save the answer. Please retry." },
    }));
    await expect(api.sessions.respondToInput("s1", { requestId: "r1", answer: "A" }))
      .rejects.toThrow("Could not save the answer. Please retry.");
  });
});

describe("composer-driving requests carry an abort timeout (#106)", () => {
  it("create passes an AbortSignal so a hung POST can't wedge the composer", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({ contentType: "application/json", json: { id: "x", session: { id: "x", title: "t" } } }),
    );
    await api.sessions.create("t");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("postMessage passes an AbortSignal", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({ contentType: "application/json", json: { status: "ok" } }),
    );
    await api.sessions.postMessage("s1", { content: "hi", uuid: "u", timestamp: "2026-06-18T00:00:00Z" });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("propagates the timeout rejection to the caller (releases isSending upstream)", async () => {
    // Simulate AbortSignal.timeout firing: fetch rejects with a TimeoutError.
    fetchMock.mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"));
    await expect(
      api.sessions.postMessage("s1", { content: "hi", uuid: "u", timestamp: "2026-06-18T00:00:00Z" }),
    ).rejects.toBeInstanceOf(DOMException);
  });
});

describe("api.sessions.getEvents — tolerates SSE / non-JSON responses", () => {
  it("returns the events array for a JSON { events } body", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({ contentType: "application/json", json: { events: [{ type: "RUN_STARTED" }] } }),
    );
    const out = await api.sessions.getEvents("s1");
    expect(out).toHaveLength(1);
  });

  it("returns [] (does NOT throw) when the endpoint is an SSE stream", async () => {
    // /sessions/:id/events is wired to sseHandler in backend-core → text/event-stream.
    // Calling res.json() on it would reject; getEvents must short-circuit to [].
    fetchMock.mockResolvedValueOnce(
      makeResponse({ contentType: "text/event-stream", jsonThrows: true }),
    );
    await expect(api.sessions.getEvents("s1")).resolves.toEqual([]);
  });

  it("returns [] for a non-ok response", async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ ok: false, status: 404, contentType: "application/json", json: { error: "not found" } }));
    await expect(api.sessions.getEvents("s1")).resolves.toEqual([]);
  });
});

describe("api.sessions.getHistory — persisted events.jsonl rehydration", () => {
  it("returns the envelope shape from a JSON response", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({
        contentType: "application/json",
        json: { events: [{ type: "TEXT_MESSAGE_CHUNK", delta: "hi" }], total: 1, truncated: false },
      }),
    );
    const out = await api.sessions.getHistory("s1");
    expect(out.events).toHaveLength(1);
    expect(out.total).toBe(1);
    expect(out.truncated).toBe(false);
  });

  it("forwards the limit query string", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({ contentType: "application/json", json: { events: [], total: 0, truncated: false } }),
    );
    await api.sessions.getHistory("s1", { limit: 42 });
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain("/sessions/s1/history?limit=42");
  });

  it("returns the empty envelope on a 404 (session has no transcript)", async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ ok: false, status: 404 }));
    const out = await api.sessions.getHistory("s1");
    expect(out).toEqual({ events: [], total: 0, truncated: false });
  });

  it("throws on a non-404 failure instead of masking it as empty (#223)", async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ ok: false, status: 500 }));
    await expect(api.sessions.getHistory("s1")).rejects.toThrow(/history fetch failed: 500/);
  });

  it("returns the empty envelope when the body is null", async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ contentType: "application/json", json: null }));
    const out = await api.sessions.getHistory("s1");
    expect(out).toEqual({ events: [], total: 0, truncated: false });
  });
});

describe("api.sessions.interrupt — hits the interrupt route, not /messages (#90)", () => {
  it("POSTs to /sessions/:id/interrupt and returns { interrupted }", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({ contentType: "application/json", json: { interrupted: true } }),
    );
    const out = await api.sessions.interrupt("s1");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/sessions\/s1\/interrupt$/);
    expect(String(url)).not.toMatch(/\/messages$/);
    expect((init as RequestInit).method).toBe("POST");
    expect(out.interrupted).toBe(true);
  });

  it("never routes the Stop action through the messages endpoint", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({ contentType: "application/json", json: { interrupted: true } }),
    );
    await api.sessions.interrupt("abc");
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url.endsWith("/messages")).toBe(false);
  });
});

describe("api.sessions.interruptTool", () => {
  it("POSTs to the scoped tool resource", async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({
      contentType: "application/json",
      json: { interrupted: true, toolCallId: "tool/a" },
    }));
    const result = await api.sessions.interruptTool("session 1", "tool/a");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/sessions\/session%201\/tools\/tool%2Fa\/interrupt$/);
    expect((init as RequestInit).method).toBe("POST");
    expect(result.interrupted).toBe(true);
  });

  it("returns the typed timeout body from HTTP 504", async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({
      ok: false,
      status: 504,
      contentType: "application/json",
      json: { interrupted: false, toolCallId: "tool-1", reason: "timeout" },
    }));
    await expect(api.sessions.interruptTool("s1", "tool-1")).resolves.toMatchObject({
      interrupted: false,
      reason: "timeout",
    });
  });
});

// #305: uploadFile uses XHR (for upload.onprogress). FakeXHR records the last
// request and completes via settle() so tests can inspect method/headers/body
// and drive progress / abort / status.
type FakeXhrInstance = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  withCredentials: boolean;
  status: number;
  responseText: string;
  upload: {
    onprogress: ((ev: ProgressEvent) => void) | null;
    onload: (() => void) | null;
  };
  onload: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
  aborted: boolean;
  open: (method: string, url: string) => void;
  setRequestHeader: (k: string, v: string) => void;
  getResponseHeader: (k: string) => string | null;
  send: (body?: unknown) => void;
  abort: () => void;
  /** Resolve the request with status + JSON body (or raw text). */
  settle: (init: { status?: number; contentType?: string; json?: unknown; text?: string }) => void;
  /** Fire upload progress events then upload.onload (processing phase). */
  fireProgress: (events: Array<{ loaded: number; total: number }>) => void;
};

let lastXhr: FakeXhrInstance | null = null;
let xhrInstances: FakeXhrInstance[] = [];

function installFakeXhr() {
  lastXhr = null;
  xhrInstances = [];
  class FakeXHR {
    method = "";
    url = "";
    headers: Record<string, string> = {};
    body: unknown = null;
    withCredentials = false;
    status = 0;
    responseText = "";
    private responseHeaders: Record<string, string> = {};
    upload: FakeXhrInstance["upload"] = { onprogress: null, onload: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    aborted = false;

    open(method: string, url: string) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader(k: string, v: string) {
      this.headers[k.toLowerCase()] = v;
    }
    getResponseHeader(k: string) {
      return this.responseHeaders[k.toLowerCase()] ?? null;
    }
    send(body?: unknown) {
      this.body = body;
      lastXhr = this as unknown as FakeXhrInstance;
      xhrInstances.push(lastXhr);
    }
    abort() {
      this.aborted = true;
      this.onabort?.();
    }
    settle(init: { status?: number; contentType?: string; json?: unknown; text?: string }) {
      this.status = init.status ?? 201;
      if (init.contentType) this.responseHeaders["content-type"] = init.contentType;
      if (init.text != null) {
        this.responseText = init.text;
      } else if (init.json !== undefined) {
        this.responseText = JSON.stringify(init.json);
        if (!init.contentType) this.responseHeaders["content-type"] = "application/json";
      }
      this.onload?.();
    }
    fireProgress(events: Array<{ loaded: number; total: number }>) {
      for (const e of events) {
        this.upload.onprogress?.({
          lengthComputable: e.total > 0,
          loaded: e.loaded,
          total: e.total,
        } as ProgressEvent);
      }
      this.upload.onload?.();
    }
  }
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
}

describe("api.sandbox.uploadFile — #47 base64 upload to the workspace", () => {
  // blobToBase64 uses the browser FileReader, absent in the node test env; stub
  // it with a minimal readAsDataURL that emits a data: URL so the base64 path
  // (prefix stripping) is exercised end-to-end. #305: transport is XHR.
  beforeEach(() => {
    class FakeFileReader {
      result: string | null = null;
      error: unknown = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL(_blob: Blob) {
        // "hi" → aGk= ; the helper must strip the "data:...;base64," prefix.
        this.result = "data:text/plain;base64,aGk=";
        this.onload?.();
      }
    }
    vi.stubGlobal("FileReader", FakeFileReader);
    installFakeXhr();
  });

  it("POSTs { path, contentBase64 } and returns the runtime's { path, size }", async () => {
    const p = api.sandbox.uploadFile("s1", "notes.txt", new Blob(["hi"]));
    // microtask: blobToBase64 resolves, then XHR is created + send()
    await Promise.resolve();
    await Promise.resolve();
    expect(lastXhr).not.toBeNull();
    expect(lastXhr!.method).toBe("POST");
    expect(lastXhr!.url).toMatch(/\/sandbox\/s1\/files$/);
    expect(lastXhr!.withCredentials).toBe(true);
    expect(lastXhr!.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(String(lastXhr!.body))).toEqual({ path: "notes.txt", contentBase64: "aGk=" });
    lastXhr!.settle({ status: 201, json: { path: "notes.txt", size: 2 } });
    await expect(p).resolves.toEqual({ path: "notes.txt", size: 2 });
  });

  it("throws the backend error message on a non-ok response", async () => {
    const p = api.sandbox.uploadFile("s1", "big.bin", new Blob(["hi"]));
    await Promise.resolve();
    await Promise.resolve();
    lastXhr!.settle({
      status: 400,
      contentType: "application/json",
      json: { detail: "file too large" },
    });
    await expect(p).rejects.toThrow("file too large");
  });
});

describe("api.sandbox.uploadFile — #256 raw octet-stream for large files", () => {
  // A Blob reporting a size at/above the 4 MiB threshold: uploadFile must switch
  // to the raw streaming path (bytes as the body, path in ?path=) and never
  // touch base64 (no FileReader stub here, so a base64 attempt would throw).
  function bigBlob(): Blob {
    const b = new Blob(["x"]);
    Object.defineProperty(b, "size", { value: 4 * 1024 * 1024 });
    return b;
  }

  beforeEach(() => {
    installFakeXhr();
  });

  it("streams raw bytes with ?path= and an octet-stream content-type", async () => {
    const file = bigBlob();
    const p = api.sandbox.uploadFile("s1", "data/big.bin", file);
    await Promise.resolve();
    expect(lastXhr).not.toBeNull();
    // path is carried in the query, URL-encoded
    expect(lastXhr!.url).toMatch(/\/sandbox\/s1\/files\?path=data%2Fbig\.bin$/);
    expect(lastXhr!.method).toBe("POST");
    expect(lastXhr!.headers["content-type"]).toBe("application/octet-stream");
    // the Blob itself is the body — not a JSON string
    expect(lastXhr!.body).toBe(file);
    lastXhr!.settle({ status: 201, json: { path: "data/big.bin", size: 4194304 } });
    await expect(p).resolves.toEqual({ path: "data/big.bin", size: 4194304 });
  });

  it("throws the backend error message on a non-ok raw response", async () => {
    const p = api.sandbox.uploadFile("s1", "data/big.bin", bigBlob());
    await Promise.resolve();
    lastXhr!.settle({
      status: 400,
      contentType: "application/json",
      json: { error: "file too large" },
    });
    await expect(p).rejects.toThrow("file too large");
  });
});

describe("api.sandbox.uploadFile — #305 progress + abort", () => {
  function bigBlob(): Blob {
    const b = new Blob(["x"]);
    Object.defineProperty(b, "size", { value: 4 * 1024 * 1024 });
    return b;
  }

  beforeEach(() => {
    installFakeXhr();
  });

  it("reports monotonic progress then processing phase", async () => {
    const events: Array<{ percent: number | null; phase: string }> = [];
    const p = api.sandbox.uploadFile("s1", "data/big.bin", bigBlob(), {
      onProgress: (ev) => events.push({ percent: ev.percent, phase: ev.phase }),
    });
    await Promise.resolve();
    lastXhr!.fireProgress([
      { loaded: 1_000_000, total: 4_000_000 },
      { loaded: 2_000_000, total: 4_000_000 },
      { loaded: 4_000_000, total: 4_000_000 },
    ]);
    lastXhr!.settle({ status: 201, json: { path: "data/big.bin", size: 4_000_000 } });
    await p;
    expect(events.map((e) => e.phase)).toEqual([
      "uploading",
      "uploading",
      "uploading",
      "processing",
    ]);
    expect(events.map((e) => e.percent)).toEqual([25, 50, 100, 100]);
    // percent is non-decreasing across uploading events
    const uploading = events.filter((e) => e.phase === "uploading").map((e) => e.percent!);
    for (let i = 1; i < uploading.length; i++) {
      expect(uploading[i]!).toBeGreaterThanOrEqual(uploading[i - 1]!);
    }
  });

  it("rejects with AbortError when signal aborts", async () => {
    const controller = new AbortController();
    const p = api.sandbox.uploadFile("s1", "data/big.bin", bigBlob(), { signal: controller.signal });
    await Promise.resolve();
    controller.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    expect(lastXhr!.aborted).toBe(true);
  });

  it("rejects immediately when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      api.sandbox.uploadFile("s1", "data/big.bin", bigBlob(), { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("works without onProgress (backward compatible)", async () => {
    const p = api.sandbox.uploadFile("s1", "data/big.bin", bigBlob());
    await Promise.resolve();
    lastXhr!.settle({ status: 201, json: { path: "data/big.bin", size: 4194304 } });
    await expect(p).resolves.toEqual({ path: "data/big.bin", size: 4194304 });
  });
});

// #206: parseError previously read only `detail`, so the backend's Zod shape
// `{ error, details }` and bare `{ error }` (e.g. 409) degraded to the generic
// "Request failed (...)". Driven through api.providers.create (handleJson path).
describe("#206 parseError surfaces { error, details }", () => {
  const validCreate = { name: "x", baseUrl: "https://x", apiKey: "k", models: ["m"] } as never;

  it("renders field-level Zod issues from { error, details }", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({
        ok: false,
        status: 400,
        contentType: "application/json",
        json: {
          error: "invalid provider profile",
          details: [{ path: ["base_url"], message: "must be a valid URL" }],
        },
      }),
    );
    await expect(api.providers.create(validCreate)).rejects.toThrow(
      "invalid provider profile (base_url: must be a valid URL)",
    );
  });

  it("surfaces a bare { error } (409 conflict) message", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({
        ok: false,
        status: 409,
        contentType: "application/json",
        json: { error: 'a provider named "sqz" already exists' },
      }),
    );
    await expect(api.providers.create(validCreate)).rejects.toThrow('a provider named "sqz" already exists');
  });

  it("still prefers a plain { detail } string", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({ ok: false, status: 400, contentType: "application/json", json: { detail: "nope" } }),
    );
    await expect(api.providers.create(validCreate)).rejects.toThrow("nope");
  });
});

// #377 — the BYOK endpoints live in the hosted layer only. `support()` must treat
// their absence as "this deployment has no BYOK" (null) rather than an error, so a
// self-hosted backend keeps rendering the MCP tab exactly as it does today.
describe("api.mcpByok.support — absent on self-hosted backends", () => {
  it("returns the status rows on a hosted backend", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({
        contentType: "application/json",
        json: [
          { kind: "tavily", presetName: "tavily", configured: true },
          { kind: "exa", presetName: "exa-search", configured: false },
        ],
      }),
    );
    const out = await api.mcpByok.support();
    expect(out).toEqual([
      { kind: "tavily", presetName: "tavily", configured: true },
      { kind: "exa", presetName: "exa-search", configured: false },
    ]);
  });

  it("returns null on 404 (endpoint not mounted)", async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ ok: false, status: 404, json: { error: "not found" } }));
    expect(await api.mcpByok.support()).toBeNull();
  });

  it("returns null on 501 and on a network failure", async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ ok: false, status: 501, json: {} }));
    expect(await api.mcpByok.support()).toBeNull();
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await api.mcpByok.support()).toBeNull();
  });

  it("returns null when the body is not an array of rows", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({ contentType: "application/json", json: { kinds: ["tavily"] } }),
    );
    expect(await api.mcpByok.support()).toBeNull();
  });

  it("drops malformed rows but keeps the well-formed ones", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({
        contentType: "application/json",
        json: [
          { kind: "tavily", preset_name: "tavily", configured: true },
          { configured: true },
          { kind: "", configured: false },
        ],
      }),
    );
    // snake_case `preset_name` is accepted alongside camelCase, like the other
    // normalizers in contracts/backend.
    expect(await api.mcpByok.support()).toEqual([
      { kind: "tavily", presetName: "tavily", configured: true },
    ]);
  });

  // #377 review: normalizeMcpByok trims `byok.kind` on the *entry* side, so the
  // status side must trim too or the two never match and the card silently vanishes.
  it("trims a padded kind so it still matches the preset's annotation", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({
        contentType: "application/json",
        json: [{ kind: "  tavily  ", presetName: "tavily", configured: true }],
      }),
    );
    expect(await api.mcpByok.support()).toEqual([
      { kind: "tavily", presetName: "tavily", configured: true },
    ]);
  });

  it("drops a whitespace-only kind, not just an empty one", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({
        contentType: "application/json",
        json: [{ kind: "   ", configured: true }, { kind: "\t\n", configured: false }],
      }),
    );
    expect(await api.mcpByok.support()).toEqual([]);
  });

  it("coerces a missing/odd `configured` to false", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({ contentType: "application/json", json: [{ kind: "tavily" }] }),
    );
    expect(await api.mcpByok.support()).toEqual([{ kind: "tavily", presetName: "", configured: false }]);
  });
});

describe("api.mcpByok save/clear", () => {
  it("PUTs the key to the kind-scoped endpoint", async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ status: 204 }));
    await api.mcpByok.save("tavily", "tvly-secret");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/mcp-servers/byok/tavily");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ apiKey: "tvly-secret" });
  });

  it("percent-encodes the kind in the path", async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ status: 204 }));
    await api.mcpByok.clear("weird kind/x");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("byok/weird%20kind%2Fx");
    expect(init.method).toBe("DELETE");
  });

  it("surfaces a rejected key so the UI can show why", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({ ok: false, status: 400, contentType: "application/json", json: { error: "invalid api key" } }),
    );
    await expect(api.mcpByok.save("tavily", "nope")).rejects.toThrow("invalid api key");
  });
});

describe("api.plugins marketplace lifecycle", () => {
  it("reads an explicit file range and parses Content-Range", async () => {
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([2, 3]), {
      status: 206,
      headers: { "content-type": "application/octet-stream", "content-range": "bytes 1-2/4" },
    }));
    const result = await api.sandbox.readRawFileRange("s1", "/workspace/scan.nii", 1, 2);
    expect(result.offset).toBe(1);
    expect(result.totalSize).toBe(4);
    expect(new Uint8Array(await result.blob.arrayBuffer())).toEqual(new Uint8Array([2, 3]));
    expect((fetchMock.mock.calls[0][1].headers as Record<string, string>).Range).toBe("bytes=1-2");
  });

  it("loads the catalogue from the control-plane endpoint", async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ contentType: "application/json", json: [] }));
    await expect(api.plugins.marketplace()).resolves.toEqual([]);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/plugins/marketplace");
  });

  it("installs a selected immutable version", async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ contentType: "application/json", json: { activeVersion: "1.2.0" } }));
    await api.plugins.install("org.example.viewer", "1.2.0");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/plugins/install");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ id: "org.example.viewer", version: "1.2.0" });
  });

  it("encodes plugin ids when changing activation state", async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ contentType: "application/json", json: { enabled: true } }));
    await api.plugins.setEnabled("org.example/weird", true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/plugins/org.example%2Fweird/enabled");
    expect(init.method).toBe("PUT");
  });
});

describe("api.runtime.restart", () => {
  it("POSTs the backend-owned runtime restart endpoint", async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ contentType: "application/json", json: { status: "ok" } }));

    await expect(api.runtime.restart()).resolves.toEqual({ status: "ok" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/runtime/restart");
    expect(init.method).toBe("POST");
  });
});

describe("api.mcpRuntime.status", () => {
  it("reads runtime-observed MCP server health", async () => {
    const body = { state: "failed", servers: [{ name: "playwright", pluginId: "plugin-a", state: "failed", error: "connection closed" }] };
    fetchMock.mockResolvedValueOnce(makeResponse({ contentType: "application/json", json: body }));

    await expect(api.mcpRuntime.status()).resolves.toEqual(body);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/mcp-status");
  });
});

describe("api.datasets", () => {
  it("loads the dataset catalogue", async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ contentType: "application/json", json: [{ id: "demo" }] }));
    await expect(api.datasets.catalog()).resolves.toEqual([{ id: "demo" }]);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/datasets");
  });

  it("starts an encoded dataset download with ephemeral credentials", async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ status: 202, contentType: "application/json", json: { id: "job-1", status: "queued" } }));
    await api.datasets.download("provider/data", { token: "secret" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/datasets/provider%2Fdata/download");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ credentials: { token: "secret" } });
  });
});
