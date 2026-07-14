import { describe, expect, it } from "vitest";
import { DomainResourceUsageValueSchema } from "@brainpilot/protocol";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  domainResourceUsageOnStart,
  domainResourceUsageOnSuccess,
  toolTogglesForDomainResources,
  withoutDomainResourceInstructions,
  resolveDomainResources,
} from "../domain-resources.js";
import { PERSONAS, personaFor } from "../personas.js";
import { SessionManager } from "../session-manager.js";
import { mockAgentFactory } from "../agent-factory.js";

describe("per-session domain resources", () => {
  it("defaults only omission to full and rejects explicit bad values", () => {
    expect(resolveDomainResources(undefined)).toBe("full");
    expect(resolveDomainResources("base")).toBe("base");
    expect(() => resolveDomainResources("bsae")).toThrow(/invalid domainResources/);
  });
  it("base overrides only the copied effective toggles", () => {
    const global = { skill_search: true, get_domain_knowledge_local: true } as const;
    const base = toolTogglesForDomainResources("base", global);
    expect(base).toEqual({
      skill_search: false,
      get_domain_knowledge_local: false,
      search_papers_local: false,
    });
    expect(global).toEqual({ skill_search: true, get_domain_knowledge_local: true });
    expect(toolTogglesForDomainResources("full", global)).toBe(global);
  });

  it("removes unavailable-resource sections while preserving role instructions", () => {
    for (const persona of [...Object.values(PERSONAS), personaFor("statistician", "expert")]) {
      const base = withoutDomainResourceInstructions(persona);
      expect(base).not.toMatch(/skill_search|<available_skills>|SKILL\.md|Router skill library/i);
      expect(base.length).toBeGreaterThan(200);
    }
    expect(withoutDomainResourceInstructions(PERSONAS.principal!)).toContain("User authorization gate");
    expect(withoutDomainResourceInstructions(PERSONAS.engineer!)).toContain("Execution discipline");
  });

  it("classifies only the frozen, content-free usage edges", () => {
    const domain = domainResourceUsageOnStart("get_domain_knowledge_local", { query: "private" });
    expect(DomainResourceUsageValueSchema.parse(domain)).toEqual({
      schemaVersion: "1.0",
      kind: "domain_tool_call",
      toolName: "get_domain_knowledge_local",
      source: "system_tool",
    });
    expect(JSON.stringify(domain)).not.toContain("private");

    const search = domainResourceUsageOnStart("skill_search", {
      mode: "query",
      keywords: "private keywords",
    });
    expect(search).toMatchObject({ kind: "skill_search", source: "router" });
    expect(JSON.stringify(search)).not.toContain("private keywords");

    expect(domainResourceUsageOnSuccess("skill_search", {
      mode: "query",
      skill_name: "fmri-analysis",
    }, false, "full skill body")).toMatchObject({
      kind: "skill_load",
      skillName: "fmri-analysis",
      source: "router",
    });
    expect(domainResourceUsageOnSuccess("read", {
      path: "/skills/fmri-analysis/SKILL.md",
    }, false, "full skill body")).toMatchObject({
      kind: "skill_load",
      skillName: "fmri-analysis",
      source: "builtin_read",
    });
    expect(domainResourceUsageOnSuccess("read", {
      path: "/skills/fmri-analysis/SKILL.md",
      limit: 10,
    }, false)).toBeNull();
    expect(domainResourceUsageOnSuccess("read", {
      path: "/skills/fmri-analysis/SKILL.md",
    }, false, "[Showing lines 1-200 of 300]")).toBeNull();
    expect(domainResourceUsageOnSuccess("read", {
      path: "SKILL.md",
    }, false, "full body")).toMatchObject({ kind: "skill_load", skillName: "unknown" });
    expect(domainResourceUsageOnSuccess("skill_search", {
      mode: "query",
      skill_name: "fmri-analysis",
    }, true)).toBeNull();
  });

  it("persists and restores the frozen mode and rejects a conflicting reopen", async () => {
    const root = await mkdtemp(join(tmpdir(), "bp-domain-resources-"));
    try {
      const first = new SessionManager({ dataRoot: root, agentFactory: mockAgentFactory });
      const created = await first.createSession({ id: "base-session", domainResources: "base" });
      expect(created.domainResources).toBe("base");
      const meta = JSON.parse(await readFile(join(root, ".bp", created.id, "meta.json"), "utf8"));
      expect(meta.domainResources).toBe("base");

      const restored = new SessionManager({ dataRoot: root, agentFactory: mockAgentFactory });
      expect(await restored.restoreFromDisk()).toContain(created.id);
      expect(restored.getSession(created.id)?.domainResources).toBe("base");
      expect(restored.getSessionState(created.id)?.domainResources).toBe("base");
      await expect(restored.createSession({ id: created.id, domainResources: "full" })).rejects.toThrow(
        /already uses domainResources=base/,
      );
      await expect(first.createSession({
        id: "invalid",
        domainResources: "bsae" as never,
      })).rejects.toThrow(/invalid domainResources/);

      meta.domainResources = "bsae";
      await writeFile(
        join(root, ".bp", created.id, "meta.json"),
        `${JSON.stringify(meta)}\n`,
        "utf8",
      );
      const corrupted = new SessionManager({ dataRoot: root, agentFactory: mockAgentFactory });
      expect(await corrupted.restoreFromDisk()).not.toContain(created.id);
      expect(corrupted.getSession(created.id)).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
