/**
 * server.ts — boots the Hono app via @hono/node-server (§11A.3 / §11A.4 step 4).
 * Exported via the package's `./server` entry. The orchestrator's runtime is
 * started lazily on the first request that needs it; graceful shutdown stops it.
 */
import { serve, type ServerType } from "@hono/node-server";
import { createApp, type CreateAppOptions } from "./app.js";
import { createOrchestrator } from "./create-orchestrator.js";
import type { Orchestrator } from "./orchestrator.js";

export interface StartServerOptions extends Partial<CreateAppOptions> {
  /** Backend port. Default 9001 (§11A.5 决策 D). */
  port?: number;
  hostname?: string;
  /** Provide a pre-built orchestrator; otherwise one is created from env. */
  orchestrator?: Orchestrator;
  /** Eagerly ensure the runtime at boot (default false — lazy on first use). */
  eager?: boolean;
  /** When true, the runtime child inherits stdio (foreground CLI mode). */
  stdioInherit?: boolean;
}

export interface RunningServer {
  server: ServerType;
  orchestrator: Orchestrator;
  port: number;
  stop: () => Promise<void>;
}

export async function startServer(
  options: StartServerOptions = {},
): Promise<RunningServer> {
  const port = options.port ?? Number(process.env.PORT ?? 9001);
  // 127.0.0.1 is the safe default for local/CLI use; containers set BP_HOST=0.0.0.0
  // so the published port (DNAT'd to the container IP) can reach the server.
  const hostname = options.hostname ?? process.env.BP_HOST ?? "127.0.0.1";
  const orchestrator =
    options.orchestrator ??
    createOrchestrator({
      local: options.stdioInherit ? { stdioInherit: true } : undefined,
    });

  const app = createApp({
    orchestrator,
    dataDir: options.dataDir,
    webRoot: options.webRoot,
    fetchFn: options.fetchFn,
    serveWeb: options.serveWeb,
    env: options.env,
  });

  if (options.eager) {
    await orchestrator.ensureRuntime();
  }

  const server = serve({ fetch: app.fetch, port, hostname });

  const stop = async (): Promise<void> => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await orchestrator.stopRuntime();
  };

  // Graceful shutdown on signals. Containers run no PM2 inside; a fatal/OOM
  // cleanly exits and Docker's `restart` policy is the backstop (§R-4 / #20).
  const onSignal = (): void => {
    void stop().finally(() => process.exit(0));
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  return { server, orchestrator, port, stop };
}

// Allow `node dist/server.js` to boot directly.
const isMain =
  typeof process.argv[1] === "string" &&
  import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  startServer().then(
    (s) => {
      // eslint-disable-next-line no-console
      console.log(`[backend-core] listening on port ${s.port}`);
    },
    (err) => {
      // eslint-disable-next-line no-console
      console.error("[backend-core] failed to start:", err);
      process.exit(1);
    },
  );
}
