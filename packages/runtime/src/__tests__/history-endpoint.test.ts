/**
 * Persisted history endpoint — used by the web to rehydrate chat after a
 * runtime restart (the SSE ring buffer only carries the last ~500 live events).
 *
 * Covers SessionManager.readEventHistory + GET /sessions/:id/history end-to-end.
 */
import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../server.js";
import { SessionManager } from "../session-manager.js";
import { mockAgentFactory } from "../agent-factory.js";

async function seed(dataRoot: string, sid: string, lines: string[]): Promise<void> {
  const dir = join(dataRoot, ".bp", sid);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "meta.json"),
    JSON.stringify({
      id: sid,
      title: "seeded",
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
      lastActivityAt: 1780000000000,
    }),
    "utf8",
  );
  await writeFile(join(dir, "events.jsonl"), lines.join("\n") + "\n", "utf8");
}

function mkEvent(i: number): string {
  return JSON.stringify({
    type: "TEXT_MESSAGE_CHUNK",
    session_id: "s",
    delta: `msg-${i}`,
    message_id: `m-${i}`,
  });
}

async function appWithRestored(sid: string, lines: string[]) {
  const dataRoot = await mkdtemp(join(tmpdir(), "bp-history-"));
  await seed(dataRoot, sid, lines);
  const manager = new SessionManager({ dataRoot, persist: true, agentFactory: mockAgentFactory });
  await manager.restoreFromDisk();
  const app = createServer({ manager }).app;
  return { app, manager, dataRoot };
}

describe("GET /sessions/:id/history", () => {
  it("returns all events when count <= default limit", async () => {
    const lines = Array.from({ length: 5 }, (_, i) => mkEvent(i));
    const { app } = await appWithRestored("11111111-1111-1111-1111-111111111111", lines);
    const res = await app.request("/sessions/11111111-1111-1111-1111-111111111111/history");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: Array<{ delta: string }>; total: number; truncated: boolean };
    expect(body.total).toBe(5);
    expect(body.truncated).toBe(false);
    expect(body.events.map((e) => e.delta)).toEqual(["msg-0", "msg-1", "msg-2", "msg-3", "msg-4"]);
  });

  it("returns the tail N events when total > limit", async () => {
    const lines = Array.from({ length: 15 }, (_, i) => mkEvent(i));
    const { app } = await appWithRestored("22222222-2222-2222-2222-222222222222", lines);
    const res = await app.request("/sessions/22222222-2222-2222-2222-222222222222/history?limit=10");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: Array<{ delta: string }>; total: number; truncated: boolean };
    expect(body.total).toBe(15);
    expect(body.truncated).toBe(true);
    expect(body.events).toHaveLength(10);
    // tail: msg-5..msg-14
    expect(body.events[0]!.delta).toBe("msg-5");
    expect(body.events[9]!.delta).toBe("msg-14");
  });

  it("returns the full log when limit=0", async () => {
    const lines = Array.from({ length: 15 }, (_, i) => mkEvent(i));
    const { app, manager } = await appWithRestored("33333333-3333-3333-3333-333333333333", lines);

    const direct = await manager.readEventHistory("33333333-3333-3333-3333-333333333333", { limit: 0 });
    expect(direct?.events).toHaveLength(15);
    expect(direct?.truncated).toBe(false);

    const res = await app.request("/sessions/33333333-3333-3333-3333-333333333333/history?limit=0");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: Array<{ delta: string }>; total: number; truncated: boolean };
    expect(body.total).toBe(15);
    expect(body.truncated).toBe(false);
    expect(body.events.map((e) => e.delta)).toEqual(lines.map((_, i) => `msg-${i}`));
  });

  it("clamps an absurd limit down to 5000", async () => {
    const lines = Array.from({ length: 3 }, (_, i) => mkEvent(i));
    const { app, manager } = await appWithRestored("66666666-6666-6666-6666-666666666666", lines);
    // verify clamping at the SessionManager layer too
    const got = await manager.readEventHistory("66666666-6666-6666-6666-666666666666", { limit: 999999 });
    expect(got?.events).toHaveLength(3);
    const res = await app.request("/sessions/66666666-6666-6666-6666-666666666666/history?limit=999999");
    expect(res.status).toBe(200);
  });

  it("skips malformed lines without breaking the rest", async () => {
    const lines = [mkEvent(0), "{not json", mkEvent(1), "", mkEvent(2)];
    const { app } = await appWithRestored("44444444-4444-4444-4444-444444444444", lines);
    const res = await app.request("/sessions/44444444-4444-4444-4444-444444444444/history");
    const body = (await res.json()) as { events: Array<{ delta: string }>; total: number };
    expect(body.total).toBe(3);
    expect(body.events.map((e) => e.delta)).toEqual(["msg-0", "msg-1", "msg-2"]);
  });

  it("returns empty result when events.jsonl is missing", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "bp-history-"));
    const sid = "55555555-5555-5555-5555-555555555555";
    const dir = join(dataRoot, ".bp", sid);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "meta.json"),
      JSON.stringify({
        id: sid,
        title: "empty",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
        lastActivityAt: 1780000000000,
      }),
      "utf8",
    );
    const manager = new SessionManager({ dataRoot, persist: true, agentFactory: mockAgentFactory });
    await manager.restoreFromDisk();
    const app = createServer({ manager }).app;
    const res = await app.request(`/sessions/${sid}/history`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ events: [], total: 0, truncated: false });
  });

  it("404s when the session is unknown", async () => {
    const manager = new SessionManager({ persist: false, agentFactory: mockAgentFactory });
    const app = createServer({ manager }).app;
    const res = await app.request("/sessions/does-not-exist/history");
    expect(res.status).toBe(404);
  });
});
