import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEvent, type AgUiEvent } from "@brainpilot/protocol";
import { SessionManager, warnOnDeprecatedPersistentUserId, resolveSharedDir } from "../session-manager.js";
import {
  PERSISTENT_LAYOUT_MARKER,
  PERSISTENT_LAYOUT_STAGING,
} from "../persistent-layout.js";
import { mockAgentFactory } from "../agent-factory.js";
import { PERSONAS } from "../personas.js";

function mgr(): SessionManager {
  // persist:false keeps tests hermetic; mock factory => no Pi SDK / API.
  return new SessionManager({ persist: false, agentFactory: mockAgentFactory });
}

describe("SessionManager (mock mode)", () => {
  let m: SessionManager;
  beforeEach(() => {
    m = mgr();
  });

  it("create -> send -> stream -> run_finished", async () => {
    const session = await m.createSession({ title: "Test" });
    expect(session.id).toBeTruthy();

    const events: AgUiEvent[] = [];
    const unsub = m.subscribe(session.id, (e) => events.push(e));
    expect(unsub).toBeTypeOf("function");

    const res = await m.sendMessage(session.id, "hello principal");
    expect(res.accepted).toBe(true);

    // Wait for the async run to finish.
    await waitFor(() => events.some((e) => e.type === "RUN_FINISHED"));

    for (const e of events) expect(() => parseEvent(e)).not.toThrow();
    const types = events.map((e) => e.type);
    expect(types).toContain("RUN_STARTED");
    expect(types).toContain("RUN_FINISHED");
    unsub?.();
  });

  it("lists and deletes sessions", async () => {
    const a = await m.createSession({ title: "A" });
    const b = await m.createSession({ title: "B" });
    expect((await m.listSessions()).map((s) => s.id).sort()).toEqual([a.id, b.id].sort());
    expect(await m.deleteSession(a.id)).toBe(true);
    expect(m.getSession(a.id)).toBeUndefined();
    expect(await m.listSessions()).toHaveLength(1);
  });

  it("auto-creates the principal on first message", async () => {
    const s = await m.createSession();
    await m.sendMessage(s.id, "hi");
    await waitFor(() => m.listAgents(s.id).length > 0);
    const agents = m.listAgents(s.id);
    expect(agents.map((a) => a.name)).toContain("principal");
  });

  it("persists the user message as a role:user CHUNK with the client uuid (#42)", async () => {
    const s = await m.createSession();
    const events: AgUiEvent[] = [];
    m.subscribe(s.id, (e) => events.push(e));

    await m.sendMessage(s.id, "hello from user", "principal", { uuid: "u-123" });
    await waitFor(() => events.some((e) => e.type === "RUN_FINISHED"));

    const chunk = events.find((e) => e.type === "TEXT_MESSAGE_CHUNK") as
      | (AgUiEvent & { message_id: string; role: string; delta: string })
      | undefined;
    expect(chunk).toBeDefined();
    expect(chunk?.role).toBe("user");
    expect(chunk?.message_id).toBe("u-123");
    expect(chunk?.delta).toBe("hello from user");
    expect(() => parseEvent(chunk as AgUiEvent)).not.toThrow();
  });

  it("falls back to a generated id when the client omits uuid (#42)", async () => {
    const s = await m.createSession();
    const events: AgUiEvent[] = [];
    m.subscribe(s.id, (e) => events.push(e));

    await m.sendMessage(s.id, "no uuid here");
    await waitFor(() => events.some((e) => e.type === "TEXT_MESSAGE_CHUNK"));

    const chunk = events.find((e) => e.type === "TEXT_MESSAGE_CHUNK") as
      | (AgUiEvent & { message_id: string; role: string })
      | undefined;
    expect(chunk?.role).toBe("user");
    expect(chunk?.message_id).toBeTruthy();
  });

  it("merges built-in skills MCP tools for non-trace agents", async () => {
    const seenTools: string[][] = [];
    const spyFactory: typeof mockAgentFactory = async (params) => {
      seenTools.push(params.systemTools.map((t) => t.name));
      return mockAgentFactory(params);
    };
    const sm = new SessionManager({ persist: false, agentFactory: spyFactory });
    const s = await sm.createSession();
    await sm.sendMessage(s.id, "hi");
    await waitFor(() => seenTools.length > 0);

    // Principal is a non-trace agent — should have system tools.
    const principalTools = seenTools[0]!;
    expect(principalTools).toContain("dispatch_task");
    expect(principalTools).toContain("complete_task");
    expect(principalTools).toContain("ask_user");
  });

  it("injects the built-in persona (not the old placeholder) for the principal", async () => {
    const seen: string[] = [];
    const spyFactory: typeof mockAgentFactory = async (params) => {
      if (params.agentName === "principal") seen.push(params.systemPrompt);
      return mockAgentFactory(params);
    };
    const sm = new SessionManager({ persist: false, agentFactory: spyFactory });
    const s = await sm.createSession();
    await sm.sendMessage(s.id, "hi");
    await waitFor(() => seen.length > 0);

    expect(seen[0]).toContain("Principal Investigator");
    expect(seen[0]).not.toMatch(/^You are the principal agent/);
    expect(seen[0]).not.toContain("mcp__builtin__");
  });

  it("does not wire GoT context renderers into agent turns", async () => {
    const seen: string[] = [];
    const spyFactory: typeof mockAgentFactory = async (params) => {
      if ("renderGoTContext" in params) seen.push(params.agentName);
      return mockAgentFactory(params);
    };
    const sm = new SessionManager({ persist: false, agentFactory: spyFactory });
    const session = await sm.createSession();
    await sm.sendMessage(session.id, "hi");
    await waitFor(() => sm.listAgents(session.id).some((agent) => agent.name === "principal"));
    expect(seen).toEqual([]);
  });

  it("always wires the Principal workflow guard", async () => {
    const seen: Parameters<typeof mockAgentFactory>[0][] = [];
    const spyFactory: typeof mockAgentFactory = async (params) => {
      seen.push(params);
      return mockAgentFactory(params);
    };
    const manager = new SessionManager({ persist: false, agentFactory: spyFactory });

    const session = await manager.createSession();
    await manager.sendMessage(session.id, "run the research task");
    await waitFor(() => seen.some((params) => params.sessionId === session.id));
    const principal = seen.find(
      (params) => params.sessionId === session.id && params.agentName === "principal",
    )!;
    expect(principal.principalWorkflowGuard?.renderState()).toContain(
      "requires a qualifying Expert delegation",
    );

    const dispatch = principal.systemTools.find((tool) => tool.name === "dispatch_task")!;
    await dispatch.execute({ to: "writer", content: "polish a document" });
    expect(principal.principalWorkflowGuard?.hasQualifyingDelegation()).toBe(false);
    await dispatch.execute({ to: "engineer", content: "inspect the data contract" });
    expect(principal.principalWorkflowGuard?.hasQualifyingDelegation()).toBe(true);
    expect(principal.principalWorkflowGuard?.renderState()).toBe("");
  });

  it("keeps high-impact action authorization in PI and expert personas", () => {
    expect(PERSONAS.principal).toContain("## User authorization gate");
    expect(PERSONAS.principal).toContain("Use `ask_user` first");
    expect(PERSONAS.principal).toContain("## Incremental planning for heavy work");
    expect(PERSONAS.principal).toContain("broad, low-cost, decision-relevant comparison");
    expect(PERSONAS.engineer).toContain("## High-impact action gate");
    expect(PERSONAS.engineer).toContain('complete_task(task_id="<exact assigned ID>"');
    expect(PERSONAS.engineer).toContain("## Execution discipline");
    expect(PERSONAS.engineer).toContain("Prefer writing new outputs inside the session workspace");
    expect(PERSONAS.experimentalist).toContain("## High-impact action gate");
    expect(PERSONAS.experimentalist).toContain("long-running training");
  });

  it("injects the bundled Auditor plugin by default and removes it for ablation", async () => {
    const enabledSeen: Parameters<typeof mockAgentFactory>[0][] = [];
    const enabledFactory: typeof mockAgentFactory = async (params) => {
      enabledSeen.push(params);
      return mockAgentFactory(params);
    };
    const enabled = new SessionManager({ persist: false, agentFactory: enabledFactory });
    const enabledSession = await enabled.createSession();
    await enabled.sendMessage(enabledSession.id, "hello");
    const enabledPi = enabledSeen.find((params) => params.agentName === "principal")!;
    expect(enabledPi.systemPrompt).toContain("## Auditor feedback loop");
    expect(enabledPi.skillPaths).toEqual(expect.arrayContaining([
      expect.stringMatching(/plugin-auditor.*audit-feedback-loop/),
    ]));

    const disabledSeen: Parameters<typeof mockAgentFactory>[0][] = [];
    const disabledFactory: typeof mockAgentFactory = async (params) => {
      disabledSeen.push(params);
      return mockAgentFactory(params);
    };
    const disabled = new SessionManager({
      persist: false,
      agentFactory: disabledFactory,
      systemPluginEnv: { BP_EXPERIMENT_DISABLE_PLUGINS: "org.brainpilot.auditor" },
    });
    const disabledSession = await disabled.createSession();
    await disabled.sendMessage(disabledSession.id, "hello");
    const disabledPi = disabledSeen.find((params) => params.agentName === "principal")!;
    expect(disabledPi.systemPrompt).not.toMatch(/auditor|audit-feedback-loop/i);
    expect(disabledPi.skillPaths ?? []).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/plugin-auditor/),
    ]));
    await expect((disabled as unknown as {
      ensureAgent(sessionId: string, name: string): Promise<unknown>;
    }).ensureAgent(disabledSession.id, "auditor")).rejects.toThrow("system plugin is disabled");
  });

  it("persists the frozen plugin assignment and resolved installed version", async () => {
    const root = await mkdtemp(join(tmpdir(), "bp-system-plugin-meta-"));
    try {
      const manager = new SessionManager({
        dataRoot: root,
        persist: true,
        agentFactory: mockAgentFactory,
        systemPluginEnv: { BP_EXPERIMENT_DISABLE_PLUGINS: "org.brainpilot.auditor" },
      });
      const session = await manager.createSession();
      const meta = JSON.parse(await readFile(join(root, ".bp", session.id, "meta.json"), "utf8")) as {
        systemPlugins?: Array<{ id: string; enabled: boolean; reason: string }>;
      };
      expect(meta.systemPlugins).toContainEqual({
        id: "org.brainpilot.auditor",
        enabled: false,
        reason: "experiment-override",
        version: "0.1.2",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("ignores the removed workflow policy in legacy session metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "bp-legacy-workflow-policy-"));
    try {
      const manager = new SessionManager({ dataRoot: root, persist: true, agentFactory: mockAgentFactory });
      const session = await manager.createSession();
      const metaPath = join(root, ".bp", session.id, "meta.json");
      const meta = JSON.parse(
        await readFile(metaPath, "utf8"),
      ) as Record<string, unknown>;
      meta.workflowPolicy = "direct";
      await writeFile(metaPath, JSON.stringify(meta));

      const seen: Parameters<typeof mockAgentFactory>[0][] = [];
      const restored = new SessionManager({
        dataRoot: root,
        persist: true,
        agentFactory: async (params) => {
          seen.push(params);
          return mockAgentFactory(params);
        },
      });
      await restored.restoreFromDisk();
      await restored.sendMessage(session.id, "continue the research task");
      await waitFor(() => seen.some((params) => params.sessionId === session.id));
      expect(seen.find((params) => params.sessionId === session.id)?.principalWorkflowGuard)
        .toBeDefined();
      await waitFor(() => restored.getSessionState(session.id)?.workState.active === false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("prefers an on-disk bp_template/agents/<name>/prompt.md override", async () => {
    const root = await mkdtemp(join(tmpdir(), "bp-persona-"));
    const promptDir = join(root, "bp_template", "agents", "principal");
    await mkdir(promptDir, { recursive: true });
    await writeFile(join(promptDir, "prompt.md"), "# Custom PI\nDo it my way.", "utf8");

    const seen: string[] = [];
    const spyFactory: typeof mockAgentFactory = async (params) => {
      if (params.agentName === "principal") seen.push(params.systemPrompt);
      return mockAgentFactory(params);
    };
    const sm = new SessionManager({ dataRoot: root, persist: false, agentFactory: spyFactory });
    const s = await sm.createSession();
    await sm.sendMessage(s.id, "hi");
    await waitFor(() => seen.length > 0);

    // The on-disk persona remains the base, while non-overridable coordination
    // and language contracts are appended once at load time.
    expect(seen[0]).toContain("# Custom PI\nDo it my way.");
    expect(seen[0]!.match(/^## Handoffs$/gm)).toHaveLength(1);
    expect(seen[0]!.match(/^## Delegation$/gm)).toHaveLength(1);
    expect(seen[0]).toContain("## Response language");
    await rm(root, { recursive: true, force: true });
  });

  it("replaces legacy on-disk Auditor instructions with the system plugin contract", async () => {
    const root = await mkdtemp(join(tmpdir(), "bp-legacy-auditor-persona-"));
    const promptDir = join(root, "bp_template", "agents", "principal");
    await mkdir(promptDir, { recursive: true });
    await writeFile(join(promptDir, "prompt.md"), `# Custom PI

Keep this user customization.

Do NOT personally perform fabrication/reliability audit on expert claims. Also
do NOT send raw expert output directly to the \`auditor\`. For report-like work,
first form an auditable draft: ask the \`writer\` to write or polish a report
from the expert files, or draft a very small answer yourself. Then follow the
Pre-delivery audit below when the draft contains hard claims.

## Pre-delivery audit (mandatory)

Before delivery, dispatch the old mandatory workflow to \`auditor\`.

## User-facing communication style

Keep replies concise.`, "utf8");

    const seen: string[] = [];
    const spyFactory: typeof mockAgentFactory = async (params) => {
      if (params.agentName === "principal") seen.push(params.systemPrompt);
      return mockAgentFactory(params);
    };
    const sm = new SessionManager({ dataRoot: root, persist: false, agentFactory: spyFactory });
    const s = await sm.createSession();
    await sm.sendMessage(s.id, "hi");
    await waitFor(() => seen.length > 0);

    expect(seen[0]).toContain("Keep this user customization.");
    expect(seen[0]).not.toContain("Pre-delivery audit (mandatory)");
    expect(seen[0]).not.toContain("old mandatory workflow");
    expect(seen[0]!.match(/^## Auditor feedback loop$/gm)).toHaveLength(1);
    await rm(root, { recursive: true, force: true });
  });
});

async function waitFor(pred: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

// #5 — cross-platform: every workspace-relative path the runtime hands out
// (writeSessionFile result, skill_search responses) must use POSIX `/` so the
// API contract is identical on Windows and POSIX, the model never sees a
// backslash it has to JSON-escape, and URL query strings stay valid. And the
// inverse: paths echoed back by the model — including round-tripped ones with
// the backslash form — must still resolve. `\` is not a legal Windows
// filename character, so collapsing `\` → `/` on input is unambiguous.
describe("SessionManager workspace path normalization (#5)", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "bp-fs-"));
  });

  it("writeSessionFile returns nested paths in POSIX form", async () => {
    const m = new SessionManager({
      dataRoot: root,
      persist: false,
      agentFactory: mockAgentFactory,
    });
    const s = await m.createSession({ title: "fs" });
    const b64 = Buffer.from("hello", "utf8").toString("base64");
    const out = await m.writeSessionFile(s.id, "docs/sub/note.txt", b64);
    expect(out.path).toBe("docs/sub/note.txt");
    expect(out.path).not.toMatch(/\\/);
    await rm(root, { recursive: true, force: true });
  });

  it("accepts a backslash-shaped relative path on input and resolves identically", async () => {
    const m = new SessionManager({
      dataRoot: root,
      persist: false,
      agentFactory: mockAgentFactory,
    });
    const s = await m.createSession({ title: "fs" });
    const b64 = Buffer.from("x", "utf8").toString("base64");
    const a = await m.writeSessionFile(s.id, "a/b/c.txt", b64);
    const b = await m.writeSessionFile(s.id, "a\\b\\c.txt", b64);
    // Same logical path → both resolve to the same workspace location, both
    // returned in POSIX form.
    expect(a.path).toBe("a/b/c.txt");
    expect(b.path).toBe("a/b/c.txt");
    await rm(root, { recursive: true, force: true });
  });

  it("returns the empty string for a write at the workspace root", async () => {
    const m = new SessionManager({
      dataRoot: root,
      persist: false,
      agentFactory: mockAgentFactory,
    });
    const s = await m.createSession({ title: "fs" });
    const b64 = Buffer.from("y", "utf8").toString("base64");
    const out = await m.writeSessionFile(s.id, "top.txt", b64);
    expect(out.path).toBe("top.txt");
    await rm(root, { recursive: true, force: true });
  });
});

describe("SessionManager persistent cross-session root (#257)", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "bp-data-"));
  });

  const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

  it("a /data write is visible from a DIFFERENT session (cross-session reuse)", async () => {
    const m = new SessionManager({ dataRoot: root, persist: false, agentFactory: mockAgentFactory });
    const a = await m.createSession({ title: "A" });
    const b = await m.createSession({ title: "B" });

    // Upload into the persistent root from session A...
    const wrote = await m.writeSessionFile(a.id, "/data/dataset.csv", b64("shared,data"));
    // ...the returned path carries the /data prefix so it round-trips.
    expect(wrote.path).toBe("/data/dataset.csv");

    // ...and session B reads the SAME bytes via /data (would be impossible with
    // the per-session workspace, which is scoped to one sid).
    const read = await m.readSessionFile(b.id, "/data/dataset.csv");
    expect(read.content).toBe("shared,data");

    // On disk it lives flat under data/, NOT workspaces/<sid>/ (#287 removed
    // the per-user subdir; the runtime is single-user by contract).
    const onDisk = await readFile(join(root, "data", "dataset.csv"), "utf8");
    expect(onDisk).toBe("shared,data");
  });

  it("a workspace write stays per-session (NOT visible via another session)", async () => {
    const m = new SessionManager({ dataRoot: root, persist: false, agentFactory: mockAgentFactory });
    const a = await m.createSession({ title: "A" });
    const b = await m.createSession({ title: "B" });
    await m.writeSessionFile(a.id, "notes.txt", b64("only in A"));
    // B's workspace does not have it → read throws (ENOENT).
    await expect(m.readSessionFile(b.id, "notes.txt")).rejects.toThrow();
  });

  it("guards each root independently: /data cannot escape into the workspace or beyond", async () => {
    const m = new SessionManager({ dataRoot: root, persist: false, agentFactory: mockAgentFactory });
    const s = await m.createSession({ title: "S" });
    // `..` from /data must not reach the sibling workspaces/ tree or outside dataRoot.
    await expect(m.writeSessionFile(s.id, "/data/../workspaces/evil.txt", b64("x"))).rejects.toThrow(
      /escapes/,
    );
    await expect(m.readSessionFile(s.id, "/data/../../etc/passwd")).rejects.toThrow(/escapes/);
  });

  it("ignores the deprecated persistentUserId option and lands flat under data/ (#287)", async () => {
    const m = new SessionManager({
      dataRoot: root,
      persist: false,
      agentFactory: mockAgentFactory,
      // #287: this option is now ignored; the write must NOT land under
      // data/alice/ but flat in data/, mirroring the single-user contract.
      persistentUserId: "alice",
    });
    const s = await m.createSession({ title: "S" });
    await m.writeSessionFile(s.id, "/data/lib.txt", b64("hi"));
    const onDisk = await readFile(join(root, "data", "lib.txt"), "utf8");
    expect(onDisk).toBe("hi");
    // The legacy layout must not have been created.
    await expect(readFile(join(root, "data", "alice", "lib.txt"), "utf8")).rejects.toThrow();
  });
});

describe("SessionManager conversation attachments (.attachments/)", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "bp-att-"));
  });
  const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

  it("an /attachments write lands in the session's hidden .attachments/ subdir", async () => {
    const m = new SessionManager({ dataRoot: root, persist: false, agentFactory: mockAgentFactory });
    const s = await m.createSession({ title: "S" });
    const wrote = await m.writeSessionFile(s.id, "/attachments/report.pdf", b64("PDF"));
    // path round-trips WITH the /attachments prefix
    expect(wrote.path).toBe("/attachments/report.pdf");
    // physically under workspaces/<sid>/.attachments/, scoped to the session
    const onDisk = await readFile(join(root, "workspaces", s.id, ".attachments", "report.pdf"), "utf8");
    expect(onDisk).toBe("PDF");
  });

  it("hides internal workspace directories but lists attachments via /attachments", async () => {
    const m = new SessionManager({ dataRoot: root, persist: false, agentFactory: mockAgentFactory });
    const s = await m.createSession({ title: "S" });
    await m.writeSessionFile(s.id, "notes.txt", b64("agent output"));
    await m.writeSessionFile(s.id, "/attachments/input.csv", b64("a,b"));
    await mkdir(join(root, "workspaces", s.id, ".subagent-scratch"), { recursive: true });

    // Workspace root listing shows the agent file but NOT the .attachments dir.
    const wsRoot = await m.listSessionFiles(s.id, "/workspace");
    const names = wsRoot.map((e) => e.name);
    expect(names).toContain("notes.txt");
    expect(names).not.toContain(".attachments");
    expect(names).not.toContain(".subagent-scratch");

    // The attachments tier is listed via its own prefix.
    const att = await m.listSessionFiles(s.id, "/attachments");
    expect(att.map((e) => e.name)).toEqual(["input.csv"]);
  });

  it("guards the attachments boundary against traversal", async () => {
    const m = new SessionManager({ dataRoot: root, persist: false, agentFactory: mockAgentFactory });
    const s = await m.createSession({ title: "S" });
    await expect(
      m.writeSessionFile(s.id, "/attachments/../escape.txt", b64("x")),
    ).rejects.toThrow(/escapes/);
  });
});

