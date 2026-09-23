import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installWorkflowStageCompletion } from "../agent-factory.js";

// Resolve the exact core installed with Pi; do not assume npm hoisted its
// dependency or introduce another core version just for this test.
const require = createRequire(import.meta.url);
// coding-agent exports only an ESM import condition, so require.resolve(name)
// cannot select its entry. Vite also lacks import.meta.resolve. Locate its
// package metadata along Node's normal lookup paths, then use the declared main.
const piPackagePath = require.resolve.paths("@earendil-works/pi-coding-agent")
  ?.map(path => join(path, "@earendil-works/pi-coding-agent/package.json")).find(existsSync);
if (!piPackagePath) throw new Error("The runtime's installed Pi coding-agent package was not found");
const piPackage = JSON.parse(readFileSync(piPackagePath, "utf8")) as { main: string };
const piRequire = createRequire(resolve(dirname(piPackagePath), piPackage.main));
const corePackagePath = piRequire.resolve("@earendil-works/pi-agent-core/package.json");
const corePackage = JSON.parse(readFileSync(corePackagePath, "utf8")) as { main: string };
const { Agent } = await import(pathToFileURL(resolve(dirname(corePackagePath), corePackage.main)).href);

type Message = {
  role: string; content: Array<Record<string, unknown>>; stopReason?: string;
  errorMessage?: string; usage?: { totalTokens: number; [key: string]: unknown };
  toolName?: string; isError?: boolean; [key: string]: unknown;
};
type Event = { type: string; message?: Message; [key: string]: unknown };
const usage = { input: 7, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 12,
  cost: { input: 0.07, output: 0.05, cacheRead: 0, cacheWrite: 0, total: 0.12 } };
const model = { id: "local-loop-fixture", name: "Local loop fixture", provider: "test-only", api: "anthropic-messages",
  baseUrl: "https://unused.invalid", input: ["text"], reasoning: false, contextWindow: 64_000, maxTokens: 4096,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
const parameters = { type: "object", required: ["result"], additionalProperties: false,
  properties: { result: { type: "object", required: ["text"], additionalProperties: false,
    properties: { text: { type: "string", minLength: 1 } } } } };
const network = vi.fn(async () => { throw new Error("This core-loop test must never call a provider"); });
beforeEach(() => { network.mockClear(); vi.stubGlobal("fetch", network); });
afterEach(() => { expect(network).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

function response(stopReason: string, result: unknown = { text: "complete result" }): Message {
  return { role: "assistant", api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(),
    content: [{ type: "toolCall", id: `call-${stopReason}`, name: "submit_result", arguments: { result } }],
    usage: structuredClone(usage), stopReason,
    ...(stopReason === "error" ? { errorMessage: "Anthropic stream ended before message_stop" } : {}) };
}

function setup(messages: Message[]) {
  const events: Event[] = [];
  const execute = vi.fn(async (_id: string, args: { result: { text: string } }) => ({
    content: [{ type: "text", text: "Result accepted" }], details: { accepted: args.result },
  }));
  const previousHook = vi.fn(() => false);
  let index = 0;
  const stream = vi.fn(() => {
    // A surprise extra request becomes a bounded failure, never a real call.
    const message = messages[index++] ?? response("error");
    return {
      async *[Symbol.asyncIterator]() {
        yield { type: "start", partial: message };
        yield { type: message.stopReason === "error" ? "error" : "done", reason: message.stopReason, message };
      },
      result: async () => message,
    };
  });
  const agent = new Agent({ initialState: { model, systemPrompt: "Local stage fixture.", thinkingLevel: "off",
    tools: [{ name: "submit_result", label: "Submit result", description: "Submit a complete result.", parameters, execute }] },
    streamFn: stream, shouldStopAfterTurn: previousHook });
  installWorkflowStageCompletion({ agent });
  agent.subscribe((event: Event) => { events.push(event); });
  return { agent, events, execute, previousHook, stream };
}

describe("workflow stage completion on the installed Pi core loop", () => {
  it("ends after one complete successful submit while retaining the tool result and assistant usage", async () => {
    const f = setup([response("toolUse")]);
    await f.agent.prompt("Produce a structured result.");
    expect(f.stream).toHaveBeenCalledTimes(1);
    expect(f.execute).toHaveBeenCalledTimes(1);
    expect(f.previousHook).toHaveBeenCalledTimes(1);
    expect(f.agent.state.isStreaming).toBe(false);
    expect(f.agent.state.messages.find((message: Message) => message.role === "toolResult"))
      .toMatchObject({ toolName: "submit_result", isError: false, details: { accepted: { text: "complete result" } } });
    const assistantEnds = f.events.filter(event => event.type === "message_end" && event.message?.role === "assistant");
    expect(assistantEnds).toHaveLength(1);
    expect(assistantEnds[0]!.message?.usage).toEqual(usage);
    expect(f.events.at(-1)?.type).toBe("agent_end");
    expect(f.agent.state.messages.some((message: Message) => message.stopReason === "error" || message.stopReason === "aborted")).toBe(false);
  });

  it("never executes or accepts plausible tool arguments from an initial error or length-truncated response", async () => {
    // Decoder failures are supplied at the StreamFn boundary. This tests the
    // real core's treatment of them, not a replacement SSE parser.
    for (const stopReason of ["error", "length"]) {
      const normalEnd = { ...response("stop"), content: [{ type: "text", text: "No valid structured result." }] };
      const f = setup([response(stopReason), normalEnd]);
      await f.agent.prompt("Produce a structured result.");
      expect(f.execute).not.toHaveBeenCalled();
      const results = f.agent.state.messages.filter((message: Message) => message.role === "toolResult");
      expect(results.some((message: Message) => message.isError === false)).toBe(false);
      // Errors end directly. Length-truncated calls become errors and continue
      // to the scripted next response, rather than taking the success hook.
      expect(f.stream).toHaveBeenCalledTimes(stopReason === "error" ? 1 : 2);
      expect(f.previousHook).toHaveBeenCalledTimes(stopReason === "error" ? 0 : 2);
      expect(f.agent.state.isStreaming).toBe(false);
    }
  });

  it("allows a schema-invalid submission to be corrected and stops only after the successful result", async () => {
    const invalid = response("toolUse", {});
    const valid = response("toolUse", { text: "corrected result" });
    (valid.content[0]!).id = "call-corrected";
    const f = setup([invalid, valid]);
    await f.agent.prompt("Produce a structured result.");
    expect(f.stream).toHaveBeenCalledTimes(2);
    expect(f.execute).toHaveBeenCalledTimes(1);
    expect(f.previousHook).toHaveBeenCalledTimes(2);
    const results = f.agent.state.messages.filter((message: Message) => message.role === "toolResult");
    expect(results.map((message: Message) => message.isError)).toEqual([true, false]);
    expect(results[1]).toMatchObject({ details: { accepted: { text: "corrected result" } } });
    const used = f.events.filter(event => event.type === "message_end" && event.message?.role === "assistant")
      .reduce((sum, event) => sum + (event.message?.usage?.totalTokens ?? 0), 0);
    expect(used).toBe(24);
    expect(f.agent.state.isStreaming).toBe(false);
  });
});
