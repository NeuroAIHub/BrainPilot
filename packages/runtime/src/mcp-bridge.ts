/**
 * External MCP bridge (§9 decision 2).
 *
 * Pi 0.79 has NO built-in MCP — by design it pushes such workflows to custom
 * tools (https://pi.dev/docs/latest/usage). So we bridge: read `mcp_servers.json`,
 * connect each declared server with `@modelcontextprotocol/sdk`, `tools/list`,
 * and expose every discovered MCP tool as a BrainPilot `SystemTool` (which the
 * real agent factory then wraps with Pi's `defineTool`).
 *
 * Tools are namespaced `mcp__<server>__<tool>` to avoid cross-server collisions.
 * A failing server is recorded and skipped — it never aborts the others.
 *
 * Config shape (standard MCP/Claude format). Three transports are supported,
 * selected by the optional `type` field (defaults to "stdio" for back-compat):
 *   stdio: { "fs":  { "command": "npx", "args": ["-y", "..."], "env": {} } }
 *   http:  { "api": { "type": "http", "url": "https://host/mcp", "headers": {} } }
 *   sse:   { "evt": { "type": "sse",  "url": "https://host/sse", "headers": {} } }
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isWindows } from "./platform.js";
import type { SystemTool, SystemToolResult } from "./types.js";
import { loadCompatPluginProjections } from "./compat-hooks.js";

/**
 * Per-tool-call request timeout for MCP servers, in milliseconds.
 *
 * The MCP SDK's default is 60_000 ms (`DEFAULT_REQUEST_TIMEOUT_MSEC` in
 * `@modelcontextprotocol/sdk/dist/esm/shared/protocol.js`). That's too short
 * for BrainPilot's real workloads — remote paper search, deep KB retrieval,
 * or provider-hosted MCP tools that batch multi-second LLM calls all blow
 * past 60 s intermittently, surfacing to the model as `RequestTimeout`.
 * Raise it to 5 minutes; combined with `resetTimeoutOnProgress` below, a
 * well-behaved server that streams progress notifications will not time out
 * mid-work, while a hung server still fails within a bounded wall-clock.
 */
export const MCP_TOOL_CALL_TIMEOUT_MS = 5 * 60_000;

/**
 * Reset the per-call timer whenever the MCP server sends a `progress`
 * notification. This has NO effect on servers that never send progress
 * (which is most of them) — they still fail after `MCP_TOOL_CALL_TIMEOUT_MS`.
 * For servers that DO stream progress on long tasks, it lets the tool run as
 * long as it keeps making visible headway.
 */
const MCP_RESET_TIMEOUT_ON_PROGRESS = true;

/** Wire transport for an MCP server. Absent ⇒ "stdio" (back-compat). */
export type McpTransportType = "stdio" | "http" | "sse";

export interface McpServerSpec {
  /** Transport. Defaults to "stdio" when omitted. */
  type?: McpTransportType;
  /** stdio: executable to spawn. */
  command?: string;
  /** stdio: arguments for `command`. */
  args?: string[];
  /** stdio: extra environment for the spawned process. */
  env?: Record<string, string>;
  /** http/sse: endpoint URL of the remote MCP server. */
  url?: string;
  /** http/sse: extra HTTP headers (e.g. Authorization) sent on every request. */
  headers?: Record<string, string>;
}

export interface McpServersConfig {
  mcpServers: Record<string, McpServerSpec>;
  /** Plugin id for servers contributed by an enabled plugin. */
  serverOwners?: Record<string, string>;
}

export interface McpConnectionFailure {
  server: string;
  error: string;
}

export interface McpConnectResult {
  tools: SystemTool[];
  connectedServers: string[];
  skippedServers: string[];
  failures: McpConnectionFailure[];
}

export interface McpRuntimeServerStatus {
  name: string;
  pluginId?: string;
  state: "ready" | "failed";
  error?: string;
}

export interface McpRuntimeStatus {
  state: "not_loaded" | "unconfigured" | "ready" | "degraded" | "failed";
  servers: McpRuntimeServerStatus[];
}

