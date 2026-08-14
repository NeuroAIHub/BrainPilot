import { describe, expect, it } from "vitest";
import {
  appendSystemPromptSections,
  TOOL_CALL_EFFICIENCY_DIRECTIVE,
  toPiToolResult,
} from "../agent-factory.js";

describe("agent factory prompt assembly", () => {
  it("adds concise tool-call guidance before every optional role prompt", () => {
    expect(appendSystemPromptSections()).toEqual([TOOL_CALL_EFFICIENCY_DIRECTIVE]);
    expect(appendSystemPromptSections("# Engineer")).toEqual([
      TOOL_CALL_EFFICIENCY_DIRECTIVE,
      "# Engineer",
    ]);
  });

  it("preserves a system tool's terminate signal for the Pi agent loop", () => {
    expect(toPiToolResult("background_job", {
      content: [{ type: "text", text: "wait for completion" }],
      terminate: true,
    })).toMatchObject({ terminate: true });
  });
});
