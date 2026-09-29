import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createAgentSession, DefaultResourceLoader, defineTool, estimateTokens,
  ModelRuntime, SessionManager, SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { installContextCompactionGuard } from "../context-compaction.js";
import { resolveSessionModel } from "../pi-provider.js";
import { MasAgent } from "../mas-agent.js";
import { EventBus } from "../event-bus.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

type RecordedMessage = { role: string; content?: unknown; toolCallId?: string };
type RecordedContext = { systemPrompt: string; messages: RecordedMessage[] };

function reply(model: { api: string; provider: string; id: string }, content: unknown[], stopReason = "stop", totalTokens = 100, errorMessage?: string) {
  const message = {
    role: "assistant", content, api: model.api, provider: model.provider, model: model.id,
    usage: { input: totalTokens - 10, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason, errorMessage, timestamp: Date.now(),
  };
  return {
    result: async () => message,
    async *[Symbol.asyncIterator]() { yield { type: "done", message }; },
  };
}

async function realPiHarness(beforeGuard?: (session: Awaited<ReturnType<typeof createAgentSession>>["session"]) => void) {
  const root = await mkdtemp(join(tmpdir(), "bp-pi-context-"));
  roots.push(root);
  const agentDir = join(root, "agent");
  const { model, modelRuntime } = await resolveSessionModel(
    { ModelRuntime }, agentDir,
    { providerId: "local-fixture", baseUrl: "https://unused.invalid", api: "anthropic-messages",
      apiKey: "test-only", modelId: "fixture", contextWindow: 1_000, maxTokens: 200 },
  );
  const settingsManager = SettingsManager.create(root, agentDir, { projectTrusted: true });
  settingsManager.applyOverrides({
    compaction: { enabled: true, reserveTokens: 250, keepRecentTokens: 310 },
    retry: { enabled: false, maxRetries: 0, baseDelayMs: 0 },
  });
  const resourceLoader = new DefaultResourceLoader({
    cwd: root, agentDir, settingsManager, noExtensions: true, noSkills: true, noContextFiles: true,
  });
  await resourceLoader.reload();
  const manager = SessionManager.inMemory(root);
  const tool = defineTool({
    name: "inflate", label: "Inflate", description: "Return a deterministic fixture",
    parameters: { type: "object", properties: { step: { type: "integer" } }, required: ["step"] },
    execute: async (_id, args) => ({
      content: [{ type: "text", text: args.step === 1 ? "A".repeat(1_200) : "B".repeat(80) }],
      details: {},
    }),
  });
  const { session } = await createAgentSession({
    cwd: root, tools: ["inflate"], customTools: [tool], model: model as never, modelRuntime: modelRuntime as never,
    resourceLoader, settingsManager, sessionManager: manager,
  });
  session.settingsManager.applyOverrides({
    compaction: { enabled: true, reserveTokens: 250, keepRecentTokens: 310 },
    retry: { enabled: false, maxRetries: 0, baseDelayMs: 0 },
  });
  beforeGuard?.(session);
  installContextCompactionGuard(session, estimateTokens as never);
  return { session, manager, model: model as { api: string; provider: string; id: string } };
}

async function primeHistory(
  session: Awaited<ReturnType<typeof realPiHarness>>["session"],
  model: Awaited<ReturnType<typeof realPiHarness>>["model"],
) {
  session.agent.streamFunction = (() => reply(model, [{ type: "text", text: "Prior completed work" }])) as never;
  await session.prompt("Earlier task with completed answer");
}

describe("Pi 0.84.2 context recovery integration (no network)", () => {
  it("compacts before a second tool-loop request and retains the summary through later turns", async () => {
    const { session, manager, model } = await realPiHarness();
    await primeHistory(session, model);
    const contexts: RecordedContext[] = [];
    let summaries = 0;
    let requests = 0;
    const events: Array<{ type: string; reason?: string; errorMessage?: string }> = [];
    session.subscribe((event) => events.push(event));
    session.agent.streamFunction = ((_: unknown, context: RecordedContext) => {
      if (context.messages[0]?.role === "user" &&
          JSON.stringify(context.messages[0]?.content).includes("<conversation>")) {
        summaries++;
        return reply(model, [{ type: "text", text: "SUMMARY: first tool completed" }]);
      }
      contexts.push({ systemPrompt: context.systemPrompt, messages: structuredClone(context.messages) });
      requests++;
      if (requests <= 2) {
        return reply(model, [{ type: "toolCall", id: `call-${requests}`, name: "inflate",
          arguments: { step: requests } }], "toolUse", requests === 1 ? 600 : 180);
      }
      return reply(model, [{ type: "text", text: "done" }]);
    }) as never;

    await session.prompt("Complete two tool steps");
    expect(requests).toBe(3);
    expect(summaries).toBeGreaterThan(0);
    expect(events.some((event) => event.type === "compaction_end" && event.reason === "threshold" && !event.errorMessage)).toBe(true);
    const raw = manager.getEntries();
    expect(raw.some((entry) => entry.type === "compaction")).toBe(true);
    expect(raw.filter((entry) => entry.type === "message")).toHaveLength(8);
    // Pi keeps the active tool call/result pair. Earlier completed history is
    // summarized, and the next tool turn must keep using that rebuilt branch.
    for (const context of contexts.slice(1)) {
      const text = JSON.stringify(context.messages);
      expect(text).toContain("SUMMARY: first tool completed");
      expect(text).not.toContain("Earlier task with completed answer");
      expect(text).toContain("A".repeat(1_200));
    }
    const replay = manager.buildSessionContext().messages as RecordedMessage[];
    const callIds = new Set<string>();
    for (const message of replay) {
      if (message.role === "assistant") {
        for (const block of (message.content ?? []) as Array<{ type?: string; id?: string }>) {
          if (block.type === "toolCall" && block.id) callIds.add(block.id);
        }
      }
      if (message.role === "toolResult") expect(callIds.has(message.toolCallId ?? "")).toBe(true);
    }
    session.dispose();
  });

  it("surfaces summary HTTP 400 once and does not issue an output-limit recovery prompt", async () => {
    const { session, model } = await realPiHarness();
    await primeHistory(session, model);
    const bus = new EventBus();
    const captured: Array<{ type: string; code?: string; message?: string }> = [];
    bus.subscribe((event) => captured.push(event));
    const agent = new MasAgent({ sessionId: "pi-rejected-summary", name: "Engineer", role: "expert",
      session: session as never, bus });
    let summaries = 0;
    let providerRequests = 0;
    session.agent.streamFunction = ((_: unknown, context: RecordedContext) => {
      if (context.messages[0]?.role === "user" &&
          JSON.stringify(context.messages[0]?.content).includes("<conversation>")) {
        summaries++;
        return reply(model, [], "error", 0,
          '400 {"error":{"code":"data_inspection_failed"}}') as never;
      }
      providerRequests++;
      return reply(model, [{ type: "toolCall", id: "call-1", name: "inflate", arguments: { step: 1 } }],
        "toolUse", 600);
    }) as never;
    await agent.prompt("One tool step");
    expect(summaries).toBe(1);
    expect(providerRequests).toBe(1);
    expect(captured.find((event) => event.type === "RUN_ERROR"))
      .toMatchObject({ code: "CONTEXT_COMPACTION_FAILED" });
    expect(agent.lastErrorKind).toBe("fatal");
    agent.stop();
  });

  it("cancels compaction during async auth before the summarizer can start", async () => {
    let enteredAuth!: () => void;
    let releaseAuth!: () => void;
    const authEntered = new Promise<void>((resolve) => { enteredAuth = resolve; });
    const authGate = new Promise<void>((resolve) => { releaseAuth = resolve; });
    const { session, model } = await realPiHarness((pi) => {
      const original = pi._getSummarizationRequestAuth.bind(pi);
      pi._getSummarizationRequestAuth = async (selectedModel) => {
        enteredAuth();
        await authGate;
        return original(selectedModel);
      };
    });
    await primeHistory(session, model);
    const bus = new EventBus();
    const captured: Array<{ type: string }> = [];
    bus.subscribe((event) => captured.push(event));
    const agent = new MasAgent({ sessionId: "pi-stop-summary", name: "Engineer", role: "expert",
      session: session as never, bus });
    let summaryCalls = 0;
    session.agent.streamFunction = ((_: unknown, context: RecordedContext) => {
      if (context.messages[0]?.role === "user" &&
          JSON.stringify(context.messages[0]?.content).includes("<conversation>")) {
        summaryCalls++;
        return reply(model, [{ type: "text", text: "late summary" }]);
      }
      return reply(model, [{ type: "toolCall", id: "call-1", name: "inflate", arguments: { step: 1 } }],
        "toolUse", 600);
    }) as never;
    const running = agent.prompt("One tool step");
    await authEntered;
    const stopping = agent.abort();
    releaseAuth();
    await stopping;
    await running;
    expect(summaryCalls).toBe(0);
    expect(captured.some((event) => event.type === "RUN_ERROR")).toBe(false);
    expect(captured.some((event) => event.type === "RUN_FINISHED")).toBe(true);
    agent.stop();
  });
});
