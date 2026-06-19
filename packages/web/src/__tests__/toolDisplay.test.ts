import { describe, expect, it } from "vitest";
import { formatToolName, formatPayload } from "../utils/toolDisplay";

describe("formatToolName (#84)", () => {
  it("maps mcp__server__tool to 'server · tool'", () => {
    expect(formatToolName("mcp__bp_skills__skills_tool")).toBe("bp_skills · skills_tool");
  });

  it("keeps server/tool segments that contain underscores", () => {
    expect(formatToolName("mcp__my_server__do_a_thing")).toBe("my_server · do_a_thing");
  });

  it("returns non-MCP names unchanged", () => {
    expect(formatToolName("read")).toBe("read");
    expect(formatToolName("send_message")).toBe("send_message");
  });

  it("falls back gracefully for missing/empty names", () => {
    expect(formatToolName(undefined)).toBe("tool");
    expect(formatToolName(null)).toBe("tool");
    expect(formatToolName("")).toBe("tool");
  });

  it("does not crash on a malformed mcp__ prefix with no tool segment", () => {
    // No second `__` — show the remainder rather than the raw identifier.
    expect(formatToolName("mcp__justserver")).toBe("justserver");
  });
});

describe("formatPayload (#84)", () => {
  it("parses a JSON string so it is not double-escaped", () => {
    const raw = JSON.stringify({ path: "a/b.txt", count: 2 });
    const out = formatPayload(raw);
    expect(out).toBe('{\n  "path": "a/b.txt",\n  "count": 2\n}');
    expect(out).not.toContain('\\"');
  });

  it("pretty-prints a plain object", () => {
    expect(formatPayload({ a: 1 })).toBe('{\n  "a": 1\n}');
  });

  it("returns non-JSON strings verbatim", () => {
    expect(formatPayload("just some text")).toBe("just some text");
  });

  it("returns a partial/invalid JSON string verbatim", () => {
    expect(formatPayload('{"path": "a/b')).toBe('{"path": "a/b');
  });

  it("returns empty string for null/undefined/blank", () => {
    expect(formatPayload(undefined)).toBe("");
    expect(formatPayload(null)).toBe("");
    expect(formatPayload("   ")).toBe("");
  });
});
