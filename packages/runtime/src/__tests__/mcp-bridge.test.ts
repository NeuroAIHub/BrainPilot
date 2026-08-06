import { describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  McpBridge,
  MCP_TOOL_CALL_TIMEOUT_MS,
  loadMcpServersConfig,
  openTransport,
  resolveStdioCommand,
  type McpClientLike,
} from "../mcp-bridge.js";

function fakeClient(over: Partial<McpClientLike> = {}): McpClientLike {
  return {
    listTools: async () => ({
      tools: [{ name: "search", description: "search the web", inputSchema: { type: "object" } }],
    }),
    callTool: async () => ({ content: [{ type: "text", text: "ok" }], isError: false }),
    close: async () => {},
    ...over,
  };
}

describe("loadMcpServersConfig", () => {
  it("reads bp_template/mcp_servers.json", async () => {
    const root = await mkdtemp(join(tmpdir(), "bp-mcp-"));
    await mkdir(join(root, "bp_template"), { recursive: true });
    await writeFile(
      join(root, "bp_template", "mcp_servers.json"),
      JSON.stringify({ mcpServers: { fs: { command: "npx", args: ["-y", "srv"] } } }),
    );
    const cfg = await loadMcpServersConfig(root);
    expect(cfg?.mcpServers.fs?.command).toBe("npx");
  });

  it("returns null when no config present", async () => {
    const root = await mkdtemp(join(tmpdir(), "bp-mcp-"));
    expect(await loadMcpServersConfig(root)).toBeNull();
  });

  it("merges enabled plugin MCP servers and injects plugin root aliases", async () => {
    const root = await mkdtemp(join(tmpdir(), "bp-mcp-plugin-"));
    const pluginRoot = join(root, "plugins", "execution", "demo", "1.0.0");
    const pluginData = join(root, "plugins", "data", "demo", "1.0.0");
    const runtimeDir = join(root, "plugins", "runtime");
    await mkdir(pluginRoot, { recursive: true });
    await mkdir(runtimeDir, { recursive: true });
    const mcpConfigPath = join(pluginRoot, ".mcp.json");
    await writeFile(mcpConfigPath, JSON.stringify({ mcpServers: { memory: { command: "node", args: ["${BRAINPILOT_PLUGIN_ROOT}/server.js"], env: { CACHE_DIR: "${BRAINPILOT_PLUGIN_DATA}/cache" } } } }));
    await writeFile(join(runtimeDir, "demo.json"), JSON.stringify({ schemaVersion: 1, id: "demo", version: "1.0.0", format: "brainpilot", root: pluginRoot, dataDir: pluginData, mcpConfigPath }));
    const cfg = await loadMcpServersConfig(root);
    expect(cfg?.mcpServers.memory).toEqual(expect.objectContaining({
      command: "node",
      args: [`${pluginRoot}/server.js`],
      env: expect.objectContaining({ PLUGIN_ROOT: pluginRoot, BRAINPILOT_PLUGIN_DATA: pluginData, CACHE_DIR: `${pluginData}/cache` }),
    }));
  });

  it("rejects MCP server name conflicts between global and plugin configs", async () => {
    const root = await mkdtemp(join(tmpdir(), "bp-mcp-conflict-"));
    const pluginRoot = join(root, "plugin");
    const runtimeDir = join(root, "plugins", "runtime");
    await mkdir(join(root, "bp_template"), { recursive: true });
    await mkdir(pluginRoot, { recursive: true });
    await mkdir(runtimeDir, { recursive: true });
    await writeFile(join(root, "bp_template", "mcp_servers.json"), JSON.stringify({ mcpServers: { duplicate: { command: "node" } } }));
    const mcpConfigPath = join(pluginRoot, ".mcp.json");
    await writeFile(mcpConfigPath, JSON.stringify({ mcpServers: { duplicate: { command: "node" } } }));
    await writeFile(join(runtimeDir, "demo.json"), JSON.stringify({ schemaVersion: 1, id: "demo", version: "1.0.0", format: "codex", root: pluginRoot, dataDir: join(root, "data"), mcpConfigPath }));
    await expect(loadMcpServersConfig(root)).rejects.toThrow(/MCP server name conflict/);
  });
});

