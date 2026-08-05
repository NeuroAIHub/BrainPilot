/**
 * program.ts — commander wiring for the `brainpilot` / `bnpt` CLI (§11A.4).
 * `buildProgram()` returns a configured Command; `run(argv)` parses + dispatches.
 * Kept separate from bin.ts so it can be invoked programmatically in tests.
 */
import { Command } from "commander";
import { createRequire } from "node:module";
import pc from "picocolors";
import { ProviderApiSchema, type ProviderApi } from "@brainpilot/protocol";
import { up } from "./commands/up.js";
import { down } from "./commands/down.js";
import { status } from "./commands/status.js";
import { init } from "./commands/init.js";
import { logs } from "./commands/logs.js";
import { runList, runDiff, runReset } from "./commands/template.js";
import { spawnDetachedBackend } from "./spawn-backend.js";
import { pluginCreate, pluginImport, pluginPack, pluginTest, pluginValidate } from "./commands/plugin.js";

/** Hooks injectable for tests so `run()` never touches a real server/process. */
export interface ProgramDeps {
  upFn?: typeof up;
  downFn?: typeof down;
  statusFn?: typeof status;
  initFn?: typeof init;
  logsFn?: typeof logs;
  templateListFn?: typeof runList;
  templateDiffFn?: typeof runDiff;
  templateResetFn?: typeof runReset;
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

function parseMode(value: string): "local" | "static" | "docker" {
  const v = value.toLowerCase();
  if (v === "local" || v === "static" || v === "docker") return v;
  throw new Error(`Invalid mode: ${value} (expected local | static | docker)`);
}

function parseProviderApi(value: string): ProviderApi {
  const parsed = ProviderApiSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Invalid provider API: ${value} (expected anthropic-messages | openai-completions | openai-responses | azure-openai-responses)`,
    );
  }
  return parsed.data;
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
  const templateListFn = deps.templateListFn ?? runList;
  const templateDiffFn = deps.templateDiffFn ?? runDiff;
  const templateResetFn = deps.templateResetFn ?? runReset;

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
    .option(
      "--mode <mode>",
      "orchestrator mode: local (default) | static (connect BP_RUNTIME_URL) | docker",
      parseMode,
    )
    .action(async (opts) => {
      const foreground = !opts.detach;
      await upFn(
        {
          dir: opts.dir,
          port: opts.port,
          foreground,
          open: opts.open,
          mode: opts.mode,
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
    .option("--api <protocol>", "provider wire protocol", parseProviderApi)
    .action(async (opts) => {
      await initFn({
        dir: opts.dir,
        port: opts.port,
        apiKey: opts.apiKey,
        baseUrl: opts.baseUrl,
        model: opts.model,
        api: opts.api,
      });
    });

  const template = program
    .command("template")
    .description("Inspect and manage on-disk agent prompt overrides (bp_template/agents/<name>/prompt.md)");

  template
    .command("list")
    .description("Show drift status of every built-in agent's prompt")
    .option("-d, --dir <path>", "data directory (default ./brainpilot)")
    .action(async (opts) => {
      await templateListFn({ dir: opts.dir });
    });

  const plugin = program
    .command("plugin")
    .description("Create, validate, test, and package BrainPilot plugins");

  plugin
    .command("import <directory>")
    .option("--format <format>", "source format: auto | codex | claude-code | pi-package", "auto")
    .option("-d, --dir <path>", "data directory (default ./brainpilot)")
    .description("Import a local Codex, Claude Code, or Pi package")
    .action(async (directory, opts) => {
      const format = String(opts.format);
      if (format !== "auto" && format !== "codex" && format !== "claude-code" && format !== "pi-package") throw new Error(`Invalid plugin format: ${format}`);
      await pluginImport({ source: directory, dataDir: opts.dir, format });
    });

  plugin
    .command("create <directory>")
    .requiredOption("--id <id>", "reverse-domain plugin id, e.g. org.example.viewer")
    .description("Create a Preview Plugin SDK v1 project")
    .action(async (directory, opts) => pluginCreate({ dir: directory, id: opts.id }));

  plugin
    .command("validate [directory]")
    .description("Validate a plugin manifest")
    .action(async (directory = ".") => pluginValidate({ dir: directory }));

  plugin
    .command("pack [directory]")
    .option("-o, --output <path>", "bundle output path")
    .description("Validate and create a marketplace bundle")
    .action(async (directory = ".", opts) => pluginPack({ dir: directory, output: opts.output }));

  plugin
    .command("test [directory]")
    .option("--environment <environment>", "host shape: local | cloud | browser", (value) => {
      if (value !== "local" && value !== "cloud" && value !== "browser") {
        throw new Error(`Invalid plugin environment: ${value}`);
      }
      return value as "local" | "cloud" | "browser";
    }, "local")
    .description("Run plugin conformance and host compatibility checks")
    .action(async (directory = ".", opts) => pluginTest({ dir: directory, environment: opts.environment }));

  template
    .command("diff [agent]")
    .description("Show local-vs-built-in diff for drifted agents (or one named agent)")
    .option("-d, --dir <path>", "data directory (default ./brainpilot)")
    .action(async (agent, opts) => {
      await templateDiffFn({ dir: opts.dir, agent });
    });

  template
    .command("reset [agent]")
    .description("Overwrite local prompt(s) with the built-in version (backs up any existing file)")
    .option("-d, --dir <path>", "data directory (default ./brainpilot)")
    .option("-y, --yes", "skip the confirmation prompt", false)
    .action(async (agent, opts) => {
      await templateResetFn({ dir: opts.dir, agent, yes: opts.yes });
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
