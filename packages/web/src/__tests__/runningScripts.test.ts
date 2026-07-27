import { describe, it, expect } from "vitest";
import {
  extractCommand,
  isBashTool,
  selectActiveScripts,
} from "../components/chat/runningScripts";
import type { ChatMessage } from "../contracts/backend";

function bashCall(over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: over.id ?? "call-1",
    role: "assistant",
    content: "Tool: bash",
    createdAt: "2026-07-01T00:00:00.000Z",
    agent: over.agent ?? "principal",
    kind: "tool",
    toolName: "bash",
    streaming: true,
    toolInput: JSON.stringify({ command: "pytest -x tests/unit" }),
    ...over,
  };
}

describe("isBashTool", () => {
  it("matches the bare bash tool", () => {
    expect(isBashTool("bash")).toBe(true);
  });

  it("matches the mcp-namespaced bash tool", () => {
    expect(isBashTool("mcp__local__bash")).toBe(true);
  });

  it("does not match other tool names", () => {
    expect(isBashTool("read")).toBe(false);
    expect(isBashTool("mcp__local__read")).toBe(false);
    expect(isBashTool("bash_history")).toBe(false); // suffix match required
    expect(isBashTool(undefined)).toBe(false);
  });
});

describe("extractCommand", () => {
  it("pulls `command` out of a fully-formed JSON args string", () => {
    expect(extractCommand('{"command":"ls -la"}')).toBe("ls -la");
  });

  it("falls back to `cmd`/`script`/`shell` keys", () => {
    expect(extractCommand('{"cmd":"echo hi"}')).toBe("echo hi");
    expect(extractCommand('{"script":"./run.sh"}')).toBe("./run.sh");
    expect(extractCommand('{"shell":"bash -c foo"}')).toBe("bash -c foo");
  });

  it("returns the raw string when the JSON is still partial", () => {
    // TOOL_CALL_ARGS deltas may arrive as `{"comm` before the full JSON has
    // buffered. Better to show *something* than to render an empty row.
    expect(extractCommand('{"command":"pyt')).toBe('{"command":"pyt');
  });

  it("returns empty for non-strings and empty strings", () => {
    expect(extractCommand(undefined)).toBe("");
    expect(extractCommand(null)).toBe("");
    expect(extractCommand("")).toBe("");
    expect(extractCommand({ command: "not a string" })).toBe("");
  });
});

describe("selectActiveScripts", () => {
  it("returns empty when there are no tool messages", () => {
    expect(selectActiveScripts([])).toEqual([]);
    expect(
      selectActiveScripts([
        {
          id: "t1",
          role: "assistant",
          content: "hello",
          createdAt: "",
          kind: "text",
        },
      ]),
    ).toEqual([]);
  });

  it("returns only streaming bash calls, ignoring completed ones", () => {
    const active = bashCall({ id: "a", streaming: true });
    const done = bashCall({ id: "b", streaming: false });
    const result = selectActiveScripts([active, done]);
    expect(result.map((s) => s.id)).toEqual(["a"]);
  });

  it("ignores non-bash tool calls even when they are streaming", () => {
    const bash = bashCall({ id: "a", streaming: true });
    const read = bashCall({
      id: "b",
      streaming: true,
      toolName: "read",
      toolInput: JSON.stringify({ file: "foo.txt" }),
    });
    const trace = bashCall({
      id: "c",
      streaming: true,
      toolName: "mcp__brainpilot__record_trace",
      toolInput: "{}",
    });
    const result = selectActiveScripts([bash, read, trace]);
    expect(result.map((s) => s.id)).toEqual(["a"]);
  });

  it("preserves arrival order across multiple concurrent bash calls", () => {
    const first = bashCall({
      id: "first",
      agent: "principal",
      toolInput: JSON.stringify({ command: "pytest" }),
    });
    const second = bashCall({
      id: "second",
      agent: "engineer",
      toolInput: JSON.stringify({ command: "npm test" }),
    });
    const result = selectActiveScripts([first, second]);
    expect(result).toEqual([
      expect.objectContaining({ id: "first", agent: "principal", command: "pytest" }),
      expect.objectContaining({ id: "second", agent: "engineer", command: "npm test" }),
    ]);
  });

  it("defaults the agent name to 'principal' when unattributed", () => {
    const noAgent = bashCall({ id: "a", agent: undefined });
    const [row] = selectActiveScripts([noAgent]);
    expect(row.agent).toBe("principal");
  });

  it("shows the raw arg fragment while args are still streaming", () => {
    const partial = bashCall({
      id: "a",
      toolInput: '{"command":"pyt', // TOOL_CALL_ARGS half-arrived
    });
    const [row] = selectActiveScripts([partial]);
    expect(row.command).toBe('{"command":"pyt');
  });

  it("uses activeTools as authority and exposes cancellation metadata", () => {
    const messages = [bashCall({ id: "live" }), bashCall({ id: "stale" })];
    const result = selectActiveScripts(messages, [{
      toolCallId: "live",
      toolName: "bash",
      startedAt: "2026-07-01T00:00:05.000Z",
      cancellable: true,
      status: "stopping",
    }]);
    expect(result).toEqual([expect.objectContaining({
      id: "live",
      startedAt: "2026-07-01T00:00:00.000Z",
      cancellable: true,
      status: "stopping",
    })]);
  });
});
