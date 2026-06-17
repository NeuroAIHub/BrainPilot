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
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { stream } from "hono/streaming";
import {
  CreateSessionRequestSchema,
  SendMessageRequestSchema,
  InterruptRequestSchema,
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
    const input = parsed.success ? parsed.data : {};
    const session = await manager.createSession(input);
    return c.json({ id: session.id, session }, 201);
  });

  app.get("/sessions", (c) => c.json({ sessions: manager.listSessions() }));

  app.get("/sessions/:id", (c) => {
    const s = manager.getSession(c.req.param("id"));
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

  app.get("/sessions/:id/state", (c) => {
    const state = manager.getSessionState(c.req.param("id"));
    return state ? c.json(state) : c.json({ error: "not found" }, 404);
  });

  app.get("/sessions/:id/trace", (c) => {
    const graph = manager.getTrace(c.req.param("id"));
    return graph ? c.json(graph) : c.json({ error: "not found" }, 404);
  });

  app.post("/sessions/:id/messages", async (c) => {
    const id = c.req.param("id");
    const body = await safeBody(c);
    const parsed = SendMessageRequestSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "invalid body" }, 400);
    if (!manager.getSession(id)) return c.json({ error: "not found" }, 404);
    const res = await manager.sendMessage(id, parsed.data.content, parsed.data.agent ?? "principal", {
      uuid: parsed.data.data?.uuid,
    });
    return c.json(res);
  });

  app.post("/sessions/:id/interrupt", async (c) => {
    const id = c.req.param("id");
    const body = await safeBody(c);
    const parsed = InterruptRequestSchema.safeParse(body);
    const agent = parsed.success ? parsed.data.agent : undefined;
    const interrupted = await manager.interrupt(id, agent);
    return c.json({ interrupted });
  });

  app.get("/sessions/:id/agents", (c) => c.json({ agents: manager.listAgents(c.req.param("id")) }));

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

  const sseHandler = (id: string, c: import("hono").Context) => {
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

export function startServer(opts: StartServerOptions = {}): {
  manager: SessionManager;
  port: number;
  close: () => Promise<void>;
} {
  const { app, manager } = createServer(opts);
  const port =
    opts.port ??
    (process.env.PORT ? Number(process.env.PORT) : undefined) ??
    (process.env.BP_RUNTIME_PORT ? Number(process.env.BP_RUNTIME_PORT) : undefined) ??
    8081;

  const server = serve({ fetch: app.fetch, port });

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
    port,
    close: () =>
      new Promise<void>((resolve) => {
        manager.shutdown();
        (server as { close: (cb?: () => void) => void }).close(() => resolve());
      }),
  };
}

// Allow `node dist/server.js` to boot directly.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const { port } = startServer();
  // eslint-disable-next-line no-console
  console.log(`[runtime] listening on :${port} (mock=${process.env.BP_MOCK ?? "0"})`);
}
