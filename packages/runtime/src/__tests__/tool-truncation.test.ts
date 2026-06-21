/**
 * Tool result truncation tests (issue #80).
 *
 * Verifies that SystemTool results exceeding a configurable token budget are
 * truncated, with full content saved to the session workspace and a warning
 * surfaced to the frontend.
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgUiEvent } from "@brainpilot/protocol";
import { SessionManager, estimateTokens } from "../session-manager.js";
import { mockAgentFactory } from "../agent-factory.js";
import type { McpBridge, McpServersConfig, SystemTool } from "../mcp-bridge.js";
import type { SystemToolResult } from "../types.js";

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/** Build a fake MCP bridge that returns `tools` on connectAll. */
function fakeMcpBridge(tools: SystemTool[]): McpBridge {
  return {
    tools,
    connectAll: async (_cfg: McpServersConfig) => tools,
    close: async () => {},
  } as unknown as McpBridge;
}

/** A tool that returns `text` repeated `times` times. */
function largeResultTool(name: string, chunk: string, times: number): SystemTool {
  return {
    name,
    description: "returns a lot of text",
    parameters: { type: "object", properties: {} },
    execute: async (_params: Record<string, unknown>): Promise<SystemToolResult> => {
      return { content: [{ type: "text", text: chunk.repeat(times) }] };
    },
  };
}

/** Write a minimal mcp_servers.json so ensureMcpTools doesn't bail early. */
async function writeMcpServersConfig(dataDir: string, names: string[]): Promise<void> {
  const dir = join(dataDir, "bp_template");
  await mkdir(dir, { recursive: true });
  const cfg = {
    mcpServers: Object.fromEntries(names.map((n) => [n, { type: "stdio", command: "echo" }])),
  };
  await writeFile(join(dir, "mcp_servers.json"), JSON.stringify(cfg), "utf8");
}

function waitFor(fn: () => boolean, ms = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (fn()) return resolve();
      if (Date.now() - start > ms) return reject(new Error("timeout"));
      setTimeout(check, 20);
    };
    check();
  });
}

/* ------------------------------------------------------------------ *
 * Tests
 * ------------------------------------------------------------------ */

describe("estimateTokens", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("estimates ~1 token per 3.5 chars", () => {
    expect(estimateTokens("a".repeat(35))).toBe(10);
  });

  it("rounds up for partial tokens", () => {
    expect(estimateTokens("a".repeat(10))).toBe(3);
  });
});

