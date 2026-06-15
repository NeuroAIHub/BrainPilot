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
 * A failing server is logged and skipped — it never aborts the others.
 *
 * Config shape (standard MCP/Claude format). Three transports are supported,
 * selected by the optional `type` field (defaults to "stdio" for back-compat):
 *   stdio: { "fs":  { "command": "npx", "args": ["-y", "..."], "env": {} } }
 *   http:  { "api": { "type": "http", "url": "https://host/mcp", "headers": {} } }
 *   sse:   { "evt": { "type": "sse",  "url": "https://host/sse", "headers": {} } }
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SystemTool, SystemToolResult } from "./types.js";

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
}

/** Minimal subset of `@modelcontextprotocol/sdk` Client we depend on. */
export interface McpClientLike {
  listTools(): Promise<{ tools: McpToolDescriptor[] }>;
  callTool(args: { name: string; arguments: Record<string, unknown> }): Promise<McpCallResult>;
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
  for (const rel of [join("bp_template", "mcp_servers.json"), join(".bp", "mcp_servers.json")]) {
    try {
      const raw = await readFile(join(dataRoot, rel), "utf8");
      const cfg = JSON.parse(raw) as unknown;
      if (cfg && typeof cfg === "object" && "mcpServers" in cfg) {
        return cfg as McpServersConfig;
      }
    } catch {
      /* not present / unreadable — try the next location */
    }
  }
  return null;
}

/** Real connect: open the transport named by `spec.type` and hand back a thin client. */
export const defaultMcpConnect: McpConnectFn = async (name, spec) => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const client = new Client({ name: `brainpilot-${name}`, version: "0.1.0" });
  await client.connect(await openTransport(name, spec));
  return {
    listTools: () => client.listTools() as Promise<{ tools: McpToolDescriptor[] }>,
    callTool: (a) => client.callTool(a) as Promise<McpCallResult>,
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
    command: spec.command,
    args: spec.args ?? [],
    ...(spec.env ? { env: spec.env } : {}),
  });
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
    for (const [name, spec] of Object.entries(cfg.mcpServers)) {
      if (isPlaceholderSpec(spec)) {
        // A scaffolded slot whose url/command hasn't been filled in yet — skip
        // quietly so the default config never delays launch or logs an error.
        // eslint-disable-next-line no-console
        console.info(`[mcp] server '${name}' not configured yet — skipping`);
        continue;
      }
      try {
        const client = await this.connect(name, spec);
        this.clients.push(client);
        const { tools } = await client.listTools();
        for (const t of tools) this._tools.push(this.wrap(name, client, t));
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[mcp] server '${name}' failed to connect:`, (err as Error).message);
      }
    }
    return this._tools;
  }

  private wrap(server: string, client: McpClientLike, t: McpToolDescriptor): SystemTool {
    return {
      name: `mcp__${server}__${t.name}`,
      description: t.description ?? `MCP tool '${t.name}' from server '${server}'`,
      parameters: t.inputSchema ?? { type: "object", properties: {} },
      execute: async (params: Record<string, unknown>): Promise<SystemToolResult> => {
        const res = await client.callTool({ name: t.name, arguments: params });
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
