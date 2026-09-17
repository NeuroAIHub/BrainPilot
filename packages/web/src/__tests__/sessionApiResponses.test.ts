import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../utils/api";

// Data-load truthfulness for the two conversation/history reads: a broken 200 is
// a failure the UI must be able to report, not an empty result it silently
// renders as "no conversations" / a blank transcript.
//
// Same stubbing approach as api.test.ts: the package's vitest runs in the `node`
// environment, so globalThis.fetch and a minimal localStorage are stubbed rather
// than pulling in a DOM.

type FetchResponseInit = {
  ok?: boolean;
  status?: number;
  contentType?: string;
  json?: unknown;
  /** When set, res.json() rejects (mirrors a body that isn't JSON at all). */
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
    statusText: ok ? "OK" : "Error",
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    json: async () => {
      if (init.jsonThrows) throw new SyntaxError("Unexpected token '<'");
      return init.json;
    },
    text: async () => (typeof init.json === "string" ? init.json : JSON.stringify(init.json ?? "")),
    clone: () => makeResponse(init),
  } as unknown as Response;
}

const json = (body: unknown) => makeResponse({ contentType: "application/json", json: body });

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

describe("api.sessions.list — accepts both wire shapes, rejects malformed ones", () => {
  it("accepts the canonical { sessions: [...] } envelope", async () => {
    fetchMock.mockResolvedValueOnce(json({ sessions: [{ id: "a" }, { id: "b" }] }));
    const out = await api.sessions.list();
    expect(out.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("accepts a legacy bare array", async () => {
    fetchMock.mockResolvedValueOnce(json([{ id: "x" }]));
    const out = await api.sessions.list();
    expect(out.map((s) => s.id)).toEqual(["x"]);
  });

  it("treats a real empty list as an empty list (not a failure)", async () => {
    fetchMock.mockResolvedValueOnce(json({ sessions: [] }));
    await expect(api.sessions.list()).resolves.toEqual([]);
  });

  it("rejects a 200 whose envelope has no sessions array", async () => {
    fetchMock.mockResolvedValueOnce(json({}));
    await expect(api.sessions.list()).rejects.toThrow(/unexpected session list/i);
  });

  it("rejects a 200 whose sessions field is not an array", async () => {
    fetchMock.mockResolvedValueOnce(json({ sessions: { a: 1 } }));
    await expect(api.sessions.list()).rejects.toThrow(/unexpected session list/i);
  });

  it("rejects a null body instead of reporting zero conversations", async () => {
    fetchMock.mockResolvedValueOnce(json(null));
    await expect(api.sessions.list()).rejects.toThrow(/unexpected session list/i);
  });

  it("still reports a non-JSON 200 with a readable message", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({ contentType: "text/html", jsonThrows: true, json: "<!doctype html>" }),
    );
    await expect(api.sessions.list()).rejects.toThrow(/unexpected \(non-JSON\) response/i);
  });
});

describe("api.sessions.getHistory — 404 compatibility, malformed rejection", () => {
  it("keeps optional total/truncated and passes unknown event types through", async () => {
    fetchMock.mockResolvedValueOnce(json({
      events: [
        { type: "TEXT_MESSAGE_CHUNK", messageId: "m1", role: "user", delta: "hi" },
        { type: "SOMETHING_NEW_FROM_A_NEWER_RUNTIME", payload: { a: 1 } },
      ],
      total: 9,
      truncated: true,
    }));
    const out = await api.sessions.getHistory("s1", { limit: 0 });
    expect(out.events).toHaveLength(2);
    expect(out.events[1]).toMatchObject({ type: "SOMETHING_NEW_FROM_A_NEWER_RUNTIME" });
    expect(out.total).toBe(9);
    expect(out.truncated).toBe(true);
    // limit: 0 asks for the full log (lossless rehydrate).
    expect(String(fetchMock.mock.calls[0]![0])).toContain("/history?limit=0");
  });

  it("defaults the optional fields when the runtime omits them", async () => {
    fetchMock.mockResolvedValueOnce(json({ events: [] }));
    await expect(api.sessions.getHistory("s1")).resolves.toEqual({
      events: [],
      total: 0,
      truncated: false,
    });
  });

  it("keeps the documented 404 = no transcript yet compatibility", async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ ok: false, status: 404 }));
    await expect(api.sessions.getHistory("s1")).resolves.toEqual({
      events: [],
      total: 0,
      truncated: false,
    });
  });

  it("rejects any other non-OK status", async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ ok: false, status: 500 }));
    await expect(api.sessions.getHistory("s1")).rejects.toThrow(/history fetch failed: 500/);
  });

  it("rejects an unparseable body instead of showing an empty conversation", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({ contentType: "application/json", jsonThrows: true }),
    );
    await expect(api.sessions.getHistory("s1")).rejects.toThrow(/unexpected history payload/i);
  });

  it("rejects a 200 with no events array", async () => {
    fetchMock.mockResolvedValueOnce(json({ total: 3 }));
    await expect(api.sessions.getHistory("s1")).rejects.toThrow(/unexpected history payload/i);
  });

  it("rejects a 200 whose events field is not an array", async () => {
    fetchMock.mockResolvedValueOnce(json({ events: "nope" }));
    await expect(api.sessions.getHistory("s1")).rejects.toThrow(/unexpected history payload/i);
  });

  it("rejects a null body", async () => {
    fetchMock.mockResolvedValueOnce(json(null));
    await expect(api.sessions.getHistory("s1")).rejects.toThrow(/unexpected history payload/i);
  });
});
