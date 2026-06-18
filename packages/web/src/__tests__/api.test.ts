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
