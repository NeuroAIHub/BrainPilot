import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { api } from "../utils/api";

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

describe("api.sandbox.uploadFile — #47 base64 upload to the workspace", () => {
  // blobToBase64 uses the browser FileReader, absent in the node test env; stub
  // it with a minimal readAsDataURL that emits a data: URL so the base64 path
  // (prefix stripping) is exercised end-to-end.
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
  });

  it("POSTs { path, contentBase64 } and returns the runtime's { path, size }", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({ status: 201, contentType: "application/json", json: { path: "notes.txt", size: 2 } }),
    );
    const out = await api.sandbox.uploadFile("s1", "notes.txt", new Blob(["hi"]));

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/sandbox\/s1\/files$/);
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body).toEqual({ path: "notes.txt", contentBase64: "aGk=" });
    expect(out).toEqual({ path: "notes.txt", size: 2 });
  });

  it("throws the backend error message on a non-ok response", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({ ok: false, status: 400, contentType: "application/json", json: { detail: "file too large" } }),
    );
    await expect(api.sandbox.uploadFile("s1", "big.bin", new Blob(["hi"]))).rejects.toThrow("file too large");
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

  it("streams raw bytes with ?path= and an octet-stream content-type", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({ status: 201, contentType: "application/json", json: { path: "data/big.bin", size: 4194304 } }),
    );
    const file = bigBlob();
    const out = await api.sandbox.uploadFile("s1", "data/big.bin", file);

    const [url, init] = fetchMock.mock.calls[0]!;
    // path is carried in the query, URL-encoded
    expect(String(url)).toMatch(/\/sandbox\/s1\/files\?path=data%2Fbig\.bin$/);
    const ri = init as RequestInit;
    expect(ri.method).toBe("POST");
    expect((ri.headers as Record<string, string>)["content-type"]).toBe("application/octet-stream");
    // the Blob itself is the body — not a JSON string
    expect(ri.body).toBe(file);
    expect(out).toEqual({ path: "data/big.bin", size: 4194304 });
  });

  it("throws the backend error message on a non-ok raw response", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({ ok: false, status: 400, contentType: "application/json", json: { error: "file too large" } }),
    );
    await expect(api.sandbox.uploadFile("s1", "data/big.bin", bigBlob())).rejects.toThrow("file too large");
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
