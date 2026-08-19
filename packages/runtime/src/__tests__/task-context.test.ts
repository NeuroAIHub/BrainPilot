import { describe, expect, it } from "vitest";
import { renderTaskListBlock } from "../extensions/task-context.js";

describe("task context", () => {
  it("renders assigned and delegated pending tasks in caller-provided order", () => {
    const block = renderTaskListBlock(
      [{ id: "task_000001", created_by: "principal", content: "do A" }],
      [{ id: "task_000002", assigned_to: "writer", content: "do B" }],
    );
    expect(block).toContain("<assigned_to_me>");
    expect(block).toContain("task_000001 from=principal: do A");
    expect(block).toContain("task_000002 to=writer reply_received=false: do B");
    expect(block).toContain("Never claim completion");
    expect(block).toContain("wait for the delegated result before the final answer");
    expect(block).not.toContain("completed");
  });

  it("omits later task bodies beyond the context budget and reports the count", () => {
    const block = renderTaskListBlock(
      [
        { id: "task_000001", created_by: "principal", content: "a".repeat(200) },
        { id: "task_000002", created_by: "principal", content: "b".repeat(200) },
      ],
      [],
      750,
    );
    expect(block).toContain("task_000001");
    expect(block).toContain("more assigned task(s) omitted by context budget");
  });
});