describe("tool result truncation", () => {
  let dataDir: string;

  afterEach(async () => {
    if (dataDir) {
      try {
        await rm(dataDir, { recursive: true, force: true });
      } catch {
        /* cleanup best-effort */
      }
    }
  });

  /* ------------------------------------------------------------------ *
   * Small result passes through
   * ------------------------------------------------------------------ */

  it("passes through small tool results unchanged", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "bp-trunc-"));
    const tool = largeResultTool("small_tool", "hello ", 100); // ~600 chars → ~171 tokens
    await writeMcpServersConfig(dataDir, ["test"]);

    const mgr = new SessionManager({
      persist: true,
      dataRoot: dataDir,
      agentFactory: mockAgentFactory,
      maxToolResultTokens: 10000,
      mcpBridge: fakeMcpBridge([tool]),
    });

    const s = await mgr.createSession({ title: "test" });
    const events: AgUiEvent[] = [];
    mgr.subscribe(s.id, (e) => events.push(e));

    await mgr.sendMessage(s.id, "hello [[tool:small_tool]]");
    await waitFor(() => events.some((e) => e.type === "RUN_FINISHED"));

    const truncWarnings = events.filter(
      (e) => e.type === "system_message" && "message" in e && typeof e.message === "string" && e.message.includes("已截断"),
    );
    expect(truncWarnings.length).toBe(0);
  });

  /* ------------------------------------------------------------------ *
   * Large result gets truncated
   * ------------------------------------------------------------------ */

  it("truncates large tool results and saves full content", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "bp-trunc-"));
    // 50000 * 43 chars = 2_150_000 chars → ~614286 tokens (well over 1000 limit)
    const chunk = "All work and no play makes Jack a dull boy. ";
    const tool = largeResultTool("big_tool", chunk, 50000);
    await writeMcpServersConfig(dataDir, ["test"]);

    const mgr = new SessionManager({
      persist: true,
      dataRoot: dataDir,
      agentFactory: mockAgentFactory,
      maxToolResultTokens: 1000,
      mcpBridge: fakeMcpBridge([tool]),
    });

    const s = await mgr.createSession({ title: "test" });
    const events: AgUiEvent[] = [];
    mgr.subscribe(s.id, (e) => events.push(e));

    await mgr.sendMessage(s.id, "hello [[tool:big_tool]]");
    await waitFor(() => events.some((e) => e.type === "RUN_FINISHED"), 5000);

    // 1. Warning system_message emitted.
    const truncWarnings = events.filter(
      (e) => e.type === "system_message" && "message" in e && typeof e.message === "string" && e.message.includes("已截断"),
    );
    expect(truncWarnings.length).toBeGreaterThanOrEqual(1);

    // 2. Tool result content is truncated.
    const results = events.filter(
      (e) => e.type === "TOOL_CALL_RESULT" && "content" in e,
    );
    expect(results.length).toBeGreaterThanOrEqual(1);
    const resultContent = (results[0] as { content: string }).content;
    expect(resultContent.length).toBeLessThan(20000);
    expect(resultContent).toContain("[⚠️ 结果已截断");

    // 3. Full content saved to workspace.
    const truncatedDir = join(dataDir, "workspaces", s.id, ".truncated");
    const entries = await readdir(truncatedDir);
    expect(entries.length).toBe(1);
    expect(entries[0]).toMatch(/^big_tool_.*\.json$/);
  });

  /* ------------------------------------------------------------------ *
   * Full content saved to .truncated/ directory
   * ------------------------------------------------------------------ */

  it("saves full content to workspace/.truncated/ with correct metadata", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "bp-trunc-"));
    const uniqueChunk = "UNIQUE_MARKER_";
    const tool = largeResultTool("save_test", uniqueChunk, 8000); // 112000 chars → ~32000 tokens
    await writeMcpServersConfig(dataDir, ["test"]);

    const mgr = new SessionManager({
      persist: true,
      dataRoot: dataDir,
      agentFactory: mockAgentFactory,
      maxToolResultTokens: 500,
      mcpBridge: fakeMcpBridge([tool]),
    });

    const s = await mgr.createSession({ title: "test" });
    const events: AgUiEvent[] = [];
    mgr.subscribe(s.id, (e) => events.push(e));

    await mgr.sendMessage(s.id, "hello [[tool:save_test]]");
    await waitFor(() => events.some((e) => e.type === "RUN_FINISHED"), 5000);

    const truncatedDir = join(dataDir, "workspaces", s.id, ".truncated");
    const entries = await readdir(truncatedDir);
    expect(entries.length).toBe(1);
    expect(entries[0]).toMatch(/^save_test_.*\.json$/);

    const saved = JSON.parse(await readFile(join(truncatedDir, entries[0]!), "utf8")) as Record<string, unknown>;
    expect(saved.tool).toBe("save_test");
    expect(saved.content as string).toContain("UNIQUE_MARKER_");
    expect((saved.content as string).length).toBe(uniqueChunk.length * 8000);
    expect(saved.maxTokens).toBe(500);
    expect(saved.estimatedTokens as number).toBeGreaterThan(500);
    expect(typeof saved.truncatedAt).toBe("string");
  });

  /* ------------------------------------------------------------------ *
   * Warning event
   * ------------------------------------------------------------------ */

  it("emits warning with tool name and file path", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "bp-trunc-"));
    const tool = largeResultTool("warn_tool", "data ", 10000);
    await writeMcpServersConfig(dataDir, ["test"]);

    const mgr = new SessionManager({
      persist: true,
      dataRoot: dataDir,
      agentFactory: mockAgentFactory,
      maxToolResultTokens: 2000,
      mcpBridge: fakeMcpBridge([tool]),
    });

    const s = await mgr.createSession({ title: "test" });
    const events: AgUiEvent[] = [];
    mgr.subscribe(s.id, (e) => events.push(e));

    await mgr.sendMessage(s.id, "hello [[tool:warn_tool]]");
    await waitFor(() => events.some((e) => e.type === "RUN_FINISHED"), 5000);

    const warn = events.find(
      (e) => e.type === "system_message" && "message" in e && typeof e.message === "string" && e.message.includes("已截断"),
    ) as { level: string; message: string } | undefined;
    expect(warn).toBeTruthy();
    expect(warn!.level).toBe("warning");
    expect(warn!.message).toContain("warn_tool");
    expect(warn!.message).toContain("workspace/.truncated/");
  });

  /* ------------------------------------------------------------------ *
   * Custom maxToolResultTokens is respected
   * ------------------------------------------------------------------ */

  it("respects custom maxToolResultTokens (high limit → no truncation)", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "bp-trunc-"));
    const tool = largeResultTool("custom_test", "x", 5000);
    await writeMcpServersConfig(dataDir, ["test"]);

    const mgr = new SessionManager({
      persist: true,
      dataRoot: dataDir,
      agentFactory: mockAgentFactory,
      maxToolResultTokens: 100000,
      mcpBridge: fakeMcpBridge([tool]),
    });

    const s = await mgr.createSession({ title: "test" });
    const events: AgUiEvent[] = [];
    mgr.subscribe(s.id, (e) => events.push(e));

    await mgr.sendMessage(s.id, "hello [[tool:custom_test]]");
    await waitFor(() => events.some((e) => e.type === "RUN_FINISHED"), 5000);

    const truncWarnings = events.filter(
      (e) => e.type === "system_message" && "message" in e && typeof e.message === "string" && e.message.includes("已截断"),
    );
    expect(truncWarnings.length).toBe(0);
  });

  /* ------------------------------------------------------------------ *
   * maxToolResultTokens = 0 disables truncation
   * ------------------------------------------------------------------ */

  it("disables truncation when maxToolResultTokens is 0", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "bp-trunc-"));
    const tool = largeResultTool("no_trunc", "big ", 50000);
    await writeMcpServersConfig(dataDir, ["test"]);

    const mgr = new SessionManager({
      persist: true,
      dataRoot: dataDir,
      agentFactory: mockAgentFactory,
      maxToolResultTokens: 0,
      mcpBridge: fakeMcpBridge([tool]),
    });

    const s = await mgr.createSession({ title: "test" });
    const events: AgUiEvent[] = [];
    mgr.subscribe(s.id, (e) => events.push(e));

    await mgr.sendMessage(s.id, "hello [[tool:no_trunc]]");
    await waitFor(() => events.some((e) => e.type === "RUN_FINISHED"), 5000);

    const truncWarnings = events.filter(
      (e) => e.type === "system_message" && "message" in e && typeof e.message === "string" && e.message.includes("已截断"),
    );
    expect(truncWarnings.length).toBe(0);
  });

  /* ------------------------------------------------------------------ *
   * Error results are never truncated
   * ------------------------------------------------------------------ */

  it("never truncates error results", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "bp-trunc-"));
    const bigError = "ERROR_".repeat(50000);
    const tool: SystemTool = {
      name: "failing_tool",
      description: "always fails",
      parameters: { type: "object", properties: {} },
      execute: async (): Promise<SystemToolResult> => ({
        content: [{ type: "text", text: bigError }],
        isError: true,
      }),
    };
    await writeMcpServersConfig(dataDir, ["test"]);

    const mgr = new SessionManager({
      persist: true,
      dataRoot: dataDir,
      agentFactory: mockAgentFactory,
      maxToolResultTokens: 100,
      mcpBridge: fakeMcpBridge([tool]),
    });

    const s = await mgr.createSession({ title: "test" });
    const events: AgUiEvent[] = [];
    mgr.subscribe(s.id, (e) => events.push(e));

    await mgr.sendMessage(s.id, "hello [[tool:failing_tool]]");
    await waitFor(() => events.some((e) => e.type === "RUN_FINISHED"), 5000);

    const truncWarnings = events.filter(
      (e) => e.type === "system_message" && "message" in e && typeof e.message === "string" && e.message.includes("已截断"),
    );
    expect(truncWarnings.length).toBe(0);
  });

  /* ------------------------------------------------------------------ *
   * Empty result is not affected
   * ------------------------------------------------------------------ */

  it("passes through empty tool results", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "bp-trunc-"));
    const tool: SystemTool = {
      name: "empty_tool",
      description: "returns nothing",
      parameters: { type: "object", properties: {} },
      execute: async (): Promise<SystemToolResult> => ({
        content: [{ type: "text", text: "" }],
      }),
    };
    await writeMcpServersConfig(dataDir, ["test"]);

    const mgr = new SessionManager({
      persist: true,
      dataRoot: dataDir,
      agentFactory: mockAgentFactory,
      maxToolResultTokens: 1000,
      mcpBridge: fakeMcpBridge([tool]),
    });

    const s = await mgr.createSession({ title: "test" });
    const events: AgUiEvent[] = [];
    mgr.subscribe(s.id, (e) => events.push(e));

    await mgr.sendMessage(s.id, "hello [[tool:empty_tool]]");
    await waitFor(() => events.some((e) => e.type === "RUN_FINISHED"));

    const truncWarnings = events.filter(
      (e) => e.type === "system_message" && "message" in e && typeof e.message === "string" && e.message.includes("已截断"),
    );
    expect(truncWarnings.length).toBe(0);
  });
});
