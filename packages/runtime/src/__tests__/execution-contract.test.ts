import { describe, expect, it } from "vitest";
import { withExecutionToolContract } from "../execution-contract.js";
import { createRunInBackgroundTool } from "../tools/system-tools.js";

describe("agent execution tool contract", () => {
  it("does not burden agents that cannot invoke Bash", () => {
    expect(withExecutionToolContract("persona", ["read", "write"])).toBe("persona");
  });

  it("requires bounded Bash and hands long work to a background-capable agent", () => {
    const prompt = withExecutionToolContract("persona", ["bash", "read"]);

    expect(prompt).toContain("Every `bash` call must explicitly set `timeout`");
    expect(prompt).toContain("300 seconds");
    expect(prompt).toContain("Do not start model training");
    expect(prompt).toContain("hand it to an agent that has `run_in_background`");
  });

  it("routes expensive workloads to Background Jobs and reserves Monitor for observation", () => {
    const prompt = withExecutionToolContract("persona", ["bash", "run_in_background", "start_monitor"]);

    expect(prompt).toContain("must use `run_in_background`");
    expect(prompt).toContain("explicit `timeout_ms`");
    expect(prompt).toContain("model training");
    expect(prompt).toContain("Monitor is for streaming observation");
  });

  it("lets agents continue independent work before waiting for a background job", () => {
    const tool = createRunInBackgroundTool({} as never);

    expect(tool.description).toContain("continue other independent work");
    expect(tool.description).toContain("If no other actionable work remains");
    expect(tool.description).toContain("do not sleep or poll");
  });
});
