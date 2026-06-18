import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    const body = (await res.json()) as {
      activeSessions: number;
      memRss: number;
      memLimitBytes: number | null;
      memRatio: number | null;
    };
    expect(body.activeSessions).toBe(0);
    expect(body.memRss).toBeGreaterThan(0);
    // Opt-in budget unset by default → null (single-user / no throttle).
    expect(body.memLimitBytes).toBeNull();
    expect(body.memRatio).toBeNull();
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

    // trace (Graph of Trace) — returns { meta, nodes } for an existing session
    const trace = await a.request(`/sessions/${id}/trace`);
    expect(trace.status).toBe(200);
    const graph = (await trace.json()) as { meta: { sessionId: string }; nodes: unknown[] };
    expect(graph.meta.sessionId).toBe(id);
    expect(Array.isArray(graph.nodes)).toBe(true);

    // interrupt
    const intr = await a.request(`/sessions/${id}/interrupt`, { method: "POST" });
    expect(intr.status).toBe(200);

    // evict
    const evict = await a.request(`/sessions/${id}/evict`, { method: "POST" });
    expect(evict.status).toBe(200);
    expect((await evict.json()) as { evicted: boolean }).toMatchObject({ evicted: true });
  });

  it("PUT /sessions/:id renames and the new title survives a re-GET (#29)", async () => {
    const a = app();
    const created = await a.request("/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Untitled session" }),
    });
    const { id } = (await created.json()) as { id: string };

    const put = await a.request(`/sessions/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Renamed" }),
    });
    expect(put.status).toBe(200);
    expect((await put.json()) as { title: string }).toMatchObject({ id, title: "Renamed" });

    // re-GET: the new title is the persisted state, not the optimistic one
    const got = (await (await a.request(`/sessions/${id}`)).json()) as { title: string };
    expect(got.title).toBe("Renamed");

    // a blank title is ignored (idempotent) — keeps the existing title
    const blank = await a.request(`/sessions/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "   " }),
    });
    expect((await blank.json()) as { title: string }).toMatchObject({ title: "Renamed" });
  });

  it("404s for unknown session", async () => {
    const a = app();
    expect((await a.request("/sessions/nope")).status).toBe(404);
    expect((await a.request("/sessions/nope/state")).status).toBe(404);
    expect((await a.request("/sessions/nope/trace")).status).toBe(404);
    const del = await a.request("/sessions/nope", { method: "DELETE" });
    expect(del.status).toBe(404);
    const put = await a.request("/sessions/nope", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "x" }),
    });
    expect(put.status).toBe(404);
  });

  it("POST /messages with user_input_response resolves or reports stale", async () => {
    const a = app();
    const created = await a.request("/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "T" }),
    });
    const { id } = (await created.json()) as { id: string };

    // No outstanding request → stale, but still 200.
    const res = await a.request(`/sessions/${id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "user_input_response",
        session_id: id,
        request_id: "req_missing",
        answer: "x",
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "stale" });
  });

  it("POST /messages still accepts a normal content body", async () => {
    const a = app();
    const created = await a.request("/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "T" }),
    });
    const { id } = (await created.json()) as { id: string };
    const res = await a.request(`/sessions/${id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "hello" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).accepted).toBe(true);
  });
});