function inheritedEnvironment(): Record<string, string> {
  return Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function expandEnvironment(value: string, env: Record<string, string>): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, name: string) => env[name] ?? match);
}

function materializePluginMcpSpec(spec: McpServerSpec, env: Record<string, string>): McpServerSpec {
  const expandedEnv = Object.fromEntries(
    Object.entries(spec.env ?? {}).map(([name, value]) => [name, expandEnvironment(value, env)]),
  );
  const mergedEnv = { ...env, ...expandedEnv };
  return {
    ...spec,
    ...(spec.command ? { command: expandEnvironment(spec.command, mergedEnv) } : {}),
    ...(spec.args ? { args: spec.args.map((arg) => expandEnvironment(arg, mergedEnv)) } : {}),
    env: mergedEnv,
  };
}
/**
 * Options forwarded to the SDK's `callTool(params, resultSchema?, options?)`
 * third parameter. We keep only the fields the bridge actually sets — a
 * per-request `timeout` and `resetTimeoutOnProgress` — so tests can mock
 * `callTool` with a small type surface.
 */
export interface McpCallToolOptions {
  timeout?: number;
  resetTimeoutOnProgress?: boolean;
}

/** Minimal subset of `@modelcontextprotocol/sdk` Client we depend on. */
export interface McpClientLike {
  listTools(): Promise<{ tools: McpToolDescriptor[] }>;
  callTool(
    args: { name: string; arguments: Record<string, unknown> },
    resultSchema?: undefined,
    options?: McpCallToolOptions,
  ): Promise<McpCallResult>;
  close(): Promise<void>;
}

export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpCallResult {
  content?: unknown;
  isError?: boolean;
}

export type McpConnectFn = (name: string, spec: McpServerSpec) => Promise<McpClientLike>;

/**
 * Load `mcp_servers.json` from the data root. Looks under `bp_template/` first
 * (the user-editable global template, §11A.2), then `.bp/`. Returns null when
 * absent — MCP is entirely opt-in and adds zero overhead when unconfigured.
 */