describe("warnOnDeprecatedPersistentUserId (#287)", () => {
  it("is silent when neither the option nor the env is set", () => {
    const msgs: string[] = [];
    expect(warnOnDeprecatedPersistentUserId(undefined, {}, (m) => msgs.push(m))).toBe(false);
    expect(warnOnDeprecatedPersistentUserId("   ", { BP_USER_ID: "" }, (m) => msgs.push(m))).toBe(false);
    expect(msgs).toEqual([]);
  });
  it("warns (once, mentioning the env source) when only BP_USER_ID is set", () => {
    const msgs: string[] = [];
    expect(warnOnDeprecatedPersistentUserId(undefined, { BP_USER_ID: "bob" }, (m) => msgs.push(m))).toBe(true);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatch(/BP_USER_ID env \("bob"\)/);
    expect(msgs[0]).toMatch(/no longer controls path resolution since #287/);
  });
  it("warns (mentioning the option source) when only persistentUserId is passed", () => {
    const msgs: string[] = [];
    expect(warnOnDeprecatedPersistentUserId("alice", {}, (m) => msgs.push(m))).toBe(true);
    expect(msgs[0]).toMatch(/persistentUserId option \("alice"\)/);
  });
  it("names BOTH sources when they are both set", () => {
    const msgs: string[] = [];
    warnOnDeprecatedPersistentUserId("alice", { BP_USER_ID: "bob" }, (m) => msgs.push(m));
    expect(msgs[0]).toMatch(/persistentUserId option \("alice"\).*BP_USER_ID env \("bob"\)/);
  });
});

describe("SessionManager legacy `data/<userId>/` migration (#287)", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "bp-mig-"));
  });

  it("migrates only the known default data/local directory", async () => {
    await mkdir(join(root, "data", "local"), { recursive: true });
    await writeFile(join(root, "data", "local", "dataset.csv"), "cols\n1,2\n", "utf8");
    await mkdir(join(root, "data", "local", "subdir"), { recursive: true });
    await writeFile(join(root, "data", "local", "subdir", "notes.md"), "kept together", "utf8");

    const m = new SessionManager({ dataRoot: root, persist: false, agentFactory: mockAgentFactory });
    await m.ensurePersistentLayout();

    expect(await readFile(join(root, "data", "dataset.csv"), "utf8")).toBe("cols\n1,2\n");
    expect(await readFile(join(root, "data", "subdir", "notes.md"), "utf8")).toBe("kept together");
    await expect(readFile(join(root, "data", "local", "dataset.csv"), "utf8")).rejects.toThrow();
    const marker = JSON.parse(await readFile(join(root, PERSISTENT_LAYOUT_MARKER), "utf8"));
    expect(marker).toMatchObject({ version: 2, status: "ready", migratedFrom: "data/local" });
  });

  it("ignores Finder metadata beside the legacy directory", async () => {
    await mkdir(join(root, "data", "local"), { recursive: true });
    await writeFile(join(root, "data", "local", "dataset.csv"), "kept", "utf8");
    await writeFile(join(root, "data", ".DS_Store"), "finder metadata", "utf8");

    const m = new SessionManager({ dataRoot: root, persist: false, agentFactory: mockAgentFactory });
    await m.ensurePersistentLayout();

    expect(await readFile(join(root, "data", "dataset.csv"), "utf8")).toBe("kept");
    await expect(readFile(join(root, "data", ".DS_Store"), "utf8")).rejects.toThrow();
  });

  it("uses BP_USER_ID only as a legacy migration hint", async () => {
    await mkdir(join(root, "data", "alice"), { recursive: true });
    await writeFile(join(root, "data", "alice", "a.txt"), "alice", "utf8");
    const previous = process.env.BP_USER_ID;
    process.env.BP_USER_ID = "alice";
    try {
      const m = new SessionManager({ dataRoot: root, persist: false, agentFactory: mockAgentFactory });
      await m.ensurePersistentLayout();
      expect(await readFile(join(root, "data", "a.txt"), "utf8")).toBe("alice");
    } finally {
      if (previous === undefined) delete process.env.BP_USER_ID;
      else process.env.BP_USER_ID = previous;
    }
  });

  it("does not flatten a valid v2 tree containing only data/project/", async () => {
    await mkdir(join(root, "data", "project"), { recursive: true });
    await writeFile(join(root, "data", "project", "dataset.csv"), "kept", "utf8");

    const m1 = new SessionManager({ dataRoot: root, persist: false, agentFactory: mockAgentFactory });
    await m1.ensurePersistentLayout();
    const m2 = new SessionManager({ dataRoot: root, persist: false, agentFactory: mockAgentFactory });
    await m2.ensurePersistentLayout();

    expect(await readFile(join(root, "data", "project", "dataset.csv"), "utf8")).toBe("kept");
    await expect(readFile(join(root, "data", "dataset.csv"), "utf8")).rejects.toThrow();
  });

  it("refuses a mixed v1/v2 tree without moving either side", async () => {
    await mkdir(join(root, "data", "local"), { recursive: true });
    await writeFile(join(root, "data", "local", "old.txt"), "old", "utf8");
    await writeFile(join(root, "data", "new.txt"), "new", "utf8");

    const m = new SessionManager({ dataRoot: root, persist: false, agentFactory: mockAgentFactory });
    await expect(m.ensurePersistentLayout()).rejects.toThrow(/cannot migrate/);
    expect(await readFile(join(root, "data", "local", "old.txt"), "utf8")).toBe("old");
    expect(await readFile(join(root, "data", "new.txt"), "utf8")).toBe("new");
  });

  it("single-flights migration before concurrent /data writes with no session", async () => {
    await mkdir(join(root, "data", "local"), { recursive: true });
    await writeFile(join(root, "data", "local", "old.txt"), "old", "utf8");
    const m = new SessionManager({ dataRoot: root, persist: false, agentFactory: mockAgentFactory });

    await Promise.all([
      m.writeSessionFile("not-created", "/data/new.txt", Buffer.from("new").toString("base64")),
      m.writeSessionFile("not-created", "/data/other.txt", Buffer.from("other").toString("base64")),
    ]);

    expect(await readFile(join(root, "data", "old.txt"), "utf8")).toBe("old");
    expect(await readFile(join(root, "data", "new.txt"), "utf8")).toBe("new");
    expect(await readFile(join(root, "data", "other.txt"), "utf8")).toBe("other");
  });

  it("resumes a staged whole-directory migration after interruption", async () => {
    await mkdir(join(root, PERSISTENT_LAYOUT_STAGING), { recursive: true });
    await writeFile(join(root, PERSISTENT_LAYOUT_STAGING, "old.txt"), "old", "utf8");
    await mkdir(join(root, "data"), { recursive: true });
    await writeFile(
      join(root, PERSISTENT_LAYOUT_MARKER),
      JSON.stringify({
        version: 2,
        status: "migrating",
        phase: "staged",
        legacyUserId: "local",
        startedAt: new Date().toISOString(),
      }),
      "utf8",
    );

    const m = new SessionManager({ dataRoot: root, persist: false, agentFactory: mockAgentFactory });
    await m.ensurePersistentLayout();

    expect(await readFile(join(root, "data", "old.txt"), "utf8")).toBe("old");
    const marker = JSON.parse(await readFile(join(root, PERSISTENT_LAYOUT_MARKER), "utf8"));
    expect(marker).toMatchObject({ status: "ready", migratedFrom: "data/local" });
  });
});

