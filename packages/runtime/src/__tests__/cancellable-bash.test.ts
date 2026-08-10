import { describe, expect, it, vi } from "vitest";
import { wrapCancellableBash } from "../agent-factory.js";

function bashDefinition(execute: (...args: any[]) => Promise<unknown>) {
  return {
    name: "bash",
    description: "Run a shell command",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string" },
        timeout: { type: "number", description: "optional timeout" },
      },
      required: ["command"],
    },
    execute,
  };
}

describe("cancellable Pi bash wrapper", () => {
  it("forwards args/update/context and aborts only the selected invocation", async () => {
    const update = vi.fn();
    const context = { cwd: "/workspace" };
    const execute = vi.fn(async (
      _id: string,
      _args: Record<string, unknown>,
      signal: AbortSignal,
      onUpdate?: (value: unknown) => void,
      receivedContext?: unknown,
    ) => new Promise((_resolve, reject) => {
      expect(onUpdate).toBe(update);
      expect(receivedContext).toBe(context);
      signal.addEventListener("abort", () => reject(new Error("line one\nCommand aborted")), { once: true });
    }));
    const controllers = new Map<string, AbortController>();
    const wrapped = wrapCancellableBash(bashDefinition(execute), controllers);
    const runSignal = new AbortController();
    const pending = wrapped.execute("tool-1", { command: "sleep 60", timeout: 60 }, runSignal.signal, update, context);

    expect(controllers.has("tool-1")).toBe(true);
    controllers.get("tool-1")!.abort();
    await expect(pending).rejects.toThrow("line one\nCommand aborted\nCommand interrupted by user");
    expect(runSignal.signal.aborted).toBe(false);
    expect(controllers.has("tool-1")).toBe(false);
    expect(execute).toHaveBeenCalledWith("tool-1", { command: "sleep 60", timeout: 60 }, expect.any(AbortSignal), update, context);
  });

  it("supports Pi invoking a tool without a run signal", async () => {
    const controllers = new Map<string, AbortController>();
    const execute = async (_id: string, _args: Record<string, unknown>, signal?: AbortSignal) =>
      new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("partial")), { once: true });
      });
    const wrapped = wrapCancellableBash(bashDefinition(execute), controllers);
    const pending = wrapped.execute("tool-no-signal", { command: "sleep 60", timeout: 60 }, undefined);
    controllers.get("tool-no-signal")!.abort();
    await expect(pending).rejects.toThrow("partial\nCommand interrupted by user");
  });

  it("preserves task-abort errors instead of relabelling them as a user script stop", async () => {
    const execute = async (_id: string, _args: Record<string, unknown>, signal: AbortSignal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("Task aborted")), { once: true });
      });
    const wrapped = wrapCancellableBash(bashDefinition(execute), new Map());
    const run = new AbortController();
    const pending = wrapped.execute("tool-2", { command: "sleep 60", timeout: 60 }, run.signal);
    run.abort();
    await expect(pending).rejects.toThrow("Task aborted");
  });

  it("requires an explicit timeout of at most 300 seconds", async () => {
    const execute = vi.fn(async () => ({ content: [] }));
    const wrapped = wrapCancellableBash(bashDefinition(execute), new Map());
    const parameters = wrapped.parameters as { required: string[]; properties: Record<string, Record<string, unknown>> };

    expect(parameters.required).toEqual(["command", "timeout"]);
    expect(parameters.properties.timeout).toMatchObject({ type: "number", minimum: 1, maximum: 300 });
    await expect(wrapped.execute("missing", { command: "pwd" }, undefined)).rejects.toThrow(/timeout.*required/i);
    await expect(wrapped.execute("zero", { command: "pwd", timeout: 0 }, undefined)).rejects.toThrow(/between 1 and 300/i);
    await expect(wrapped.execute("long", { command: "pwd", timeout: 301 }, undefined)).rejects.toThrow(/between 1 and 300/i);
    expect(execute).not.toHaveBeenCalled();
  });
});
