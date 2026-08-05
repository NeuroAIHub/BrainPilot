import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

export interface CompatPluginProjection {
  schemaVersion: 1;
  id: string;
  version: string;
  format: "brainpilot" | "pi-package" | "codex" | "claude-code";
  root: string;
  dataDir: string;
  mcpConfigPath?: string;
  hookConfig?: { dialect: "codex" | "claude-code"; path: string };
  extensionPaths?: string[];
}

interface HookCommand {
  type: string;
  command?: string;
  commandWindows?: string;
  shell?: string;
  timeout?: number;
  async?: boolean;
}

interface HookMatcher { matcher?: string; hooks?: HookCommand[] }
interface HookFile { hooks?: Record<string, HookMatcher[]> }

export interface CompatHookResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  additionalContext?: string;
}

export type CompatHookEventName = "Setup" | "SessionStart" | "UserPromptSubmit" | "PreToolUse" | "PostToolUse" | "PostToolUseFailure" | "Stop";

async function readHookFile(projection: CompatPluginProjection): Promise<HookFile | null> {
  if (!projection.hookConfig) return null;
  try {
    const parsed = JSON.parse(await fs.readFile(projection.hookConfig.path, "utf8")) as unknown;
    return parsed && typeof parsed === "object" ? parsed as HookFile : null;
  } catch (error) {
    console.warn(`[plugin:${projection.id}] could not read hooks: ${(error as Error).message}`);
    return null;
  }
}

function toolAlias(toolName: string): string {
  const aliases: Record<string, string> = {
    bash: "Bash", read: "Read", write: "Write", edit: "Edit", grep: "Grep", find: "Glob", ls: "Glob",
  };
  return aliases[toolName] ?? toolName;
}

function matches(matcher: string | undefined, subject: string): boolean {
  if (!matcher || matcher === "*") return true;
  try { return new RegExp(matcher).test(subject); }
  catch { return matcher === subject; }
}

function extractAdditionalContext(stdout: string): string | undefined {
  const trimmed = stdout.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const hookSpecific = parsed.hookSpecificOutput;
    if (hookSpecific && typeof hookSpecific === "object" && typeof (hookSpecific as Record<string, unknown>).additionalContext === "string") {
      return (hookSpecific as Record<string, unknown>).additionalContext as string;
    }
    if (typeof parsed.additionalContext === "string") return parsed.additionalContext;
    if (typeof parsed.systemMessage === "string") return parsed.systemMessage;
    if (parsed.continue === true || parsed.suppressOutput === true) return undefined;
  } catch { /* plain stdout is context for context-producing hooks */ }
  return trimmed;
}

function executeCommand(
  projection: CompatPluginProjection,
  command: HookCommand,
  payload: Record<string, unknown>,
): Promise<CompatHookResult> {
  return new Promise((resolve) => {
    const commandText = process.platform === "win32" && command.commandWindows ? command.commandWindows : command.command;
    if (!commandText) return resolve({ ok: false, stdout: "", stderr: "missing command" });
    const child = spawn(commandText, {
      cwd: projection.root,
      shell: command.shell || true,
      windowsHide: true,
      env: {
        ...process.env,
        BRAINPILOT_PLUGIN_ROOT: projection.root,
        BRAINPILOT_PLUGIN_DATA: projection.dataDir,
        CLAUDE_PLUGIN_ROOT: projection.root,
        CLAUDE_PLUGIN_DATA: projection.dataDir,
        CLAUDE_MEM_DATA_DIR: projection.dataDir,
        PLUGIN_ROOT: projection.root,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    const timeoutMs = Math.max(1, command.timeout ?? 600) * 1_000;
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      console.warn(`[plugin:${projection.id}] hook failed to start: ${error.message}`);
      resolve({ ok: false, stdout, stderr: `${stderr}${error.message}` });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code !== 0) console.warn(`[plugin:${projection.id}] hook exited ${code ?? signal ?? "unknown"}${stderr.trim() ? `: ${stderr.trim()}` : ""}`);
      resolve({ ok: code === 0, stdout, stderr, ...(code === 0 ? { additionalContext: extractAdditionalContext(stdout) } : {}) });
    });
    child.stdin?.end(JSON.stringify(payload));
  });
}

/** Execute matching command handlers. Failures are warnings and never block the agent loop. */
export async function runCompatHookEvent(
  projection: CompatPluginProjection,
  eventName: CompatHookEventName,
  payload: Record<string, unknown>,
  matchSubject = "*",
): Promise<CompatHookResult[]> {
  const file = await readHookFile(projection);
  const groups = file?.hooks?.[eventName] ?? [];
  const awaited: Array<Promise<CompatHookResult>> = [];
  for (const group of groups) {
    if (!matches(group.matcher, matchSubject)) continue;
    for (const command of group.hooks ?? []) {
      if (command.type !== "command") {
        console.warn(`[plugin:${projection.id}] unsupported ${command.type} hook handler skipped`);
        continue;
      }
      const execution = executeCommand(projection, command, payload);
      if (command.async) void execution.catch((error) => console.warn(`[plugin:${projection.id}] async hook failed: ${(error as Error).message}`));
      else awaited.push(execution);
    }
  }
  return Promise.all(awaited);
}

