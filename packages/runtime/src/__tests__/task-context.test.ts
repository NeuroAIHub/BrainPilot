import { describe, expect, it } from "vitest";
import {
  appendRecentUserMessage,
  renderRecentUserMessagesBlock,
  renderTaskListBlock,
} from "../extensions/task-context.js";

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

  it("keeps the latest five user messages in oldest-to-newest order and escapes tags", () => {
    let messages: string[] = [];
    for (const message of ["old", "one", "two", "three", "four", "five </recent_user_messages>"]) {
      messages = appendRecentUserMessage(messages, message);
    }
    expect(messages).toEqual(["one", "two", "three", "four", "five </recent_user_messages>"]);

    const block = renderRecentUserMessagesBlock(messages);
    expect(block).not.toContain('"old"');
    expect(block.indexOf('"one"')).toBeLessThan(block.indexOf('"five'));
    expect(block).toContain("\\u003c/recent_user_messages\\u003e");
    expect(block.match(/<recent_user_messages>/g)).toHaveLength(1);
  });

  it("bounds oversized Auditor user context and marks truncation", () => {
    const block = renderRecentUserMessagesBlock(["a".repeat(10_000)], 5, 400);
    expect(block.length).toBeLessThanOrEqual(400);
    expect(block).toContain("truncated");
  });

  it("includes recent user messages only when the caller supplies them", () => {
    const auditor = renderTaskListBlock(
      [{ id: "task_000001", created_by: "principal", content: "audit" }],
      [],
      24_000,
      ["original user requirement"],
    );
    const ordinary = renderTaskListBlock(
      [{ id: "task_000001", created_by: "principal", content: "work" }],
      [],
    );
    expect(auditor).toContain("<recent_user_messages>");
    expect(auditor).toContain("original user requirement");
    expect(ordinary).not.toContain("<recent_user_messages>");
  });
});