describe("resolveSharedDir (#261)", () => {
  it("is undefined (feature off) when unset or blank", () => {
    expect(resolveSharedDir(undefined, {})).toBeUndefined();
    expect(resolveSharedDir("   ", {})).toBeUndefined();
    expect(resolveSharedDir(undefined, { BP_SHARED_DIR: "" })).toBeUndefined();
  });
  it("reads BP_SHARED_DIR from env when no explicit option", () => {
    expect(resolveSharedDir(undefined, { BP_SHARED_DIR: "/srv/shared" })).toBe("/srv/shared");
  });
  it("explicit option wins over env", () => {
    expect(resolveSharedDir("/opt/lib", { BP_SHARED_DIR: "/srv/shared" })).toBe("/opt/lib");
  });
});

describe("SessionManager cross-user shared root (#261)", () => {
  let root: string; // dataRoot (per-user)
  let shared: string; // cross-user shared dir, OUTSIDE dataRoot
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "bp-shroot-"));
    shared = await mkdtemp(join(tmpdir(), "bp-shared-"));
  });
  const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
  const mkMgr = () =>
    new SessionManager({
      dataRoot: root,
      sharedDir: shared,
      persist: false,
      agentFactory: mockAgentFactory,
    });

  it("reads a file from the shared root via the /shared prefix", async () => {
    await writeFile(join(shared, "atlas.csv"), "x,y,z");
    const m = mkMgr();
    const s = await m.createSession({ title: "S" });
    const read = await m.readSessionFile(s.id, "/shared/atlas.csv");
    expect(read.content).toBe("x,y,z");
  });

  it("is shared across sessions AND users (same bytes for any session)", async () => {
    await writeFile(join(shared, "ref.txt"), "public");
    const m = mkMgr();
    const a = await m.createSession({ title: "A" });
    const b = await m.createSession({ title: "B" });
    expect((await m.readSessionFile(a.id, "/shared/ref.txt")).content).toBe("public");
    expect((await m.readSessionFile(b.id, "/shared/ref.txt")).content).toBe("public");
  });

  it("lists the shared root via /shared", async () => {
    await writeFile(join(shared, "one.txt"), "1");
    await writeFile(join(shared, "two.txt"), "2");
    const m = mkMgr();
    const s = await m.createSession({ title: "S" });
    const names = (await m.listSessionFiles(s.id, "/shared")).map((e) => e.name).sort();
    expect(names).toEqual(["one.txt", "two.txt"]);
  });

  it("rejects writes to the shared root (read-only)", async () => {
    const m = mkMgr();
    const s = await m.createSession({ title: "S" });
    await expect(m.writeSessionFile(s.id, "/shared/nope.txt", b64("x"))).rejects.toThrow(
      /read-only/,
    );
  });

  it("rejects streamed writes to the shared root (read-only)", async () => {
    const m = mkMgr();
    const s = await m.createSession({ title: "S" });
    const { Readable } = await import("node:stream");
    await expect(
      m.writeSessionFileStream(s.id, "/shared/nope.txt", Readable.from([Buffer.from("x")])),
    ).rejects.toThrow(/read-only/);
  });

  it("rejects deletes in the shared root (read-only)", async () => {
    await writeFile(join(shared, "keep.txt"), "safe");
    const m = mkMgr();
    const s = await m.createSession({ title: "S" });
    await expect(m.deleteSessionFile(s.id, "/shared/keep.txt")).rejects.toThrow(/read-only/);
    // The file is untouched.
    expect(await readFile(join(shared, "keep.txt"), "utf8")).toBe("safe");
  });

  it("guards the shared boundary against traversal", async () => {
    const m = mkMgr();
    const s = await m.createSession({ title: "S" });
    await expect(m.readSessionFile(s.id, "/shared/../../etc/passwd")).rejects.toThrow(/escapes/);
  });

  it("does NOT recognize /shared when unconfigured (backward-compatible)", async () => {
    // No sharedDir → `/shared/...` falls through to the session workspace, so a
    // write is allowed and lands under workspaces/<sid>/shared/.
    const m = new SessionManager({ dataRoot: root, persist: false, agentFactory: mockAgentFactory });
    const s = await m.createSession({ title: "S" });
    const wrote = await m.writeSessionFile(s.id, "/shared/plain.txt", b64("ok"));
    // Emitted prefix-less (workspace path), NOT as /shared/...
    expect(wrote.path).toBe("shared/plain.txt");
    const onDisk = await readFile(join(root, "workspaces", s.id, "shared", "plain.txt"), "utf8");
    expect(onDisk).toBe("ok");
  });
});

