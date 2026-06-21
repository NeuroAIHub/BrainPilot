import { describe, it, expect, beforeAll } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectAllSkills,
  countKeywordHits,
  parseFrontmatterDescription,
  searchSkills,
  createSkillSearchTool,
} from "../tools/skill-search.js";
import { Mailbox } from "../mailbox.js";
import { GraphOfTrace } from "../trace.js";
import type { ToolDeps } from "../tools/system-tools.js";

/**
 * Minimal, self-contained skill router base for the unit tests. Two
 * categories, one shared skill name across both, one Meta-style stub, and a
 * file with no description so the parser's empty-string path is exercised.
 */
async function makeFixtureBase(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "bp-skill-router-"));

  // 02_Cross-Domain/eeg-paradigm-designer
  const a = join(base, "02_Cross-Domain", "eeg-paradigm-designer");
  await mkdir(a, { recursive: true });
  await writeFile(
    join(a, "SKILL.md"),
    `---
name: eeg-paradigm-designer
description: "Design oddball, N400, P300 EEG paradigms with stimulus timing tables."
---

Body content for the EEG paradigm designer.`,
    "utf8",
  );
  await mkdir(join(a, "references"), { recursive: true });
  await writeFile(join(a, "references", "timings.md"), "timings ref", "utf8");

  // 05_EEG_ERP/eeg-paradigm-designer  → same name, second path
  const b = join(base, "05_EEG_ERP", "eeg-paradigm-designer");
  await mkdir(b, { recursive: true });
  await writeFile(
    join(b, "SKILL.md"),
    `---
description: SHADOW description should NOT replace the first one.
---
shadow body`,
    "utf8",
  );

  // 13_Visualization/figure-builder
  const c = join(base, "13_Visualization", "figure-builder");
  await mkdir(c, { recursive: true });
  await writeFile(
    join(c, "SKILL.md"),
    `---
description: 'Build publication-grade figures with matplotlib and seaborn.'
---

Visualization helper.`,
    "utf8",
  );

  // 99_misc/no-frontmatter — exercises the empty-description branch
  const d = join(base, "99_misc", "no-frontmatter");
  await mkdir(d, { recursive: true });
  await writeFile(join(d, "SKILL.md"), "no frontmatter at all", "utf8");

  return base;
}

describe("parseFrontmatterDescription", () => {
  it("reads double-quoted, single-quoted, and unquoted descriptions", () => {
    expect(parseFrontmatterDescription(`---\ndescription: "x y"\n---\nbody`)).toBe("x y");
    expect(parseFrontmatterDescription(`---\ndescription: 'x y'\n---\nbody`)).toBe("x y");
    expect(parseFrontmatterDescription(`---\ndescription: x y\n---\nbody`)).toBe("x y");
  });
  it("returns empty when frontmatter or description is absent", () => {
    expect(parseFrontmatterDescription("no frontmatter")).toBe("");
    expect(parseFrontmatterDescription(`---\nname: foo\n---\nbody`)).toBe("");
  });
});

describe("countKeywordHits", () => {
  it("counts case-insensitive substring occurrences across keywords", () => {
    expect(countKeywordHits("EEG paradigm and EEG timing", ["eeg"])).toBe(2);
    expect(countKeywordHits("EEG paradigm", ["eeg", "PARADIGM"])).toBe(2);
    expect(countKeywordHits("foo", ["bar"])).toBe(0);
    expect(countKeywordHits("foo", [""])).toBe(0); // empty keyword does not match
  });
});

describe("collectAllSkills", () => {
  let base: string;
  beforeAll(async () => {
    base = await makeFixtureBase();
  });

  it("walks <category>/<skill_name>/SKILL.md and dedupes by skill_name", async () => {
    const skills = await collectAllSkills(base);
    const names = skills.map((s) => s.name).sort();
    expect(names).toEqual(["eeg-paradigm-designer", "figure-builder", "no-frontmatter"]);

    const eeg = skills.find((s) => s.name === "eeg-paradigm-designer")!;
    // First-occurrence wins for description (shadow file does NOT overwrite).
    expect(eeg.description).toMatch(/oddball/i);
    // Both paths are recorded.
    expect(eeg.relative_paths).toHaveLength(2);
  });
});

