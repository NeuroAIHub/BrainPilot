import { describe, expect, it, vi } from "vitest";
import { wrapCancellableBash } from "../agent-factory.js";

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
      signal.addEventListener("abort", () => reject(new Error("Command aborted")), { once: true });
    }));
    const controllers = new Map<string, AbortController>();
    const wrapped = wrapCancellableBash({ name: "bash", execute }, controllers);
    const runSignal = new AbortController();
    const pending = wrapped.execute("tool-1", { command: "sleep 60" }, runSignal.signal, update, context);

    expect(controllers.has("tool-1")).toBe(true);
    controllers.get("tool-1")!.abort();
    await expect(pending).rejects.toThrow("Command interrupted by user");
    expect(runSignal.signal.aborted).toBe(false);
    expect(controllers.has("tool-1")).toBe(false);
    expect(execute).toHaveBeenCalledWith("tool-1", { command: "sleep 60" }, expect.any(AbortSignal), update, context);
  });

  it("preserves task-abort errors instead of relabelling them as a user script stop", async () => {
    const execute = async (_id: string, _args: Record<string, unknown>, signal: AbortSignal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("Task aborted")), { once: true });
      });
    const wrapped = wrapCancellableBash({ name: "bash", execute }, new Map());
    const run = new AbortController();
    const pending = wrapped.execute("tool-2", {}, run.signal);
    run.abort();
    await expect(pending).rejects.toThrow("Task aborted");
  });
});