export async function loadMcpServersConfig(dataRoot: string): Promise<McpServersConfig | null> {
  const merged: Record<string, McpServerSpec> = {};
  const serverOwners: Record<string, string> = {};
  for (const rel of [join("bp_template", "mcp_servers.json"), join(".bp", "mcp_servers.json")]) {
    try {
      const raw = await readFile(join(dataRoot, rel), "utf8");
      const cfg = JSON.parse(raw) as unknown;
      if (cfg && typeof cfg === "object" && "mcpServers" in cfg) {
        Object.assign(merged, (cfg as McpServersConfig).mcpServers);
        break;
      }
    } catch {
      /* not present / unreadable — try the next location */
    }
  }
  for (const projection of await loadCompatPluginProjections(dataRoot)) {
    if (!projection.mcpConfigPath) continue;
    const parsed = JSON.parse(await readFile(projection.mcpConfigPath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") throw new Error(`plugin ${projection.id} MCP config must be an object`);
    const object = parsed as Record<string, unknown>;
    const servers = object.mcpServers && typeof object.mcpServers === "object"
      ? object.mcpServers as Record<string, McpServerSpec>
      : object as Record<string, McpServerSpec>;
    for (const [name, spec] of Object.entries(servers)) {
      if (merged[name]) throw new Error(`MCP server name conflict: ${name} (${projection.id})`);
      const env = {
        ...inheritedEnvironment(),
        BRAINPILOT_PLUGIN_ROOT: projection.root,
        BRAINPILOT_PLUGIN_DATA: projection.dataDir,
        CLAUDE_PLUGIN_ROOT: projection.root,
        CLAUDE_PLUGIN_DATA: projection.dataDir,
        CLAUDE_MEM_DATA_DIR: projection.dataDir,
        PLUGIN_ROOT: projection.root,
      };
      merged[name] = spec.command ? materializePluginMcpSpec(spec, env) : spec;
      serverOwners[name] = projection.id;
    }
  }
  return Object.keys(merged).length > 0 ? { mcpServers: merged, serverOwners } : null;
}

/** Real connect: open the transport named by `spec.type` and hand back a thin client. */
export const defaultMcpConnect: McpConnectFn = async (name, spec) => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const client = new Client({ name: `brainpilot-${name}`, version: "0.1.0" });
  await client.connect(await openTransport(name, spec));
  return {
    listTools: () => client.listTools() as Promise<{ tools: McpToolDescriptor[] }>,
    // Forward the per-request options (timeout / resetTimeoutOnProgress)
    // through to the SDK. `resultSchema` stays undefined — we accept the
    // SDK's default `CompatibilityCallToolResultSchema` and let `normalizeContent`
    // downstream deal with the payload shape.
    callTool: (a, _schema, options) =>
      client.callTool(a, undefined, options) as Promise<McpCallResult>,
    close: () => client.close(),
  };
};

/** Build the SDK transport for a server spec; defaults to stdio. Exported for tests. */
export async function openTransport(name: string, spec: McpServerSpec) {
  const type = spec.type ?? "stdio";
  if (type === "http" || type === "sse") {
    if (!spec.url) {
      throw new Error(`mcp server '${name}': type '${type}' requires a 'url'`);
    }
    const url = new URL(spec.url);
    // Custom headers (e.g. Authorization) ride on `requestInit` for both transports.
    const opts = spec.headers ? { requestInit: { headers: spec.headers } } : undefined;
    if (type === "http") {
      const { StreamableHTTPClientTransport } = await import(
        "@modelcontextprotocol/sdk/client/streamableHttp.js"
      );
      return new StreamableHTTPClientTransport(url, opts);
    }
    const { SSEClientTransport } = await import("@modelcontextprotocol/sdk/client/sse.js");
    return new SSEClientTransport(url, opts);
  }
  if (!spec.command) {
    throw new Error(`mcp server '${name}': type 'stdio' requires a 'command'`);
  }
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  return new StdioClientTransport({
    command: resolveStdioCommand(spec.command, isWindows),
    args: spec.args ?? [],
    ...(spec.env ? { env: spec.env } : {}),
  });
}

/**
 * Windows shim resolution for stdio MCP servers (#7 — cross-platform pass).
 *
 * On Windows the npm-ecosystem launchers (`npx`, `npm`, `yarn`, `pnpm`) only
 * exist as `.cmd` batch shims, never as a bare-name executable. Node ≥20.12's
 * CVE-2024-27980 fix made `child_process.spawn("npx", …, { shell: false })`
 * fail with EINVAL/ENOENT instead of silently routing through cmd.exe — so the
 * de-facto MCP install form (`npx -y @modelcontextprotocol/server-*`) which
 * appears in every published config and in our own scaffold blows up on Windows
 * unless callers know to write `npx.cmd` themselves.
 *
 * We auto-append `.cmd` for that exact short list on Windows when the caller
 * didn't already provide an extension. `node` is intentionally excluded — it's
 * `node.exe` on Windows and Node's own launcher handles the `.exe` fallback.
 * Anything outside the allow-list is passed through verbatim (we don't want to
 * second-guess a user-supplied binary path).
 *
 * Exported so unit tests can exercise both branches without OS mocking — the
 * `windows` flag is injected, not read from `process.platform`, here.
 */
export function resolveStdioCommand(cmd: string, windows: boolean): string {
  if (!windows) return cmd;
  if (/\.(cmd|bat|exe|ps1|com)$/i.test(cmd)) return cmd;
  if (/^(npx|npm|yarn|pnpm)$/i.test(cmd)) return `${cmd}.cmd`;
  return cmd;
}

export class McpBridge {
  private clients: McpClientLike[] = [];
  private _tools: SystemTool[] = [];

  constructor(private readonly connect: McpConnectFn = defaultMcpConnect) {}

  get tools(): SystemTool[] {
    return this._tools;
  }

  /** Connect every server in the config and collect their tools. */
  async connectAll(cfg: McpServersConfig): Promise<SystemTool[]> {
    return (await this.connectAllWithStatus(cfg)).tools;
  }

  /** Connect every server while preserving per-server startup failures. */
  async connectAllWithStatus(cfg: McpServersConfig): Promise<McpConnectResult> {
    const connectedServers: string[] = [];
    const skippedServers: string[] = [];
    const failures: McpConnectionFailure[] = [];
    const generationTools: SystemTool[] = [];
    for (const [name, spec] of Object.entries(cfg.mcpServers)) {
      if (isPlaceholderSpec(spec)) {
        // A scaffolded slot whose url/command hasn't been filled in yet — skip
        // quietly so the default config never delays launch or logs an error.
        // eslint-disable-next-line no-console
        console.info(`[mcp] server '${name}' not configured yet — skipping`);
        skippedServers.push(name);
        continue;
      }
      let client: McpClientLike | undefined;
      try {
        client = await this.connect(name, spec);
        const { tools } = await client.listTools();
        this.clients.push(client);
        connectedServers.push(name);
        for (const t of tools) generationTools.push(this.wrap(name, client, t));
      } catch (err) {
        await client?.close().catch(() => {});
        const error = err instanceof Error ? err.message : String(err);
        failures.push({ server: name, error });
        // eslint-disable-next-line no-console
        console.error(`[mcp] server '${name}' failed to connect:`, error);
      }
    }
    // Only newly-created agents receive this generation. Older SystemTool
    // closures keep referencing their still-open clients until bridge.close().
    this._tools = generationTools;
    return { tools: generationTools, connectedServers, skippedServers, failures };
  }

  private wrap(server: string, client: McpClientLike, t: McpToolDescriptor): SystemTool {
    return {
      name: `mcp__${server}__${t.name}`,
      description: t.description ?? `MCP tool '${t.name}' from server '${server}'`,
      parameters: t.inputSchema ?? { type: "object", properties: {} },
      execute: async (params: Record<string, unknown>): Promise<SystemToolResult> => {
        // Explicit per-call `RequestOptions`: without this the SDK falls
        // back to `DEFAULT_REQUEST_TIMEOUT_MSEC` (60 s), which is too short
        // for the long-running tools BrainPilot users routinely wire up
        // (paper search, deep KB queries, provider-hosted analyzers).
        const res = await client.callTool(
          { name: t.name, arguments: params },
          undefined,
          {
            timeout: MCP_TOOL_CALL_TIMEOUT_MS,
            resetTimeoutOnProgress: MCP_RESET_TIMEOUT_ON_PROGRESS,
          },
        );
        return { content: normalizeContent(res.content), isError: res.isError === true };
      },
    };
  }

  /** Close every server connection (best-effort). */
  async close(): Promise<void> {
    await Promise.all(this.clients.map((c) => c.close().catch(() => {})));
    this.clients = [];
    this._tools = [];
  }
}

/**
 * A spec is a "placeholder" when its required address field is blank: an
 * http/sse entry with no `url`, or a stdio entry with no `command`. The scaffold
 * ships one such slot (`type:"http", url:""`) so the runtime treats an unfilled
 * default as opt-in rather than a misconfiguration.
 */
function isPlaceholderSpec(spec: McpServerSpec): boolean {
  const type = spec.type ?? "stdio";
  if (type === "http" || type === "sse") return !spec.url?.trim();
  return !spec.command?.trim();
}

/** Map an MCP tool-call `content` payload into our text-content shape. */
function normalizeContent(content: unknown): Array<{ type: "text"; text: string }> {
  if (Array.isArray(content)) {
    return content.map((item) => {
      if (item && typeof item === "object" && (item as { type?: string }).type === "text") {
        return { type: "text", text: String((item as { text?: unknown }).text ?? "") };
      }
      return { type: "text", text: safe(item) };
    });
  }
  return [{ type: "text", text: typeof content === "string" ? content : safe(content) }];
}

function safe(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