describe("searchSkills — query mode", () => {
  let base: string;
  beforeAll(async () => {
    base = await makeFixtureBase();
  });

  it("ranks by keyword hits and returns the requested topk", async () => {
    const out = JSON.parse(
      await searchSkills(base, { mode: "query", keywords: ["EEG"], topk: 5 }),
    );
    expect(out.keywords).toEqual(["EEG"]);
    expect(out.results[0].name).toBe("eeg-paradigm-designer");
    expect(out.results[0].keyword_hits).toBeGreaterThan(0);
    // Other skills with no hits are still returned (lower rank), which is
    // fine — total_matched only counts hit>0 entries.
    expect(out.total_matched).toBe(1);
  });

  it("topk truncates the result list", async () => {
    const out = JSON.parse(
      await searchSkills(base, { mode: "query", keywords: ["x"], topk: 1 }),
    );
    expect(out.returned).toBe(1);
    expect(out.results).toHaveLength(1);
  });

  it("query with skill_name returns the FULL SKILL.md body", async () => {
    const text = await searchSkills(base, {
      mode: "query",
      skill_name: "figure-builder",
    });
    expect(text).toContain("Build publication-grade figures");
    expect(text).toContain("Visualization helper.");
  });

  it("query with unknown skill_name throws", async () => {
    await expect(
      searchSkills(base, { mode: "query", skill_name: "does-not-exist" }),
    ).rejects.toThrow(/not found in router/);
  });

  it("query mode requires keywords or skill_name", async () => {
    await expect(searchSkills(base, { mode: "query" })).rejects.toThrow(/keywords/);
  });
});

describe("searchSkills — browse mode", () => {
  let base: string;
  beforeAll(async () => {
    base = await makeFixtureBase();
  });

  it("lists top-level categories with relative_path='' and '.'", async () => {
    const out1 = JSON.parse(await searchSkills(base, { mode: "browse", relative_path: "" }));
    expect(out1.type).toBe("directory");
    expect(out1.children.map((c: { name: string }) => c.name).sort()).toEqual(
      ["02_Cross-Domain", "05_EEG_ERP", "13_Visualization", "99_misc"].sort(),
    );

    const out2 = JSON.parse(await searchSkills(base, { mode: "browse", relative_path: "." }));
    expect(out2.children.map((c: { name: string }) => c.name).sort()).toEqual(
      out1.children.map((c: { name: string }) => c.name).sort(),
    );
  });

  it("lists a sub-directory when given a category-relative path", async () => {
    const out = JSON.parse(
      await searchSkills(base, {
        mode: "browse",
        relative_path: "02_Cross-Domain/eeg-paradigm-designer",
      }),
    );
    const names = out.children.map((c: { name: string }) => c.name).sort();
    expect(names).toEqual(["SKILL.md", "references"].sort());
  });

  it("returns the file content when given a file path", async () => {
    const text = await searchSkills(base, {
      mode: "browse",
      relative_path: "13_Visualization/figure-builder/SKILL.md",
    });
    expect(text).toContain("publication-grade");
  });

  it("rejects path traversal via '../'", async () => {
    await expect(
      searchSkills(base, { mode: "browse", relative_path: "../etc/passwd" }),
    ).rejects.toThrow(/traversal/);
  });

  it("rejects absolute paths", async () => {
    await expect(
      searchSkills(base, { mode: "browse", relative_path: "/etc/passwd" }),
    ).rejects.toThrow(/traversal/);
  });

  it("throws on a missing path", async () => {
    await expect(
      searchSkills(base, { mode: "browse", relative_path: "nope/nada" }),
    ).rejects.toThrow(/does not exist/);
  });
});

describe("createSkillSearchTool", () => {
  it("returns a Pi-shaped SystemTool with mode/keywords/skill_name/relative_path", async () => {
    const base = await makeFixtureBase();
    const deps: ToolDeps = {
      sessionId: "s",
      fromAgent: "principal",
      mailbox: new Mailbox("s"),
      trace: new GraphOfTrace("s"),
      ensureAgent: async () => {},
      destroyAgent: async () => {},
      wakeAgent: () => {},
      requestUserInput: async () => "",
      routerSkillsDir: base,
    };
    const tool = createSkillSearchTool(deps);

    expect(tool.name).toBe("skill_search");
    expect(tool.parameters).toMatchObject({ type: "object" });
    const params = tool.parameters as { properties: Record<string, unknown>; required: string[] };
    expect(params.properties).toHaveProperty("mode");
    expect(params.properties).toHaveProperty("keywords");
    expect(params.properties).toHaveProperty("skill_name");
    expect(params.properties).toHaveProperty("relative_path");
    expect(params.required).toContain("mode");

    // Round-trip: invoking execute with {mode:'query', keywords:['EEG']} returns
    // the JSON payload the model sees.
    const out = await tool.execute({ mode: "query", keywords: ["EEG"] });
    const payload = JSON.parse(out.content[0]!.text);
    expect(payload.results[0].name).toBe("eeg-paradigm-designer");
  });

  it("propagates errors as thrown exceptions (no isError on AgentToolResult)", async () => {
    const base = await makeFixtureBase();
    const deps: ToolDeps = {
      sessionId: "s",
      fromAgent: "principal",
      mailbox: new Mailbox("s"),
      trace: new GraphOfTrace("s"),
      ensureAgent: async () => {},
      destroyAgent: async () => {},
      wakeAgent: () => {},
      requestUserInput: async () => "",
      routerSkillsDir: base,
    };
    const tool = createSkillSearchTool(deps);
    await expect(tool.execute({ mode: "query" })).rejects.toThrow(/keywords/);
  });
});
