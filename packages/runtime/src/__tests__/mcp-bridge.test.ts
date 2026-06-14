import { describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  McpBridge,
  loadMcpServersConfig,
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
});

describe("McpBridge", () => {
  it("namespaces tools and forwards calls", async () => {
    const callTool = vi.fn(async () => ({ content: [{ type: "text", text: "hit" }], isError: false }));
    const bridge = new McpBridge(async () => fakeClient({ callTool }));
    const tools = await bridge.connectAll({ mcpServers: { web: { command: "x" } } });

    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe("mcp__web__search");
    const res = await tools[0]!.execute({ q: "hi" });
    expect(callTool).toHaveBeenCalledWith({ name: "search", arguments: { q: "hi" } });
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
});
