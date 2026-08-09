import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionManager } from "../session-manager.js";
import type { AgentSessionFactory, IAgentSession, PiAgentEvent, SystemTool } from "../types.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 }))));

async function waitFor(predicate: () => boolean, timeoutMs = 5_000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("SessionManager subagent integration", () => {
  it("lets a shared-mode leaf write a canonical artifact directly into the session workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "bp-subagent-shared-integration-"));
    roots.push(root);
    let result = "";
    const factory: AgentSessionFactory = async ({ sessionId, cwd, systemTools }) => {
      const tools = new Map(systemTools.map((tool) => [tool.name, tool]));
      return {
        sessionId,
        isStreaming: false,
        subscribe() { return () => {}; },
        async prompt() {
          const submit = tools.get("submit_result");
          if (submit) {
            await writeFile(join(cwd, "shared-report.md"), "canonical report", "utf8");
            await submit.execute({ summary: "report complete", artifacts: [{ path: "shared-report.md" }] });
            return;
          }
          const spawned = await tools.get("spawn_subagent")!.execute({
            tasks: [{
              profile: "literature-scout",
              task: "write the canonical report",
              workspaceMode: "shared",
            }],
          });
          result = spawned.content[0]!.text;
        },
        async abort() {},
        dispose() {},
      } satisfies IAgentSession;
    };
    const manager = new SessionManager({ dataRoot: root, persist: false, agentFactory: factory });
    const session = await manager.createSession();
    await manager.sendMessage(session.id, "research it", "librarian");
    await waitFor(() => result.includes("shared-report.md"));

    expect(result).toContain('"path": "shared-report.md"');
    await expect(readFile(join(root, "workspaces", session.id, "shared-report.md"), "utf8"))
      .resolves.toBe("canonical report");
    await manager.deleteSession(session.id);
  });

  it("lets an expert launch in the background, continue, then explicitly wait", async () => {
    const root = await mkdtemp(join(tmpdir(), "bp-subagent-async-integration-"));
    roots.push(root);
    let continuedBeforeWait = false;
    let waitedResult = "";
    const factory: AgentSessionFactory = async ({ sessionId, agentName, systemTools }) => {
      const tools = new Map(systemTools.map((tool) => [tool.name, tool]));
      return {
        sessionId,
        isStreaming: false,
        subscribe() { return () => {}; },
        async prompt() {
          const submit = tools.get("submit_result");
          if (submit) {
            await new Promise((resolve) => setTimeout(resolve, 10));
            await submit.execute({ summary: "background complete" });
            return;
          }
          if (agentName === "engineer") {
            const launched = await tools.get("spawn_subagent")!.execute({
              wait: false,
              tasks: [{ name: "async-check", profile: "code-runner", task: "check asynchronously" }],
            });
            const payload = JSON.parse(launched.content[0]!.text) as { subagents: Array<{ id: string }> };
            continuedBeforeWait = true;
            const waited = await tools.get("wait_subagent")!.execute({ child_ids: [payload.subagents[0]!.id] });
            waitedResult = waited.content[0]!.text;
          }
        },
        async abort() {},
        dispose() {},
      } satisfies IAgentSession;
    };
    const manager = new SessionManager({ dataRoot: root, persist: false, agentFactory: factory, maxConcurrentAgents: 1 });
    const session = await manager.createSession();
    await manager.sendMessage(session.id, "do async work", "engineer");
    await waitFor(() => waitedResult.includes("background complete"));
    expect(continuedBeforeWait).toBe(true);
    expect(waitedResult).toContain('"status": "succeeded"');
    await manager.deleteSession(session.id);
  });

  it("lets an expert spawn a leaf child under provider concurrency=1 without deadlock", async () => {
    const root = await mkdtemp(join(tmpdir(), "bp-subagent-integration-"));
    roots.push(root);
    const seen: Array<{ agent: string; tools: string[]; prompt: string; suppressed?: boolean }> = [];
    const factory: AgentSessionFactory = async ({ sessionId, agentName, systemTools, allowedToolNames, suppressCoordinationHooks }) => {
      const tools = new Map(systemTools.map((tool) => [tool.name, tool]));
      const listeners = new Set<(event: PiAgentEvent) => void>();
      const session: IAgentSession = {
        sessionId,
        isStreaming: false,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        async prompt(prompt) {
          seen.push({ agent: agentName, tools: allowedToolNames, prompt, suppressed: suppressCoordinationHooks });
          const submit = tools.get("submit_result");
          if (submit) {
            await submit.execute({ summary: "child complete", findings: ["verified"] });
            listeners.forEach((listener) => listener({ type: "message_end", message: { role: "assistant", usage: { input: 2, output: 1 } } }));
            return;
          }
          if (agentName === "engineer") {
            const spawn = tools.get("spawn_subagent") as SystemTool | undefined;
            expect(spawn).toBeDefined();
            await spawn!.execute({ tasks: [
              { name: "check-a", profile: "code-runner", task: "run check a" },
              { name: "check-b", profile: "code-runner", task: "run check b" },
            ] });
          }
        },
        async abort() {},
        dispose() {},
      };
      return session;
    };
    const manager = new SessionManager({ dataRoot: root, persist: false, agentFactory: factory, maxConcurrentAgents: 1 });
    const session = await manager.createSession();
    await Promise.race([
      manager.sendMessage(session.id, "do work", "engineer"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("nested provider lease deadlocked")), 10_000)),
    ]);
    await waitFor(() => manager.getSessionState(session.id)?.subagents?.filter((child) => child.status === "succeeded").length === 2);
    const children = manager.getSessionState(session.id)?.subagents ?? [];
    const child = children[0];
    expect(child).toMatchObject({ parentAgent: "engineer", profile: "code-runner", status: "succeeded", resultSummary: "child complete" });
    const childCall = seen.find((call) => call.agent !== "engineer");
    expect(childCall?.tools).toContain("submit_result");
    expect(childCall?.suppressed).toBe(true);
    expect(childCall?.tools).not.toEqual(expect.arrayContaining(["spawn_subagent", "send_message", "ask_user", "record_trace"]));
    expect(children).toHaveLength(2);
    expect(manager.getSessionState(session.id)?.tokenUsage.byAgent[child!.id]?.total).toBe(3);
    expect(manager.getTrace(session.id)?.nodes.some((node) => node.metadata?.childId === child!.id)).toBe(false);
    await manager.deleteSession(session.id);
  });
});
