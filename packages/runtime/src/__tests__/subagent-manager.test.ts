import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EventBus } from "../event-bus.js";
import { SubagentManager } from "../subagent-manager.js";
import type { IAgentSession, PiAgentEvent, SystemTool } from "../types.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function fixture(opts: { submit?: boolean; gate?: () => Promise<void>; timeoutMs?: number; maxConcurrency?: number; maxCopyBytes?: number; artifactPath?: string } = {}) {
  const root = await mkdtemp(join(tmpdir(), "bp-subagent-"));
  roots.push(root);
  const workspace = join(root, "workspaces", "s1");
  const state = join(root, ".bp", "s1");
  const data = join(root, "data");
  await Promise.all([mkdir(workspace, { recursive: true }), mkdir(state, { recursive: true }), mkdir(data, { recursive: true })]);
  const seen: Array<{ id: string; cwd: string; historyPath: string; prompt: string }> = [];
  let active = 0;
  let maxActive = 0;
  const manager = new SubagentManager({
    sessionId: "s1",
    dataRoot: root,
    stateDir: state,
    workspaceDir: workspace,
    persistentDir: data,
    bus: new EventBus(),
    createChildSession: async ({ childId, cwd, historyPath, submitTool }) => {
      const listeners = new Set<(event: PiAgentEvent) => void>();
      const session: IAgentSession = {
        sessionId: childId,
        isStreaming: false,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        async prompt(prompt) {
          seen.push({ id: childId, cwd, historyPath, prompt });
          active++;
          maxActive = Math.max(maxActive, active);
          await opts.gate?.();
          if (opts.submit !== false && !prompt.startsWith("You have not")) {
            const artifactPath = opts.artifactPath ?? `${childId}.txt`;
            if (!artifactPath.startsWith("..")) await writeFile(join(cwd, artifactPath), childId, "utf8");
            await submitTool.execute({ summary: `done ${childId}`, findings: ["ok"], artifacts: [{ path: artifactPath }] });
            listeners.forEach((listener) => listener({ type: "message_end", message: { role: "assistant", usage: { input: 3, output: 2 } } }));
          }
          active--;
        },
        async abort() {},
        dispose() {},
      };
      return session;
    },
    runWithProviderCapacity: (fn) => fn(),
    onUsage: () => {},
    onRunFinished: () => {},
    onChanged: () => {},
    maxConcurrency: opts.maxConcurrency ?? 4,
    timeoutMs: opts.timeoutMs ?? 2_000,
    maxCopyBytes: opts.maxCopyBytes,
  });
  return { root, workspace, state, data, manager, seen, maxActive: () => maxActive };
}

