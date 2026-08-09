import { describe, expect, it, vi } from "vitest";
import { RuntimeClient, buildPath } from "../src/runtime-client.js";

describe("buildPath", () => {
  it("fills :id params and encodes them", () => {
    expect(buildPath("/sessions/:id/state", { id: "a b" })).toBe("/sessions/a%20b/state");
  });
  it("throws on a missing param", () => {
    expect(() => buildPath("/sessions/:id", {})).toThrow(/missing path param/);
  });
});

describe("RuntimeClient", () => {
  it("urlFor resolves a route name + params to a runtime URL", () => {
    const rc = new RuntimeClient({ baseUrl: "http://rt:8081/" });
    expect(rc.urlFor("getSessionState", { id: "s1" })).toBe(
      "http://rt:8081/sessions/s1/state",
    );
    expect(rc.urlFor("listSessions")).toBe("http://rt:8081/sessions");
    expect(rc.urlFor("mcpStatus")).toBe("http://rt:8081/mcp/status");
  });

  it("forward issues the route's method + body and returns the raw Response", async () => {
    const fetchFn = vi.fn(async () => new Response('{"ok":true}', { status: 201 }));
    const rc = new RuntimeClient({ baseUrl: "http://rt:8081", fetchFn: fetchFn as never });
    const res = await rc.forward("createSession", { body: '{"title":"x"}', headers: { "content-type": "application/json" } });
    expect(res.status).toBe(201);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("http://rt:8081/sessions");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).body).toBe('{"title":"x"}');
  });

  it("openSse hits the canonical /sse/:id route with event-stream accept", async () => {
    const fetchFn = vi.fn(async () => new Response("data: x\n\n", { status: 200 }));
    const rc = new RuntimeClient({ baseUrl: "http://rt:8081", fetchFn: fetchFn as never });
    await rc.openSse("sess-9");
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("http://rt:8081/sse/sess-9");
    expect((init as RequestInit).method).toBe("GET");
    expect((init as { headers: Record<string, string> }).headers.accept).toBe(
      "text/event-stream",
    );
  });
});
