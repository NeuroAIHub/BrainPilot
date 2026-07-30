/**
 * Regression: `tool_toggles.json` is read on every `ensureAgent`, so a flip
 * via `PUT /api/tool-toggles` takes effect on the next new session (or the
 * next expert spawn) WITHOUT a runtime restart.
 *
 * Old behavior: `SessionManager` cached the toggles for the process lifetime
 * — the first `ensureAgent` seeded the cache with whatever the disk had
 * at that instant, and all subsequent sessions saw the same stale value.
 * A user who opened Settings AFTER the first session had already started
 * saw their toggle change ignored forever.
 *
 * New behavior tested here: toggle disk file, create a new session, expect
 * the new session's principal to receive an agentFactory call whose
 * `allowedToolNames` reflects the current disk state — not whatever was
 * on disk at first-manager-use.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "../session-manager.js";
import { MockAgentSession } from "../mock-agent.js";
import type { AgentSessionFactory } from "../types.js";

// Persist writes are fire-and-forget; on afterEach an ENOTEMPTY can race the
// still-in-flight bus/task-ledger flush. Give the writes a beat to settle, then
// retry rm a few times before giving up.
async function rmRetry(path: string): Promise<void> {
  for (let i = 0; i < 5; i++) {
    try {
      await rm(path, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  await rm(path, { recursive: true, force: true });
}

/** Flush every persisted write and stop background tasks. */
async function finish(m: SessionManager): Promise<void> {
  m.shutdown();
  await m.emergencySaveAll();
}

/**
 * A spying factory that records every `allowedToolNames` list it saw, then
 * defers to the real MockAgentSession so the rest of the SessionManager
 * pipeline (session_state, task ledger, etc.) behaves normally.
 */
function makeSpyingFactory(): {
  factory: AgentSessionFactory;
  callsFor: (agentName: string) => string[][];
} {
  const calls: Array<{ agentName: string; allowedToolNames: string[] }> = [];
  const factory: AgentSessionFactory = async (params) => {
    calls.push({
      agentName: params.agentName,
      allowedToolNames: [...params.allowedToolNames],
    });
    return new MockAgentSession({
      sessionId: params.sessionId,
      agentName: params.agentName,
      systemTools: params.systemTools,
    });
  };
  return {
    factory,
    callsFor: (agentName) =>
      calls.filter((c) => c.agentName === agentName).map((c) => c.allowedToolNames),
  };
}

async function writeToggles(dataRoot: string, patch: Record<string, boolean>): Promise<void> {
  const dir = join(dataRoot, "bp_template");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "tool_toggles.json"), JSON.stringify(patch), "utf8");
}

describe("tool_toggles hot-read on ensureAgent", () => {
  let dataRoot: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), "bp-toggles-hot-"));
  });
  afterEach(async () => {
    await rmRetry(dataRoot);
  });

  it("picks up a mid-run flip on the NEXT createSession (no restart)", async () => {
    // First session: tool_toggles.json does not exist → skill_search enabled
    // (default-on). The manager reads disk on this ensureAgent and gets null.
    const spy = makeSpyingFactory();
    const m = new SessionManager({ dataRoot, agentFactory: spy.factory });

    const s1 = await m.createSession();
    // Trigger principal creation (createSession returns before ensureAgent
    // fires; sendMessage forces it).
    await m.sendMessage(s1.id, "hi");

    const firstPrincipal = spy.callsFor("principal")[0];
    expect(firstPrincipal).toBeDefined();
    expect(firstPrincipal).toContain("skill_search");

    // The user flips the toggle in Settings after session 1 has already run.
    // Under the old (cached) behavior, this write would be silently ignored
    // for the lifetime of the process.
    await writeToggles(dataRoot, {
      skill_search: false,
      get_domain_knowledge_local: false,
      search_papers_local: false,
    });

    // New session — must observe the flip.
    const s2 = await m.createSession();
    await m.sendMessage(s2.id, "hi");

    const secondPrincipal = spy.callsFor("principal")[1];
    expect(secondPrincipal).toBeDefined();
    expect(secondPrincipal).not.toContain("skill_search");
    expect(secondPrincipal).not.toContain("get_domain_knowledge_local");
    expect(secondPrincipal).not.toContain("search_papers_local");

    // Comms / orchestration primitives stay put — the toggles must not
    // affect always-on tools.
    expect(secondPrincipal).toContain("dispatch_task");
    expect(secondPrincipal).toContain("complete_task");
    expect(secondPrincipal).toContain("create_agent");

    await finish(m);
  });

  it("picks up removal of the toggle file (back to default-on)", async () => {
    // Seed with everything OFF, then delete the file mid-run and confirm
    // that "no file → default-on" is re-evaluated on the next session.
    await writeToggles(dataRoot, {
      skill_search: false,
      get_domain_knowledge_local: false,
      search_papers_local: false,
    });

    const spy = makeSpyingFactory();
    const m = new SessionManager({ dataRoot, agentFactory: spy.factory });

    const s1 = await m.createSession();
    await m.sendMessage(s1.id, "hi");
    expect(spy.callsFor("principal")[0]).not.toContain("skill_search");

    await unlink(join(dataRoot, "bp_template", "tool_toggles.json"));

    const s2 = await m.createSession();
    await m.sendMessage(s2.id, "hi");
    expect(spy.callsFor("principal")[1]).toContain("skill_search");

    await finish(m);
  });

  it("explicit constructor injection still bypasses disk (test override wins)", async () => {
    // If a test wires `opts.toolToggles`, the manager must NEVER read disk —
    // even if a stale tool_toggles.json exists alongside. This keeps tests
    // hermetic when the tmp dataRoot happens to contain a fixture.
    await writeToggles(dataRoot, { skill_search: true });

    const spy = makeSpyingFactory();
    const m = new SessionManager({
      dataRoot,
      agentFactory: spy.factory,
      toolToggles: { skill_search: false }, // injection wins
    });

    const s = await m.createSession();
    await m.sendMessage(s.id, "hi");

    expect(spy.callsFor("principal")[0]).not.toContain("skill_search");

    await finish(m);
  });
});
