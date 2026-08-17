import { describe, expect, it, vi } from "vitest";
import { wrapCancellableBash } from "../agent-factory.js";
import {
  BASH_REPETITION_TAG_OPEN,
  createBashRepetitionGuard,
} from "../extensions/bash-repetition-guard.js";

type ContextMessage = { role: string; content: Array<{ type: string; text?: string }> };
type ContextHandler = (event: { messages: ContextMessage[] }) => { messages: ContextMessage[] } | void;
type ToolEndHandler = (event: { toolName: string; isError: boolean }) => unknown;

class FakePi {
  agentStart?: () => void;
  context?: ContextHandler;
  toolEnd?: ToolEndHandler;

  on(event: "agent_start" | "context" | "tool_execution_end", handler: unknown): void {
    if (event === "agent_start") this.agentStart = handler as () => void;
    if (event === "context") this.context = handler as ContextHandler;
    if (event === "tool_execution_end") this.toolEnd = handler as ToolEndHandler;
  }
}

function bashDefinition(execute: (...args: any[]) => Promise<unknown>) {
  return {
    name: "bash",
    description: "Run a shell command",
    parameters: {
      type: "object",
      properties: { command: { type: "string" }, timeout: { type: "number" } },
      required: ["command"],
    },
    execute,
  };
}

function warningText(messages: ContextMessage[]): string {
  return messages.flatMap((message) => message.content)
    .map((part) => part.text ?? "")
    .find((text) => text.startsWith(BASH_REPETITION_TAG_OPEN)) ?? "";
}

describe("Bash repetition guard", () => {
  it("warns on the third repeated command and blocks the fifth without executing it", async () => {
    let now = 1_000;
    const guard = createBashRepetitionGuard({ now: () => now });
    const pi = new FakePi();
    guard.extension(pi as never);
    pi.agentStart!();

    const execute = vi.fn(async () => ({ content: [{ type: "text", text: "ok" }], details: {} }));
    const wrapped = wrapCancellableBash(bashDefinition(execute), new Map(), guard);
    const args = { command: "  tail   results/full_run.log  ", timeout: 5 };

    await wrapped.execute("call-1", args, undefined);
    now += 1_000;
    await wrapped.execute("call-2", { ...args, command: "tail results/full_run.log" }, undefined);
    now += 1_000;
    await wrapped.execute("call-3", args, undefined);

    const injected = pi.context!({ messages: [] });
    const warning = warningText(injected!.messages);
    expect(warning).toContain("five executions");
    expect(warning).toContain("the fifth execution will be blocked");
    expect(warning).not.toContain("results/full_run.log");

    const consumed = pi.context!({ messages: injected!.messages });
    expect(consumed?.messages ?? []).toEqual([]);

    now += 1_000;
    await wrapped.execute("call-4", args, undefined);
    now += 1_000;
    const fifth = await wrapped.execute("call-5", args, undefined) as {
      content: Array<{ type: string; text: string }>;
      terminate?: boolean;
    };

    expect(fifth.terminate).toBe(true);
    expect(fifth.content[0]?.text).toContain("was not executed");
    expect(execute).toHaveBeenCalledTimes(4);
  });

  it("resets after write/edit, a new agent run, or expiry of the 60-second window", async () => {
    let now = 10_000;
    const guard = createBashRepetitionGuard({ now: () => now });
    const pi = new FakePi();
    guard.extension(pi as never);
    pi.agentStart!();

    const execute = vi.fn(async () => ({ content: [], details: {} }));
    const wrapped = wrapCancellableBash(bashDefinition(execute), new Map(), guard);
    const run = (id: string) => wrapped.execute(id, { command: "python check.py", timeout: 5 }, undefined);

    await run("one");
    await run("two");
    pi.toolEnd!({ toolName: "write", isError: false });
    await run("after-write");
    expect(pi.context!({ messages: [] })).toBeUndefined();

    await run("after-write-2");
    pi.agentStart!();
    await run("new-run");
    expect(pi.context!({ messages: [] })).toBeUndefined();

    await run("new-run-2");
    now += 60_001;
    await run("expired");
    expect(pi.context!({ messages: [] })).toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(7);
  });

  it("tracks interleaved commands independently and warns only once per burst", async () => {
    const guard = createBashRepetitionGuard({ now: () => 1_000 });
    const pi = new FakePi();
    guard.extension(pi as never);
    pi.agentStart!();
    const execute = vi.fn(async () => ({ content: [], details: {} }));
    const wrapped = wrapCancellableBash(bashDefinition(execute), new Map(), guard);

    for (const [index, command] of ["tail run.log", "date", "tail run.log", "date", "tail run.log"].entries()) {
      await wrapped.execute(`call-${index}`, { command, timeout: 5 }, undefined);
    }

    const first = pi.context!({ messages: [] });
    expect(warningText(first!.messages)).not.toBe("");
    expect(pi.context!({ messages: first!.messages })?.messages ?? []).toEqual([]);
    expect(pi.context!({ messages: [] })).toBeUndefined();
  });
});