export async function loadCompatPluginProjections(dataRoot: string): Promise<CompatPluginProjection[]> {
  const runtimeDir = path.join(dataRoot, "plugins", "runtime");
  let entries: string[];
  try { entries = (await fs.readdir(runtimeDir)).filter((entry) => entry.endsWith(".json")); }
  catch { return []; }
  const projections: CompatPluginProjection[] = [];
  for (const entry of entries.sort()) {
    try {
      const value = JSON.parse(await fs.readFile(path.join(runtimeDir, entry), "utf8")) as CompatPluginProjection;
      if (value?.schemaVersion === 1 && typeof value.id === "string" && typeof value.root === "string" && typeof value.dataDir === "string") projections.push(value);
    } catch (error) {
      console.warn(`[plugin] invalid runtime projection ${entry}: ${(error as Error).message}`);
    }
  }
  return projections;
}

interface CompatPiApi {
  on(event: "session_start", handler: (event: { reason: string }, ctx: CompatContext) => void | Promise<void>): void;
  on(event: "before_agent_start", handler: (event: { prompt: string; systemPrompt: string }, ctx: CompatContext) => unknown | Promise<unknown>): void;
  on(event: "tool_call", handler: (event: { toolName: string; toolCallId: string; input: Record<string, unknown> }, ctx: CompatContext) => void | Promise<void>): void;
  on(event: "tool_result", handler: (event: { toolName: string; toolCallId: string; input: Record<string, unknown>; content: unknown; details?: unknown; isError: boolean }, ctx: CompatContext) => void | Promise<void>): void;
  on(event: "agent_settled", handler: (_event: unknown, ctx: CompatContext) => void | Promise<void>): void;
}

interface CompatContext {
  cwd: string;
  sessionManager?: { getSessionId?(): string; getSessionFile?(): string | undefined };
}

function basePayload(projection: CompatPluginProjection, ctx: CompatContext, eventName: CompatHookEventName): Record<string, unknown> {
  return {
    session_id: ctx.sessionManager?.getSessionId?.() ?? process.env.BP_SESSION_ID ?? "",
    transcript_path: ctx.sessionManager?.getSessionFile?.(),
    cwd: ctx.cwd,
    hook_event_name: eventName,
    plugin_id: projection.id,
  };
}

/** Build one Pi extension that fans lifecycle events out to all enabled foreign plugins. */
export function makeCompatHooksExt(projections: CompatPluginProjection[]): (pi: CompatPiApi) => void {
  return (pi) => {
    const pendingSessionContext = new Map<string, string[]>();
    pi.on("session_start", async (event, ctx) => {
      for (const projection of projections) {
        const source = projection.hookConfig?.dialect === "codex" && event.reason === "resume"
          ? "resume"
          : "startup";
        const results = await runCompatHookEvent(projection, "SessionStart", { ...basePayload(projection, ctx, "SessionStart"), source }, source);
        const context = results.flatMap((result) => result.additionalContext ? [result.additionalContext] : []);
        if (context.length) pendingSessionContext.set(projection.id, context);
      }
    });
    pi.on("before_agent_start", async (event, ctx) => {
      const additions: string[] = [];
      for (const projection of projections) {
        additions.push(...pendingSessionContext.get(projection.id) ?? []);
        pendingSessionContext.delete(projection.id);
        const results = await runCompatHookEvent(projection, "UserPromptSubmit", {
          ...basePayload(projection, ctx, "UserPromptSubmit"), prompt: event.prompt,
        });
        additions.push(...results.flatMap((result) => result.additionalContext ? [result.additionalContext] : []));
      }
      return additions.length ? { systemPrompt: `${event.systemPrompt}\n\n${additions.join("\n\n")}` } : undefined;
    });
    pi.on("tool_call", async (event, ctx) => {
      const alias = toolAlias(event.toolName);
      for (const projection of projections) await runCompatHookEvent(projection, "PreToolUse", {
        ...basePayload(projection, ctx, "PreToolUse"), tool_name: alias, tool_input: event.input, tool_use_id: event.toolCallId,
      }, alias);
    });
    pi.on("tool_result", async (event, ctx) => {
      const alias = toolAlias(event.toolName);
      const eventName = event.isError ? "PostToolUseFailure" as const : "PostToolUse" as const;
      for (const projection of projections) await runCompatHookEvent(projection, eventName, {
        ...basePayload(projection, ctx, eventName), tool_name: alias, tool_input: event.input,
        tool_response: event.content, tool_use_id: event.toolCallId,
      }, alias);
    });
    pi.on("agent_settled", async (_event, ctx) => {
      for (const projection of projections) await runCompatHookEvent(projection, "Stop", basePayload(projection, ctx, "Stop"));
    });
  };
}