describe("SubagentManager", () => {
  it("starts a background batch, exposes live status, and waits by child id", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const f = await fixture({ gate: () => gate });
    const started = await f.manager.startBatch({
      parentAgent: "librarian",
      rootRunId: "run-async",
      tasks: [{ name: "background", profile: "literature-scout", task: "search later" }],
    });
    expect(started).toHaveLength(1);
    expect(["queued", "running"]).toContain(started[0]!.status);
    expect(f.manager.listForParent("librarian", [started[0]!.id])).toHaveLength(1);

    const waiting = f.manager.waitFor("librarian", [started[0]!.id]);
    release();
    await expect(waiting).resolves.toEqual([
      expect.objectContaining({ childId: started[0]!.id, status: "succeeded" }),
    ]);
    await expect(f.manager.waitFor("engineer", [started[0]!.id])).rejects.toThrow("not owned");
  });

  it("runs same-profile children with isolated histories/workspaces and stable result order", async () => {
    const f = await fixture({ gate: () => new Promise((resolve) => setTimeout(resolve, 10)) });
    const results = await f.manager.runBatch({
      parentAgent: "librarian",
      rootRunId: "run-1",
      context: "shared-only",
      tasks: [
        { name: "a", profile: "literature-scout", task: "first" },
        { name: "b", profile: "literature-scout", task: "second" },
      ],
    });
    expect(results.map((result) => result.childId.split("-")[0])).toEqual(["a", "b"]);
    expect(results.every((result) => result.status === "succeeded")).toBe(true);
    expect(new Set(f.seen.map((item) => item.historyPath)).size).toBe(2);
    expect(new Set(f.seen.map((item) => item.cwd)).size).toBe(2);
    expect(f.seen.find((item) => item.id.startsWith("a-"))?.prompt).not.toContain("second");
    expect(f.seen.find((item) => item.id.startsWith("b-"))?.prompt).not.toContain("first");
    expect(f.maxActive()).toBe(2);
    for (const result of results) {
      expect(await readFile(join(f.workspace, result.artifacts[0]!.path), "utf8")).toBe(result.childId);
      expect(result.usage.total).toBe(5);
    }
  });

  it("copies explicit workspace inputs and rejects traversal before session creation", async () => {
    const f = await fixture();
    await writeFile(join(f.workspace, "paper.txt"), "evidence", "utf8");
    await f.manager.runBatch({
      parentAgent: "librarian",
      rootRunId: null,
      tasks: [{ profile: "evidence-extractor", task: "extract", inputs: [{ scope: "workspace", path: "paper.txt" }] }],
    });
    expect(await readFile(join(f.seen[0]!.cwd, "inputs", "paper.txt"), "utf8")).toBe("evidence");
    await expect(f.manager.runBatch({
      parentAgent: "librarian", rootRunId: null,
      tasks: [{ profile: "evidence-extractor", task: "bad", inputs: [{ scope: "workspace", path: "../secret" }] }],
    })).resolves.toEqual([expect.objectContaining({ status: "failed", error: expect.stringContaining("invalid subagent input path") })]);
  });

  it("enforces the input-copy byte limit and artifact confinement", async () => {
    const limited = await fixture({ maxCopyBytes: 3 });
    await writeFile(join(limited.workspace, "large.txt"), "1234", "utf8");
    const [copyFailure] = await limited.manager.runBatch({
      parentAgent: "librarian", rootRunId: null,
      tasks: [{ profile: "evidence-extractor", task: "copy", inputs: [{ scope: "workspace", path: "large.txt" }] }],
    });
    expect(copyFailure).toMatchObject({ status: "failed", error: expect.stringContaining("copy limit") });

    const escaping = await fixture({ artifactPath: "../escape.txt" });
    const [artifactFailure] = await escaping.manager.runBatch({
      parentAgent: "engineer", rootRunId: null,
      tasks: [{ profile: "code-runner", task: "escape" }],
    });
    expect(artifactFailure).toMatchObject({ status: "failed", error: expect.stringContaining("artifact escapes") });
  });

  it("rejects unknown and parent-disallowed profiles before creating a child", async () => {
    const f = await fixture();
    await expect(f.manager.runBatch({ parentAgent: "librarian", rootRunId: null, tasks: [{ profile: "code-runner", task: "code" }] }))
      .rejects.toThrow("not allowed");
    expect(f.seen).toHaveLength(0);
  });

  it("runs a validated deployment-defined profile", async () => {
    const f = await fixture();
    const dir = join(f.root, "bp_template", "subagents", "custom-checker");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "prompt.md"), "Check the supplied implementation and submit findings.", "utf8");
    await writeFile(join(dir, "profile.json"), JSON.stringify({
      version: 1,
      description: "Custom implementation checker",
      allowedParents: ["engineer"],
      builtinTools: ["read", "grep"],
      systemTools: [],
      mcp: false,
    }), "utf8");
    const [result] = await f.manager.runBatch({
      parentAgent: "engineer", rootRunId: null,
      tasks: [{ profile: "custom-checker", task: "check it" }],
    });
    expect(result).toMatchObject({ profile: "custom-checker", status: "succeeded" });
    expect(f.seen[0]!.prompt).toContain("check it");
  });

  it("fails cleanly when the child never submits a result", async () => {
    const f = await fixture({ submit: false });
    const [result] = await f.manager.runBatch({
      parentAgent: "engineer", rootRunId: null,
      tasks: [{ profile: "code-runner", task: "work" }],
    });
    expect(result).toMatchObject({ status: "failed", error: "subagent exited without calling submit_result" });
    expect(f.seen).toHaveLength(3);
  });

  it("marks a timed-out child terminally", async () => {
    const f = await fixture({ gate: () => new Promise(() => {}), timeoutMs: 20 });
    const [result] = await f.manager.runBatch({
      parentAgent: "engineer", rootRunId: null,
      tasks: [{ profile: "code-runner", task: "hang" }],
    });
    expect(result).toMatchObject({ status: "timed_out", error: expect.stringContaining("timed out") });
  });

  it("restores unfinished persisted runs as interrupted without rerunning them", async () => {
    const f = await fixture();
    const runsDir = join(f.state, "subagents");
    await mkdir(runsDir, { recursive: true });
    await writeFile(join(runsDir, "runs.json"), JSON.stringify({
      version: 1,
      runs: [{ id: "old-child", parentAgent: "librarian", rootRunId: "r", profile: "literature-scout", label: "old", task: "old task", status: "running" }],
    }), "utf8");
    await f.manager.restore();
    expect(f.manager.list()[0]).toMatchObject({ id: "old-child", status: "interrupted" });
    expect(f.seen).toHaveLength(0);
  });

  it("cancels running and semaphore-queued children without starting the queued child", async () => {
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => { releaseGate = resolve; });
    const f = await fixture({ gate: () => gate, maxConcurrency: 1 });
    const batch = f.manager.runBatch({
      parentAgent: "librarian", rootRunId: null,
      tasks: [
        { name: "one", profile: "literature-scout", task: "one" },
        { name: "two", profile: "literature-scout", task: "two" },
      ],
    });
    while (f.manager.list().length < 2 || !f.manager.list().some((run) => run.status === "running")) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    expect(await f.manager.cancelAll()).toBe(2);
    releaseGate();
    const results = await batch;
    expect(results.map((result) => result.status)).toEqual(["cancelled", "cancelled"]);
    expect(f.seen.some((call) => call.id.startsWith("two-"))).toBe(false);
    expect(f.seen.length).toBeLessThanOrEqual(1);
  });

  it("can cancel one queued child without cancelling its sibling", async () => {
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => { releaseGate = resolve; });
    const f = await fixture({ gate: () => gate, maxConcurrency: 1 });
    const batch = f.manager.runBatch({
      parentAgent: "librarian", rootRunId: null,
      tasks: [
        { name: "keep", profile: "literature-scout", task: "keep" },
        { name: "cancel", profile: "literature-scout", task: "cancel" },
      ],
    });
    while (f.manager.list().length < 2) await new Promise((resolve) => setTimeout(resolve, 1));
    const queued = f.manager.list().find((run) => run.label === "cancel")!;
    expect(await f.manager.cancel(queued.id)).toBe(true);
    releaseGate();
    const results = await batch;
    expect(results.map((result) => result.status)).toEqual(["succeeded", "cancelled"]);
  });
});

