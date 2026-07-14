/**
 * Integration test for the two-path skill-loading design:
 *
 *   - bp_template/skills/         → Pi-native `additionalSkillPaths` (always-on)
 *   - bp_template/skills-router/  → `skill_search` Pi-native custom tool
 *
 * After materialization, the always-on dir must contain ONLY the Meta-Skills
 * category, the router dir must contain every other shipped category, and the
 * SessionManager must hand each path to the right consumer (the agent factory's
 * `skillPaths` vs the `skill_search` tool's router base).
 */
import { describe, it, expect } from "vitest";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ALWAYS_ON_CATEGORY, materializeSkills } from "../materialize-skills.js";
import { SessionManager } from "../session-manager.js";
import { mockAgentFactory } from "../agent-factory.js";
import type { AgentSessionFactory } from "../types.js";

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "bp-two-paths-"));
}

describe("two-path skill loading", () => {
  it("materialize splits Meta-Skills into always-on and the rest into router", async () => {
    const root = await tmp();
    const res = await materializeSkills(root);

    const alwaysOnDirs = (await readdir(res.dest, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    const routerDirs = (await readdir(res.routerDest, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    expect(alwaysOnDirs).toEqual([ALWAYS_ON_CATEGORY]);
    expect(routerDirs).not.toContain(ALWAYS_ON_CATEGORY);
    expect(routerDirs.length).toBeGreaterThan(0);
  });

  it("SessionManager passes ONLY always-on to the factory's skillPaths", async () => {
    const root = await tmp();
    await materializeSkills(root); // populate both sides up-front

    let capturedSkillPaths: string[] | undefined;
    // Wrap the mock factory so we can observe what the manager handed to it.
    const wrappedFactory: AgentSessionFactory = async (params) => {
      capturedSkillPaths = params.skillPaths;
      return mockAgentFactory(params);
    };

    const mgr = new SessionManager({
      dataRoot: root,
      agentFactory: wrappedFactory,
      persist: false,
    });
    const session = await mgr.createSession({});
    await mgr.ensureAgent(session.id, "principal");

    // Always-on dir is the only entry; router is NOT in this list.
    expect(capturedSkillPaths).toEqual([join(root, "bp_template", "skills")]);
    expect(capturedSkillPaths).not.toContain(join(root, "bp_template", "skills-router"));
  });

  it("skill_search tool reads from the router dir, not the always-on dir", async () => {
    const root = await tmp();
    await materializeSkills(root);

    let capturedRouterDir: string | undefined;
    let toolNamesSeen: string[] | undefined;
    const wrappedFactory: AgentSessionFactory = async (params) => {
      toolNamesSeen = params.systemTools.map((t) => t.name);
      // The skill_search tool's execute closure captured the router dir;
      // invoke it with browse('') and confirm it lists router categories.
      const skillSearch = params.systemTools.find((t) => t.name === "skill_search");
      if (skillSearch) {
        const out = await skillSearch.execute({ mode: "browse", relative_path: "" });
        const payload = JSON.parse(out.content[0]!.text);
        // The router dir must NOT contain the Meta-Skills category — that one
        // lives only in the always-on dir.
        const names = payload.children.map((c: { name: string }) => c.name);
        expect(names).not.toContain(ALWAYS_ON_CATEGORY);
        expect(names.length).toBeGreaterThan(0);
        capturedRouterDir = root; // success signal
      }
      return mockAgentFactory(params);
    };

    const mgr = new SessionManager({
      dataRoot: root,
      agentFactory: wrappedFactory,
      persist: false,
    });
    const session = await mgr.createSession({});
    await mgr.ensureAgent(session.id, "librarian");

    expect(toolNamesSeen).toContain("skill_search");
    expect(capturedRouterDir).toBe(root);
  });

  it("trace agent does NOT receive skill_search (graph-only role)", async () => {
    const root = await tmp();
    await materializeSkills(root);

    let traceTools: string[] | undefined;
    const wrappedFactory: AgentSessionFactory = async (params) => {
      if (params.agentName === "trace") traceTools = params.systemTools.map((t) => t.name);
      return mockAgentFactory(params);
    };

    const mgr = new SessionManager({
      dataRoot: root,
      agentFactory: wrappedFactory,
      persist: false,
    });
    const session = await mgr.createSession({});
    await mgr.ensureAgent(session.id, "trace");

    expect(traceTools).toBeDefined();
    expect(traceTools).not.toContain("skill_search");
    // Trace also gets no skillPaths (it is skill-less by design).
  });

  it("keeps full and base sessions isolated without global mutation", async () => {
    const root = await tmp();
    type Captured = Parameters<AgentSessionFactory>[0];
    const captured = new Map<string, Captured>();
    const wrappedFactory: AgentSessionFactory = async (params) => {
      captured.set(params.sessionId, params);
      return mockAgentFactory(params);
    };
    const mgr = new SessionManager({
      dataRoot: root,
      agentFactory: wrappedFactory,
      persist: false,
      toolToggles: {},
    });
    const base = await mgr.createSession({ domainResources: "base" });
    const full = await mgr.createSession({ domainResources: "full" });
    await mgr.ensureAgent(base.id, "principal");
    await mgr.ensureAgent(full.id, "principal");

    const baseParams = captured.get(base.id)!;
    const fullParams = captured.get(full.id)!;
    for (const name of ["skill_search", "get_domain_knowledge_local", "search_papers_local"]) {
      expect(baseParams.systemTools.map((tool) => tool.name)).not.toContain(name);
      expect(fullParams.systemTools.map((tool) => tool.name)).toContain(name);
    }
    expect(baseParams.skillPaths).toBeUndefined();
    expect(fullParams.skillPaths).toEqual([join(root, "bp_template", "skills")]);
    expect(baseParams.systemPrompt).not.toMatch(/skill_search|<available_skills>|SKILL\.md/i);
    expect(fullParams.systemPrompt).toContain("skill_search");
    expect(baseParams.allowedToolNames).toEqual(expect.arrayContaining(["read", "write", "bash"]));
    expect(mgr.getSessionState(base.id)?.domainResources).toBe("base");
    expect(mgr.getSessionState(full.id)?.domainResources).toBe("full");
  });
});
