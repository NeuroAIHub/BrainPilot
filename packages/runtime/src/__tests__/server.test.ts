import { describe, it, expect } from "vitest";
import { createServer } from "../server.js";
import { SessionManager } from "../session-manager.js";
import { mockAgentFactory } from "../agent-factory.js";

/**
 * HTTP surface smoke test. Drives every non-SSE RUNTIME_ROUTE via app.request
 * (hono's in-process fetch) without binding a port.
 */
describe("HTTP server (RUNTIME_ROUTES)", () => {
  function app() {
    const manager = new SessionManager({ persist: false, agentFactory: mockAgentFactory });
    return createServer({ manager }).app;
  }

  it("GET /health", async () => {
    const res = await app().request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("GET /metrics", async () => {
    const res = await app().request("/metrics");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { activeSessions: number; memRss: number };
    expect(body.activeSessions).toBe(0);
    expect(body.memRss).toBeGreaterThan(0);
  });

  it("full session lifecycle over HTTP", async () => {
    const a = app();
    // create
    const created = await a.request("/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Demo" }),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    expect(id).toBeTruthy();

    // list
    const list = (await (await a.request("/sessions")).json()) as { sessions: unknown[] };
    expect(list.sessions).toHaveLength(1);

    // get
    expect((await a.request(`/sessions/${id}`)).status).toBe(200);

    // message
    const msg = await a.request(`/sessions/${id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "hello" }),
    });
    expect(msg.status).toBe(200);
    expect((await msg.json()) as { accepted: boolean }).toMatchObject({ accepted: true });

    // agents (state authority)
    await waitFor(async () => {
      const r = (await (await a.request(`/sessions/${id}/agents`)).json()) as { agents: unknown[] };
      return r.agents.length > 0;
    });

    // state
    const state = await a.request(`/sessions/${id}/state`);
    expect(state.status).toBe(200);

    // interrupt
    const intr = await a.request(`/sessions/${id}/interrupt`, { method: "POST" });
    expect(intr.status).toBe(200);

    // evict
    const evict = await a.request(`/sessions/${id}/evict`, { method: "POST" });
    expect(evict.status).toBe(200);
    expect((await evict.json()) as { evicted: boolean }).toMatchObject({ evicted: true });
  });

  it("404s for unknown session", async () => {
    const a = app();
    expect((await a.request("/sessions/nope")).status).toBe(404);
    expect((await a.request("/sessions/nope/state")).status).toBe(404);
    const del = await a.request("/sessions/nope", { method: "DELETE" });
    expect(del.status).toBe(404);
  });
});

async function waitFor(pred: () => boolean | Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!(await pred())) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}