describe("McpBridge", () => {
  it("namespaces tools and forwards calls with a per-request timeout override", async () => {
    const callTool = vi.fn(async () => ({ content: [{ type: "text", text: "hit" }], isError: false }));
    const bridge = new McpBridge(async () => fakeClient({ callTool }));
    const tools = await bridge.connectAll({ mcpServers: { web: { command: "x" } } });

    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe("mcp__web__search");
    const res = await tools[0]!.execute({ q: "hi" });
    // The 3rd arg is the SDK's `RequestOptions`: we override the default
    // 60 s ceiling (too short for real MCP tools) and enable progress-based
    // timeout reset for well-behaved streaming servers.
    expect(callTool).toHaveBeenCalledWith(
      { name: "search", arguments: { q: "hi" } },
      undefined,
      { timeout: MCP_TOOL_CALL_TIMEOUT_MS, resetTimeoutOnProgress: true },
    );
    // Guard-rail against an accidental silent shrink of the ceiling — 5 min
    // matches the KB retrieve HTTP timeout so the whole slow-tool budget is
    // consistent across bridges.
    expect(MCP_TOOL_CALL_TIMEOUT_MS).toBe(5 * 60_000);
    expect(res.content[0]!.text).toBe("hit");
    expect(res.isError).toBe(false);
  });

  it("maps MCP isError through to SystemToolResult", async () => {
    const bridge = new McpBridge(async () =>
      fakeClient({ callTool: async () => ({ content: [{ type: "text", text: "boom" }], isError: true }) }),
    );
    const [tool] = await bridge.connectAll({ mcpServers: { web: { command: "x" } } });
    const res = await tool!.execute({});
    expect(res.isError).toBe(true);
  });

  it("skips a failing server without aborting the rest", async () => {
    const connect = vi.fn(async (name: string) => {
      if (name === "bad") throw new Error("spawn failed");
      return fakeClient();
    });
    const bridge = new McpBridge(connect);
    const tools = await bridge.connectAll({
      mcpServers: { bad: { command: "x" }, good: { command: "y" } },
    });
    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe("mcp__good__search");
  });

  it("closes all clients", async () => {
    const close = vi.fn(async () => {});
    const bridge = new McpBridge(async () => fakeClient({ close }));
    await bridge.connectAll({ mcpServers: { web: { command: "x" } } });
    await bridge.close();
    expect(close).toHaveBeenCalledTimes(1);
    expect(bridge.tools).toHaveLength(0);
  });

  it("skips placeholder slots (blank url/command) without connecting", async () => {
    const connect = vi.fn(async () => fakeClient());
    const bridge = new McpBridge(connect);
    const tools = await bridge.connectAll({
      mcpServers: {
        unfilledHttp: { type: "http", url: "" },
        unfilledStdio: { command: "" },
        real: { command: "y" },
      },
    });
    // Only the real stdio server connects; the two placeholders are skipped.
    expect(connect).toHaveBeenCalledTimes(1);
    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe("mcp__real__search");
  });
});

describe("openTransport", () => {
  it("defaults to a stdio transport when type is omitted", async () => {
    const t = await openTransport("fs", { command: "npx", args: ["-y", "srv"] });
    expect(t.constructor.name).toBe("StdioClientTransport");
  });

  it("selects the streamable-http transport for type 'http'", async () => {
    const t = await openTransport("api", {
      type: "http",
      url: "https://host.example.com/mcp",
      headers: { Authorization: "Bearer t" },
    });
    expect(t.constructor.name).toBe("StreamableHTTPClientTransport");
  });

  it("selects the SSE transport for type 'sse'", async () => {
    const t = await openTransport("evt", { type: "sse", url: "https://host.example.com/sse" });
    expect(t.constructor.name).toBe("SSEClientTransport");
  });

  it("rejects an http/sse spec with no url", async () => {
    await expect(openTransport("api", { type: "http" })).rejects.toThrow(/requires a 'url'/);
    await expect(openTransport("evt", { type: "sse" })).rejects.toThrow(/requires a 'url'/);
  });

  it("rejects a stdio spec with no command", async () => {
    await expect(openTransport("fs", { type: "stdio" })).rejects.toThrow(/requires a 'command'/);
  });
});

// #7 — cross-platform: Windows can't spawn npm-ecosystem shims by bare name
// (they only exist as `.cmd`), so the bridge auto-suffixes a known short list.
// POSIX must remain a pass-through to preserve historical behaviour.
describe("resolveStdioCommand (cross-platform, #7)", () => {
  describe("on POSIX (windows=false)", () => {
    it("returns the command unchanged for all inputs", () => {
      expect(resolveStdioCommand("npx", false)).toBe("npx");
      expect(resolveStdioCommand("npm", false)).toBe("npm");
      expect(resolveStdioCommand("/usr/local/bin/node", false)).toBe("/usr/local/bin/node");
      expect(resolveStdioCommand("some-binary", false)).toBe("some-binary");
    });
  });

  describe("on Windows (windows=true)", () => {
    it("appends `.cmd` to the npm-ecosystem allow-list", () => {
      expect(resolveStdioCommand("npx", true)).toBe("npx.cmd");
      expect(resolveStdioCommand("npm", true)).toBe("npm.cmd");
      expect(resolveStdioCommand("yarn", true)).toBe("yarn.cmd");
      expect(resolveStdioCommand("pnpm", true)).toBe("pnpm.cmd");
    });

    it("matches the allow-list case-insensitively", () => {
      expect(resolveStdioCommand("NPX", true)).toBe("NPX.cmd");
      expect(resolveStdioCommand("Pnpm", true)).toBe("Pnpm.cmd");
    });

    it("leaves a command alone when the user already gave an extension", () => {
      expect(resolveStdioCommand("npx.cmd", true)).toBe("npx.cmd");
      expect(resolveStdioCommand("npm.bat", true)).toBe("npm.bat");
      expect(resolveStdioCommand("node.exe", true)).toBe("node.exe");
      expect(resolveStdioCommand("foo.ps1", true)).toBe("foo.ps1");
    });

    it("does NOT touch commands outside the allow-list (incl. node)", () => {
      // Node itself is .exe and Windows handles that fallback natively.
      expect(resolveStdioCommand("node", true)).toBe("node");
      expect(resolveStdioCommand("python", true)).toBe("python");
      expect(resolveStdioCommand("uvx", true)).toBe("uvx");
      expect(resolveStdioCommand("C:\\Users\\u\\bin\\custom", true)).toBe(
        "C:\\Users\\u\\bin\\custom",
      );
    });
  });
});