describe("workspace file routes", () => {
  async function appWithWorkspace() {
    const dataRoot = await mkdtemp(join(tmpdir(), "bp-files-"));
    const ws = join(dataRoot, "workspaces", "s1");
    await mkdir(join(ws, "sub"), { recursive: true });
    await writeFile(join(ws, "a.txt"), "hello");
    await writeFile(join(ws, "sub", "b.txt"), "world");
    await writeFile(join(ws, "img.bin"), Buffer.from([1, 2, 3, 4]));
    const manager = new SessionManager({ persist: false, dataRoot, agentFactory: mockAgentFactory });
    return { app: createServer({ manager }).app, dataRoot };
  }

  it("lists, reads (text + raw), and deletes workspace files", async () => {
    const { app: a } = await appWithWorkspace();

    // list root (bare array, /workspace-rooted path)
    const listRes = await a.request("/sessions/s1/files?path=/workspace");
    expect(listRes.status).toBe(200);
    const files = (await listRes.json()) as Array<{ name: string; type: string; size: number }>;
    expect(files.map((f) => f.name).sort()).toEqual(["a.txt", "img.bin", "sub"]);
    expect(files.find((f) => f.name === "sub")?.type).toBe("folder");

    // read text
    const txt = await a.request("/sessions/s1/files/content?path=/workspace/a.txt");
    expect(txt.status).toBe(200);
    expect((await txt.json()) as { content: string }).toMatchObject({ content: "hello" });

    // read raw bytes
    const raw = await a.request("/sessions/s1/files/raw?path=/workspace/img.bin");
    expect(raw.status).toBe(200);
    expect(new Uint8Array(await raw.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));

    // delete
    const del = await a.request("/sessions/s1/files?path=/workspace/a.txt", { method: "DELETE" });
    expect(del.status).toBe(200);
    const after = (await (await a.request("/sessions/s1/files?path=/workspace")).json()) as unknown[];
    expect(after).toHaveLength(2);
  });

  it("rejects path traversal outside the workspace", async () => {
    const { app: a } = await appWithWorkspace();
    // content + raw + delete all guard via resolveWorkspacePath → 404/400.
    expect((await a.request("/sessions/s1/files/content?path=../../../etc/passwd")).status).toBe(404);
    expect((await a.request("/sessions/s1/files/raw?path=/workspace/../../secret")).status).toBe(404);
    const del = await a.request("/sessions/s1/files?path=../escape", { method: "DELETE" });
    expect(del.status).toBe(400);
  });

  it("returns empty list for a session with no workspace yet", async () => {
    const { app: a } = await appWithWorkspace();
    const res = await a.request("/sessions/never-created/files?path=/workspace");
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown[]).toEqual([]);
  });

  // #47: file upload (base64) into the workspace.
  it("uploads a file via POST and makes it readable", async () => {
    const { app: a } = await appWithWorkspace();
    const contentBase64 = Buffer.from("uploaded content").toString("base64");
    const res = await a.request("/sessions/s1/files", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "/workspace/upload/notes.txt", contentBase64 }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { path: string; size: number };
    expect(body.path).toBe(join("upload", "notes.txt"));
    expect(body.size).toBe(Buffer.byteLength("uploaded content"));
    // readable back through the read route
    const txt = await a.request("/sessions/s1/files/content?path=/workspace/upload/notes.txt");
    expect((await txt.json()) as { content: string }).toMatchObject({ content: "uploaded content" });
  });

  it("rejects an upload that escapes the workspace with 400", async () => {
    const { app: a } = await appWithWorkspace();
    const res = await a.request("/sessions/s1/files", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "../../../etc/evil", contentBase64: "eA==" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a malformed upload body with 400", async () => {
    const { app: a } = await appWithWorkspace();
    const res = await a.request("/sessions/s1/files", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "" }),
    });
    expect(res.status).toBe(400);
  });

  // #60: a composer upload staged under workspaces/local/ (the draft sandbox id)
  // must be drained into the real session workspace before the agent runs, so
  // the agent's cwd (workspaces/<sid>/) contains the file the user attached.
  it("drains a staged local upload into the session workspace on sendMessage (#60)", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "bp-drain-"));
    const manager = new SessionManager({ persist: true, dataRoot, agentFactory: mockAgentFactory });

    // Simulate the draft-composer upload: web POSTs against the "local" sandbox
    // id because the real session does not exist yet.
    await manager.writeSessionFile(
      "local",
      "/workspace/attachment-probe.txt",
      Buffer.from("probe payload").toString("base64"),
    );

    // The real session is created when the prompt is sent.
    const session = await manager.createSession({ title: "Draft" });
    await manager.sendMessage(session.id, "Please summarize the uploaded attachment.");

    // The file now lives in the agent's cwd (the session workspace)...
    const inSession = await readFile(
      join(dataRoot, "workspaces", session.id, "attachment-probe.txt"),
      "utf8",
    );
    expect(inSession).toBe("probe payload");

    // ...and the staging area was drained so it can't leak into a later session.
    const staged = await readdir(join(dataRoot, "workspaces", "local"));
    expect(staged).toEqual([]);

    manager.shutdown();
  });
});

async function waitFor(pred: () => boolean | Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!(await pred())) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}
