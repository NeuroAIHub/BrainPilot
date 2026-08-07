import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import type { RuntimeExtensionDescriptor } from "@brainpilot/protocol";
import type { RuntimePluginHostContext, RuntimeProcessResult } from "@brainpilot/plugin-sdk";
import type { WorkspaceCheckpointStore } from "./workspace-checkpoints.js";

const MAX_PROCESS_OUTPUT = 64 * 1024;

interface RuntimePluginModule {
  default?: (context: RuntimePluginHostContext) => unknown | Promise<unknown>;
}

function safeStoragePath(root: string, name: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) throw new Error(`invalid plugin storage name: ${name}`);
  return join(root, name);
}

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await fs.mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  await fs.rename(temporary, file);
}

function execute(command: string, cwd: string, timeoutMs: number): Promise<RuntimeProcessResult> {
  return new Promise((resolveResult) => {
    const started = Date.now();
    const child = spawn("bash", ["-lc", command], { cwd, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let timedOut = false;
    const append = (current: Buffer, chunk: Buffer) => Buffer.concat([current, chunk]).subarray(-MAX_PROCESS_OUTPUT);
    child.stdout.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid) {
        try { process.kill(process.platform === "win32" ? child.pid : -child.pid, "SIGTERM"); }
        catch { child.kill("SIGTERM"); }
      }
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      resolveResult({ exitCode: null, stdout: stdout.toString("utf8"), stderr: `${stderr.toString("utf8")}\n${error.message}`.trim(), durationMs: Date.now() - started, timedOut });
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolveResult({ exitCode: code, stdout: stdout.toString("utf8"), stderr: stderr.toString("utf8"), durationMs: Date.now() - started, timedOut });
    });
  });
}

export interface LoadRuntimePluginOptions {
  dataRoot: string;
  descriptor: RuntimeExtensionDescriptor;
  sessionId: string;
  agentName: string;
  cwd: string;
  checkpoints: WorkspaceCheckpointStore;
  acquireLease(owner: string): boolean;
  releaseLease(owner: string): void;
  ownsLease(owner: string): boolean;
  emit(name: string, value: unknown): void;
}

/** Load one explicitly trusted executable plugin entry and bind scoped host services. */
export async function loadRuntimePluginExtension(options: LoadRuntimePluginOptions): Promise<unknown> {
  const { descriptor } = options;
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)+$/.test(descriptor.pluginId) || !/^\d+\.\d+\.\d+/.test(descriptor.pluginVersion)) {
    throw new Error("invalid runtime plugin identity");
  }
  if (descriptor.entry.startsWith("/") || descriptor.entry.split(/[\\/]/).includes("..")) throw new Error("runtime plugin entry escapes bundle");
  const root = resolve(options.dataRoot, "plugins", "installed", descriptor.pluginId, descriptor.pluginVersion);
  const entry = resolve(root, descriptor.entry);
  if (!entry.startsWith(`${root}${sep}`)) throw new Error("runtime plugin entry escapes bundle");
  await fs.access(entry);
  const storageRoot = join(options.dataRoot, ".bp", options.sessionId, "plugins", descriptor.pluginId, options.agentName);
  const permissions = new Set(descriptor.permissions);
  const owner = `${descriptor.pluginId}:${options.agentName}`;
  const requirePermission = (permission: string) => {
    if (!permissions.has(permission as never)) throw new Error(`runtime plugin lacks permission: ${permission}`);
  };
  const context: RuntimePluginHostContext = {
    sessionId: options.sessionId,
    agentName: options.agentName,
    cwd: options.cwd,
    storage: {
      async readJson(name) {
        try { return JSON.parse(await fs.readFile(safeStoragePath(storageRoot, name), "utf8")) as unknown; }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
      },
      writeJson: (name, value) => writeJsonAtomic(safeStoragePath(storageRoot, name), value),
      async appendJsonl(name, value) {
        const file = safeStoragePath(storageRoot, name);
        await fs.mkdir(dirname(file), { recursive: true });
        await fs.appendFile(file, JSON.stringify(value) + "\n", { mode: 0o600 });
      },
    },
    checkpoints: {
      capture(kind) { requirePermission("workspace:checkpoint"); return options.checkpoints.capture(options.agentName, kind); },
      preview(id) { requirePermission("workspace:checkpoint"); return options.checkpoints.preview(id); },
      restore(id, stateToken) { requirePermission("workspace:checkpoint"); return options.checkpoints.restore(id, stateToken); },
      provenance(id) { requirePermission("workspace:checkpoint"); return options.checkpoints.provenance(id); },
    },
    workspaceLease: {
      acquire() { requirePermission("write:workspace"); return options.acquireLease(owner); },
      release() { options.releaseLease(owner); },
      owned() { return options.ownsLease(owner); },
    },
    execProcess(command, timeoutMs = 600_000) {
      requirePermission("execute:process");
      return execute(command, options.cwd, Math.max(1_000, Math.min(600_000, Math.trunc(timeoutMs))));
    },
    emit: options.emit,
  };
  // Runtime entries are self-contained ESM modules. Loading the validated bytes
  // as a data URL works in Node and under the test/bundle loader without giving
  // the plugin an opportunity to redirect resolution outside its bundle.
  const source = await fs.readFile(entry);
  const moduleUrl = `data:text/javascript;base64,${source.toString("base64")}`;
  const imported = await import(/* @vite-ignore */ moduleUrl) as RuntimePluginModule;
  if (typeof imported.default !== "function") throw new Error(`runtime plugin entry must default-export a factory: ${descriptor.entry}`);
  return imported.default(context);
}
