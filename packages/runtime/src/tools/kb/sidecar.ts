/**
 * Lazy bge model sidecar.
 *
 * bge-m3 and bge-reranker-v2-m3 take 5–20 s to load and ~2.5 GB of RAM —
 * way too much for a per-query cost. The runtime keeps ONE shared Python
 * sub-process running for the lifetime of the BrainPilot session and
 * routes every embed/rerank call to it over loopback HTTP.
 *
 * Lifecycle:
 *   - cold:   no child, no port, no readiness — first caller triggers start()
 *   - starting:  child spawned with --port 0, port file polled until readable
 *               then `/health` polled until `embedder_loaded === true`
 *   - ready:  every caller resolves to the same { url } record
 *   - dead:   if the process exits, the next call retries from cold
 *
 * The user can bypass the sidecar entirely by setting `BP_KB_SERVER_URL`
 * (point at a pre-existing model server). In that case we skip the spawn
 * and just probe that URL.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveKbPaths, type KbPaths } from "./paths.js";
import { resolveKbPython } from "./python.js";

const HEALTH_TIMEOUT_MS = 60_000; // first PyTorch load can be slow on CPU
const POLL_INTERVAL_MS = 500;

interface SidecarState {
  paths: KbPaths;
  proc?: ChildProcess;
  port?: number;
  url?: string;
  ready: Promise<string> | null;
}

let STATE: SidecarState | null = null;

async function pollPortFile(path: string, deadlineMs: number): Promise<number> {
  while (Date.now() < deadlineMs) {
    if (existsSync(path)) {
      try {
        const text = (await readFile(path, "utf8")).trim();
        const port = Number(text);
        if (Number.isInteger(port) && port > 0) return port;
      } catch {
        /* race: writer mid-write, keep polling */
      }
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`sidecar did not publish its port within ${HEALTH_TIMEOUT_MS}ms`);
}

async function pollHealth(url: string, deadlineMs: number): Promise<void> {
  let lastErr: unknown = null;
  while (Date.now() < deadlineMs) {
    try {
      const r = await fetch(url + "/health");
      if (r.ok) {
        const h = (await r.json()) as { embedder_loaded?: boolean; reranker_loaded?: boolean };
        if (h.embedder_loaded && h.reranker_loaded) return;
      }
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(
    `sidecar at ${url} not ready in ${HEALTH_TIMEOUT_MS}ms${
      lastErr ? `: ${(lastErr as Error).message}` : ""
    }`,
  );
}

async function startSidecar(rootOverride?: string): Promise<string> {
  // Honour an out-of-process server set by the operator. Useful for: shared
  // GPU box, dev iteration without restarting BrainPilot, integration tests.
  const overrideUrl = process.env.BP_KB_SERVER_URL?.trim();
  if (overrideUrl) {
    await pollHealth(overrideUrl, Date.now() + HEALTH_TIMEOUT_MS);
    return overrideUrl;
  }

  const paths = resolveKbPaths(rootOverride);
  if (!existsSync(paths.serverScript)) {
    throw new Error(
      `KnowledgeBase model_server.py not found at ${paths.serverScript} — ` +
        `is the KnowledgeBase/ directory present alongside the runtime install?`,
    );
  }
  if (!existsSync(paths.embedModelDir) || !existsSync(paths.rerankerModelDir)) {
    throw new Error(
      `bge model weights missing under ${paths.modelsDir} — ` +
        `run "python KnowledgeBase/scripts/setup_models.py" first.`,
    );
  }

  const dir = await mkdtemp(join(tmpdir(), "bp-kb-"));
  const portFile = join(dir, "port");

  const child = spawn(
    resolveKbPython(paths.root),
    [paths.serverScript, "--kb-root", paths.root, "--port", "0", "--port-file", portFile],
    {
      stdio: ["ignore", "inherit", "inherit"],
      env: {
        ...process.env,
        BP_KB_ROOT: paths.root,
      },
    },
  );

  child.on("exit", (code, sig) => {
    // eslint-disable-next-line no-console
    console.warn(`[kb-sidecar] exited code=${code} signal=${sig}`);
    // Drop the cached state so the next caller respawns.
    if (STATE && STATE.proc === child) {
      STATE.proc = undefined;
      STATE.port = undefined;
      STATE.url = undefined;
      STATE.ready = null;
    }
  });

  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let port: number;
  try {
    port = await pollPortFile(portFile, deadline);
  } catch (err) {
    child.kill("SIGTERM");
    throw err;
  } finally {
    void unlink(portFile).catch(() => {});
  }

  const url = `http://127.0.0.1:${port}`;
  try {
    await pollHealth(url, deadline);
  } catch (err) {
    child.kill("SIGTERM");
    throw err;
  }

  // eslint-disable-next-line no-console
  console.info(`[kb-sidecar] ready at ${url}`);

  if (STATE) {
    STATE.proc = child;
    STATE.port = port;
    STATE.url = url;
  }
  return url;
}

/** Return the sidecar URL, starting the child if needed. Concurrent callers
 *  share a single startup promise. */
export async function ensureSidecar(rootOverride?: string): Promise<string> {
  const paths = resolveKbPaths(rootOverride);
  if (!STATE || STATE.paths.root !== paths.root) {
    STATE = { paths, ready: null };
  }
  if (STATE.url) return STATE.url;
  if (!STATE.ready) {
    STATE.ready = startSidecar(rootOverride).catch((err) => {
      // Clear so the next call retries instead of returning a rejected promise forever.
      if (STATE) STATE.ready = null;
      throw err;
    });
  }
  return STATE.ready;
}

/** Best-effort shutdown — called from server.ts on signal. */
export function stopSidecar(): void {
  if (STATE?.proc && !STATE.proc.killed) {
    STATE.proc.kill("SIGTERM");
  }
  STATE = null;
}

/** Read-only inspection helper for the health UI. */
export function sidecarStatus(): { running: boolean; url?: string } {
  return { running: !!STATE?.url, url: STATE?.url };
}