describe("SessionManager memory watchdog (§R-4 / #20)", () => {
  it("is fully opt-out when no budget is set (identical to today)", async () => {
    const m = new SessionManager({ persist: false, agentFactory: mockAgentFactory });
    const s = await m.createSession({ title: "ok" });
    const res = await m.sendMessage(s.id, "hi");
    expect(res.accepted).toBe(true);
    const metrics = m.metrics();
    expect(metrics.memLimitBytes).toBeNull();
    expect(metrics.memRatio).toBeNull();
  });

  it("refuses new sessions when RSS is over the soft limit", async () => {
    // Budget 1000B, injected RSS 900B (>85%) => over the soft threshold.
    const m = new SessionManager({
      persist: false,
      agentFactory: mockAgentFactory,
      memLimitBytes: 1000,
      readRss: () => 900,
    });
    await expect(m.createSession({ title: "nope" })).rejects.toThrow(/memory budget/);
  });

  it("refuses messages over the soft limit and emits a warning system_message", async () => {
    let rss = 100; // start healthy so the session can be created
    const m = new SessionManager({
      persist: false,
      agentFactory: mockAgentFactory,
      memLimitBytes: 1000,
      readRss: () => rss,
    });
    const s = await m.createSession({ title: "tight" });
    const events: AgUiEvent[] = [];
    m.subscribe(s.id, (e) => events.push(e));

    rss = 900; // now over 85%
    const res = await m.sendMessage(s.id, "hello");
    expect(res.accepted).toBe(false);
    expect(events.some((e) => e.type === "system_message")).toBe(true);

    const metrics = m.metrics();
    expect(metrics.memLimitBytes).toBe(1000);
    expect(metrics.memRatio).toBeCloseTo(0.9);
  });
});
