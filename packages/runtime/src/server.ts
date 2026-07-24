/**
 * HTTP server (§15.4 / RUNTIME_ROUTES) — implements every Runtime route on top
 * of the SessionManager. Uses hono + @hono/node-server. The SSE endpoint
 * streams AG-UI events for a session.
 *
 * Routes (from `@brainpilot/protocol` RUNTIME_ROUTES):
 *   GET  /health, GET /metrics
 *   POST /sessions, GET /sessions, GET /sessions/:id, DELETE /sessions/:id
 *   GET  /sessions/:id/state, POST /sessions/:id/messages
 *   GET  /sse/:id  (+ alias GET /sessions/:id/events)
 *   POST /sessions/:id/interrupt, GET /sessions/:id/agents, POST /sessions/:id/evict
 */
import { pathToFileURL } from "node:url";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { stream } from "hono/streaming";
import {
  CreateSessionRequestSchema,
  SendMessageRequestSchema,
  InterruptRequestSchema,
  WriteFileRequestSchema,
} from "@brainpilot/protocol";
import { SessionManager, type SessionManagerOptions } from "./session-manager.js";

export function createServer(opts: SessionManagerOptions & { manager?: SessionManager } = {}): {
  app: Hono;
  manager: SessionManager;
} {
  const manager = opts.manager ?? new SessionManager(opts);
  const app = new Hono();

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.get("/metrics", (c) => c.json(manager.metrics()));

  app.post("/sessions", async (c) => {
    const body = await safeBody(c);
    const parsed = CreateSessionRequestSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "invalid body" }, 400);
    const session = await manager.createSession(parsed.data);
    return c.json({ id: session.id, session }, 201);
  });

  app.get("/sessions", async (c) => c.json({ sessions: await manager.listSessions() }));

  app.get("/sessions/:id", async (c) => {
    const id = c.req.param("id");
    await manager.ensureLoaded(id);
    const s = manager.getSession(id);
    return s ? c.json(s) : c.json({ error: "not found" }, 404);
  });

  // #29: rename — PUT the session title and persist it to meta.json.
  app.put("/sessions/:id", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { title?: unknown };
    const s = await manager.renameSession(c.req.param("id"), body?.title);
    return s ? c.json(s) : c.json({ error: "not found" }, 404);
  });

  app.delete("/sessions/:id", async (c) => {
    const id = c.req.param("id");
    const deleted = await manager.deleteSession(id);
    return c.json({ id, deleted }, deleted ? 200 : 404);
  });

  app.get("/sessions/:id/state", async (c) => {
    const id = c.req.param("id");
    await manager.ensureLoaded(id);
    const state = manager.getSessionState(id);
    return state ? c.json(state) : c.json({ error: "not found" }, 404);
  });

  app.get("/sessions/:id/trace", async (c) => {
    const id = c.req.param("id");
    await manager.ensureLoaded(id);
    const graph = manager.getTrace(id);
    return graph ? c.json(graph) : c.json({ error: "not found" }, 404);
  });

  // Per-run + per-session usage stats — see RUNTIME_ROUTES.getSessionStats.
  // Persisted alongside the session at `.bp/<sid>/stats.json`; returns the
  // in-memory snapshot fed by MasAgent.onRunStats.
  app.get("/sessions/:id/stats", async (c) => {
    const id = c.req.param("id");
    await manager.ensureLoaded(id);
    const stats = manager.getSessionStats(id);
    return stats ? c.json(stats) : c.json({ error: "not found" }, 404);
  });

  // Persisted event history (events.jsonl) — see RUNTIME_ROUTES.getSessionHistory.
  // Used by the web to rehydrate chat after a runtime restart; SSE only replays
  // the in-memory ring buffer.
  app.get("/sessions/:id/history", async (c) => {
    const id = c.req.param("id");
    const limitQ = c.req.query("limit");
    const limit = limitQ !== undefined ? Number(limitQ) : undefined;
    const result = await manager.readEventHistory(id, {
      limit: Number.isFinite(limit) ? (limit as number) : undefined,
    });
    if (!result) return c.json({ error: "not found" }, 404);
    return c.json(result);
  });

  app.post("/sessions/:id/messages", async (c) => {
    const id = c.req.param("id");
    const body = await safeBody(c);
    const parsed = SendMessageRequestSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "invalid body" }, 400);
    await manager.ensureLoaded(id);
    if (!manager.getSession(id)) return c.json({ error: "not found" }, 404);

    // ask_user reply branch: resolve the outstanding request.
    const data = parsed.data;
    if ("type" in data && data.type === "user_input_response") {
      if (data.session_id !== id) {
        return c.json({ error: "session_id does not match route" }, 400);
      }
      const result = await manager.answerInput(id, data.request_id, data.answer);
      if (result === "stale") {
        return c.json(
          { status: "stale", reason: "question_expired", error: "This question is no longer pending." },
          409,
        );
      }
      if (result === "invalid") return c.json({ error: "invalid answer" }, 400);
      if (result === "persist_failed") {
        return c.json(
          { status: "retry", reason: "persistence_unavailable", error: "Could not save the answer. Please retry." },
          503,
        );
      }
      return c.json({ status: "ok" });
    }

    // Normal message branch.
    if (!("content" in data)) return c.json({ error: "invalid body" }, 400);
    const res = await manager.sendMessage(id, data.content, data.agent ?? "principal", {
      uuid: data.data?.uuid,
    });
    return c.json(res);
  });

  app.post("/sessions/:id/interrupt", async (c) => {
    const id = c.req.param("id");
    const body = await safeBody(c);
    const parsed = InterruptRequestSchema.safeParse(body);
    const agent = parsed.success ? parsed.data.agent : undefined;
    await manager.ensureLoaded(id);
    const interrupted = await manager.interrupt(id, agent);
    return c.json({ interrupted });
  });

  app.get("/sessions/:id/agents", async (c) => {
    const id = c.req.param("id");
    await manager.ensureLoaded(id);
    return c.json({ agents: manager.listAgents(id) });
  });

  app.post("/sessions/:id/evict", async (c) => {
    const res = await manager.evictSession(c.req.param("id"));
    return c.json(res, res.evicted ? 200 : 404);
  });

  // ---- Workspace files (read off disk; independent of in-memory session) ----
  app.get("/sessions/:id/files", async (c) => {
    try {
      const files = await manager.listSessionFiles(c.req.param("id"), c.req.query("path") ?? "");
      return c.json(files); // bare array — matches the SPA's file-list contract
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  app.get("/sessions/:id/files/content", async (c) => {
    const path = c.req.query("path");
    if (!path) return c.json({ error: "path required" }, 400);
    try {
      return c.json(await manager.readSessionFile(c.req.param("id"), path));
    } catch (err) {
      return c.json({ error: (err as Error).message }, 404);
    }
  });

  app.get("/sessions/:id/files/raw", async (c) => {
    const path = c.req.query("path");
    if (!path) return c.json({ error: "path required" }, 400);
    try {
      const buf = await manager.readSessionFileRaw(c.req.param("id"), path);
      c.header("Content-Type", "application/octet-stream");
      c.header("Content-Length", String(buf.length));
      return c.body(buf as unknown as ArrayBuffer);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 404);
    }
  });

  app.delete("/sessions/:id/files", async (c) => {
    const path = c.req.query("path");
    if (!path) return c.json({ error: "path required" }, 400);
    try {
      const deleted = await manager.deleteSessionFile(c.req.param("id"), path);
      return c.json({ deleted }, deleted ? 200 : 404);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  // #47/#256: upload a file into the workspace. Two shapes negotiated by
  // Content-Type. Path-traversal guard + configurable size cap
  // (BP_UPLOAD_MAX_BYTES) live in SessionManager.
  app.post("/sessions/:id/files", async (c) => {
    const contentType = c.req.header("content-type") ?? "";
    // #256: raw streaming upload — bytes are the request body, path is in ?path=.
    if (contentType.includes("application/octet-stream")) {
      const path = c.req.query("path");
      if (!path || path.trim() === "") {
        return c.json({ error: "path query parameter is required" }, 400);
      }
      try {
        const res = await manager.writeSessionFileStream(
          c.req.param("id"),
          path,
          c.req.raw.body,
        );
        return c.json(res, 201);
      } catch (err) {
        // path traversal / oversize → 400 (client error), not 500
        return c.json({ error: (err as Error).message }, 400);
      }
    }
    // #47: base64 JSON body (backward-compatible / small files).
    const parsed = WriteFileRequestSchema.safeParse(await safeBody(c));
    if (!parsed.success) {
      return c.json({ error: "path and contentBase64 are required" }, 400);
    }
    try {
      const res = await manager.writeSessionFile(
        c.req.param("id"),
        parsed.data.path,
        parsed.data.contentBase64,
      );
      return c.json(res, 201);
    } catch (err) {
      const msg = (err as Error).message;
      // path traversal / oversize → 400 (client error), not 500
      return c.json({ error: msg }, 400);
    }
  });

  const sseHandler = async (id: string, c: import("hono").Context) => {
    await manager.ensureLoaded(id);
    if (!manager.getSession(id)) return c.json({ error: "not found" }, 404);
    c.header("Content-Type", "text/event-stream");
    c.header("Cache-Control", "no-cache");
    c.header("Connection", "keep-alive");
    return stream(c, async (s) => {
      let closed = false;
      const send = (event: unknown) => {
        if (closed) return;
        void s.write(`data: ${JSON.stringify(event)}\n\n`);
      };
      // Replay buffered events, then live-subscribe.
      for (const e of manager.recentEvents(id)) send(e);
      const unsub = manager.subscribe(id, send);
      s.onAbort(() => {
        closed = true;
        unsub?.();
      });
      // Keep the stream open until the client disconnects.
      await new Promise<void>((resolve) => {
        const iv = setInterval(() => {
          if (closed) {
            clearInterval(iv);
            resolve();
          } else {
            void s.write(": ping\n\n");
          }
        }, 15000);
      });
    });
  };
  app.get("/sse/:id", (c) => sseHandler(c.req.param("id"), c));
  app.get("/sessions/:id/events", (c) => sseHandler(c.req.param("id"), c));

  return { app, manager };
}

async function safeBody(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return {};
  }
}

export interface StartServerOptions extends SessionManagerOptions {
  port?: number;
  manager?: SessionManager;
}

export async function startServer(opts: StartServerOptions = {}): Promise<{
  manager: SessionManager;
  port: number;
  close: () => Promise<void>;
}> {
  const { app, manager } = createServer(opts);

  // #287: complete or recover the persistent-library layout migration before
  // restoring sessions or accepting requests. Unlike session restore, this is
  // a readiness gate: serving a half-migrated /data tree could split or hide
  // user data, so initialization failures intentionally abort startup.
  await manager.ensurePersistentLayout();

  // Restore sessions persisted under `<dataRoot>/.bp/*/meta.json` before we
  // accept the first HTTP request, so `GET /sessions` reflects history on
  // boot instead of an empty list. Persist defaults to true on the manager
  // (see SessionManagerOptions); we only skip restore when the caller
  // explicitly disabled persistence.
  if (opts.persist !== false) {
    try {
      const restored = await manager.restoreFromDisk();
      if (restored.length) {
        // eslint-disable-next-line no-console
        console.log(`[runtime] restored ${restored.length} session(s) from disk`);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[runtime] session restore failed:", err);
    }
  }

  // Materialize the built-in skills into <dataRoot>/bp_template/skills before we
  // accept requests, so they are loadable AND user-visible/editable from the
  // first agent on — including a pure `docker compose up` where no CLI scaffold
  // ever ran. Best-effort (the method swallows its own errors).
  await manager.ensureSkillsMaterialized();

  const port =
    opts.port ??
    (process.env.PORT ? Number(process.env.PORT) : undefined) ??
    (process.env.BP_RUNTIME_PORT ? Number(process.env.BP_RUNTIME_PORT) : undefined) ??
    8081;

  // Wait for the socket to be bound so callers (and tests using `port: 0`)
  // can talk to the server / read the kernel-assigned port immediately.
  let boundPort = port;
  const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
    const s = serve({ fetch: app.fetch, port }, (info) => {
      boundPort = info.port;
      resolve(s);
    });
  });

  // §R-4: surface the opt-in memory budget at boot (only when active).
  const memLimitMb = process.env.BP_MEM_LIMIT_MB;
  if (memLimitMb && Number(memLimitMb) > 0) {
    // eslint-disable-next-line no-console
    console.log(`[runtime] memory budget: ${Number(memLimitMb)}MB (soft watchdog @85%)`);
  }

  // §7 L4 global safety net.
  const onFatal = async (err: unknown) => {
    try {
      await manager.emergencySaveAll();
    } catch {
      /* best effort */
    }
    // eslint-disable-next-line no-console
    console.error("[runtime] fatal:", err);
  };
  process.on("uncaughtException", (err) => void onFatal(err));
  process.on("unhandledRejection", (reason) => void onFatal(reason));

  return {
    manager,
    port: boundPort,
    close: () =>
      new Promise<void>((resolve) => {
        manager.shutdown();
        (server as { close: (cb?: () => void) => void }).close(() => resolve());
      }),
  };
}

// Allow `node dist/server.js` to boot directly. Use pathToFileURL for the
// main-module check so it works on Windows too — a naive `file://${argv[1]}`
// never matches import.meta.url there (backslashes, drive letter, file:///).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void startServer().then(({ port }) => {
    // eslint-disable-next-line no-console
    console.log(`[runtime] listening on :${port} (mock=${process.env.BP_MOCK ?? "0"})`);
  });
}
