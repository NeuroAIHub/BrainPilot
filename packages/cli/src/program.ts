/**
 * program.ts — commander wiring for the `brainpilot` / `bnpt` CLI (§11A.4).
 * `buildProgram()` returns a configured Command; `run(argv)` parses + dispatches.
 * Kept separate from bin.ts so it can be invoked programmatically in tests.
 */
import { Command } from "commander";
import { createRequire } from "node:module";
import pc from "picocolors";
import { up } from "./commands/up.js";
import { down } from "./commands/down.js";
import { status } from "./commands/status.js";
import { init } from "./commands/init.js";
import { logs } from "./commands/logs.js";
import { spawnDetachedBackend } from "./spawn-backend.js";

/** Hooks injectable for tests so `run()` never touches a real server/process. */
export interface ProgramDeps {
  upFn?: typeof up;
  downFn?: typeof down;
  statusFn?: typeof status;
  initFn?: typeof init;
  logsFn?: typeof logs;
  log?: (msg: string) => void;
  /** Override process.exit (tests). */
  onError?: (err: Error) => void;
}

function parsePort(value: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n <= 0 || n > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return n;
}

/** Read the CLI package version from its own package.json (single source of truth). */
function requireVersion(): string {
  const require = createRequire(import.meta.url);
  const pkg = require("../package.json") as { version: string };
  return pkg.version;
}

export function buildProgram(deps: ProgramDeps = {}): Command {
  const program = new Command();
  const upFn = deps.upFn ?? up;
  const downFn = deps.downFn ?? down;
  const statusFn = deps.statusFn ?? status;
  const initFn = deps.initFn ?? init;
  const logsFn = deps.logsFn ?? logs;

  program
    .name("brainpilot")
    .description("BrainPilot — Docker-free local launcher (§11A)")
    .version(requireVersion());

  program
    .command("up")
    .description("Start the BrainPilot backend (+runtime) and open the UI (foreground by default; Ctrl-C to stop)")
    .option("-d, --dir <path>", "data directory (default ./brainpilot)")
    .option("-p, --port <n>", "backend port (runtime uses port+1)", parsePort)
    .option("--detach", "run the backend as a background process")
    .option("--no-open", "do not open the browser")
    .action(async (opts) => {
      const foreground = !opts.detach;
      await upFn(
        {
          dir: opts.dir,
          port: opts.port,
          foreground,
          open: opts.open,
        },
        { spawnDetached: spawnDetachedBackend },
      );
    });

  program
    .command("down")
    .description("Stop the background BrainPilot backend")
    .option("-d, --dir <path>", "data directory (default ./brainpilot)")
    .action(async (opts) => {
      await downFn({ dir: opts.dir });
    });

  program
    .command("status")
    .description("Report whether BrainPilot is running + health/metrics")
    .option("-d, --dir <path>", "data directory (default ./brainpilot)")
    .option("-p, --port <n>", "backend port", parsePort)
    .action(async (opts) => {
      await statusFn({ dir: opts.dir, port: opts.port });
    });

  program
    .command("init")
    .description("Scaffold the launch directory + persist a provider key")
    .option("-d, --dir <path>", "data directory (default ./brainpilot)")
    .option("-p, --port <n>", "default backend port", parsePort)
    .option("--api-key <key>", "provider API key to persist")
    .option("--base-url <url>", "provider base URL (gateway) to persist")
    .option("--model <id>", "default model id")
    .action(async (opts) => {
      await initFn({
        dir: opts.dir,
        port: opts.port,
        apiKey: opts.apiKey,
        baseUrl: opts.baseUrl,
        model: opts.model,
      });
    });

  program
    .command("logs")
    .description("Tail the backend/runtime logs")
    .option("-d, --dir <path>", "data directory (default ./brainpilot)")
    .option("--runtime", "show the runtime log instead of the backend log", false)
    .option("-n, --lines <n>", "trailing lines to show", (v) => parseInt(v, 10), 200)
    .option("-f, --follow", "follow the log (tail -f)", false)
    .action(async (opts) => {
      await logsFn({
        dir: opts.dir,
        which: opts.runtime ? "runtime" : "backend",
        lines: opts.lines,
        follow: opts.follow,
      });
    });

  return program;
}

/**
 * Parse `argv` and dispatch. `argv` excludes node + script (commander's
 * `from: "user"`). Returns the commander result; throws are surfaced unless an
 * `onError` hook is provided.
 */
export async function run(
  argv: string[],
  deps: ProgramDeps = {},
): Promise<void> {
  const program = buildProgram(deps);
  program.exitOverride();
  try {
    await program.parseAsync(argv, { from: "user" });
  } catch (err) {
    const log = deps.log ?? ((m: string) => console.error(m));
    // commander's help/version throw with these codes — not real errors.
    const code = (err as { code?: string }).code;
    if (code === "commander.helpDisplayed" || code === "commander.version") {
      return;
    }
    if (deps.onError) {
      deps.onError(err as Error);
      return;
    }
    log(pc.red((err as Error).message));
    throw err;
  }
}
