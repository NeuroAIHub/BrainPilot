import { describe, it, expect, beforeAll } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectAllSkills,
  countKeywordHits,
  normalizeKeywords,
  parseFrontmatterDescription,
  searchSkills,
  createSkillSearchTool,
} from "../tools/skill-search.js";
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

describe("normalizeKeywords", () => {
  it("returns empty array for undefined / null-ish input", () => {
    expect(normalizeKeywords(undefined)).toEqual([]);
    expect(normalizeKeywords("")).toEqual([]);
  });

  it("splits a comma-separated string and trims each entry", () => {
    expect(normalizeKeywords("EEG, preprocessing, ICA")).toEqual([
      "EEG",
      "preprocessing",
      "ICA",
    ]);
  });

  it("drops empty entries from comma-separated string", () => {
    expect(normalizeKeywords("EEG,,, ICA, ")).toEqual(["EEG", "ICA"]);
  });

  it("handles a single keyword string with no commas", () => {
    expect(normalizeKeywords("fMRI")).toEqual(["fMRI"]);
  });

  // Defensive fallback: the JSON schema now advertises `keywords` as a plain
  // comma-separated string, but some models still emit arrays. The old code
  // took `["EEG, ICA"]` (single element wrapping the whole comma string) as
  // one 8-char keyword that matched nothing → total_matched=0. String(arr)
  // flattens to "EEG, ICA" and re-splits correctly, so we degrade gracefully.
  it("flattens an array via toString and re-splits on commas", () => {
    expect(normalizeKeywords(["EEG", "ICA"])).toEqual(["EEG", "ICA"]);
    expect(normalizeKeywords(["EEG, ICA"])).toEqual(["EEG", "ICA"]);
    expect(normalizeKeywords(["EEG, preprocessing", "ICA"])).toEqual([
      "EEG",
      "preprocessing",
      "ICA",
    ]);
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
      await searchSkills(base, { mode: "query", keywords: "EEG", topk: 5 }),
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
      await searchSkills(base, { mode: "query", keywords: "x", topk: 1 }),
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

  it("query with empty skill_name falls back to keyword search", async () => {
    const out = JSON.parse(
      await searchSkills(base, {
        mode: "query",
        keywords: "figure, plotting",
        skill_name: "",
      }),
    );
    expect(out.keywords).toEqual(["figure", "plotting"]);
    expect(out.results[0].name).toBe("figure-builder");
  });

  it("query with whitespace-only skill_name falls back to keyword search", async () => {
    const out = JSON.parse(
      await searchSkills(base, {
        mode: "query",
        keywords: "figure",
        skill_name: "   ",
      }),
    );
    expect(out.results[0].name).toBe("figure-builder");
  });

  it("trims skill_name before direct lookup", async () => {
    const text = await searchSkills(base, {
      mode: "query",
      skill_name: "  figure-builder  ",
    });
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

  it("accepts keywords as a comma-separated string (the canonical form)", async () => {
    const out = JSON.parse(
      await searchSkills(base, { mode: "query", keywords: "EEG, paradigm" }),
    );
    expect(out.keywords).toEqual(["EEG", "paradigm"]);
    expect(out.results[0].name).toBe("eeg-paradigm-designer");
    expect(out.results[0].keyword_hits).toBeGreaterThan(0);
  });

  it("comma string with empties and whitespace normalises correctly", async () => {
    const out = JSON.parse(
      await searchSkills(base, { mode: "query", keywords: " EEG ,, , paradigm " }),
    );
    expect(out.keywords).toEqual(["EEG", "paradigm"]);
    expect(out.total_matched).toBe(1);
  });

  it("single keyword string (no commas) works", async () => {
    const out = JSON.parse(
      await searchSkills(base, { mode: "query", keywords: "figure" }),
    );
    expect(out.keywords).toEqual(["figure"]);
    expect(out.results[0].name).toBe("figure-builder");
  });

  it("empty comma string throws (no valid keywords)", async () => {
    await expect(
      searchSkills(base, { mode: "query", keywords: " , , " }),
    ).rejects.toThrow(/keywords/);
  });

  // Regression: models sometimes ignore the string-only schema and send an
  // array (`["eeg, fmri"]` in particular — the whole comma string wrapped as
  // one element). The old array branch took that as a single 8-char keyword
  // and returned total_matched=0. We flatten via String(arr) and re-split.
  it("array input is flattened and comma-split so no silent zero-match", async () => {
    const out = JSON.parse(
      await searchSkills(base, {
        mode: "query",
        keywords: ["EEG, paradigm"],
      }),
    );
    expect(out.keywords).toEqual(["EEG", "paradigm"]);
    expect(out.total_matched).toBe(1);
    expect(out.results[0].name).toBe("eeg-paradigm-designer");
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

  // #2 — cross-platform: the previous guard hardcoded POSIX `/` so a Windows
  // absolute path like `C:\Windows\System32` or `\Windows` was let through to
  // the second-line containment guard, which still saved it but with a less
  // specific error. Reject them up-front instead.
  it("rejects Windows-style absolute paths (drive prefix and leading backslash) (#2)", async () => {
    await expect(
      searchSkills(base, { mode: "browse", relative_path: "C:\\Windows\\System32" }),
    ).rejects.toThrow(/traversal/);
    await expect(
      searchSkills(base, { mode: "browse", relative_path: "C:/Windows" }),
    ).rejects.toThrow(/traversal/);
    await expect(
      searchSkills(base, { mode: "browse", relative_path: "\\windows" }),
    ).rejects.toThrow(/traversal/);
  });

  // #2 — the original comment promised to reject `..` segments before the
  // resolve step, but the code never actually did; only the second-line
  // containment check caught them after the fact. Make the up-front guard
  // honest. Also covers backslash-separated `..` for Windows-shaped inputs.
  it("rejects any `..` segment up front, not just at the containment guard (#2)", async () => {
    await expect(
      searchSkills(base, { mode: "browse", relative_path: "foo/../bar" }),
    ).rejects.toThrow(/traversal/);
    await expect(
      searchSkills(base, { mode: "browse", relative_path: "foo\\..\\bar" }),
    ).rejects.toThrow(/traversal/);
  });

  it("throws on a missing path", async () => {
    await expect(
      searchSkills(base, { mode: "browse", relative_path: "nope/nada" }),
    ).rejects.toThrow(/does not exist/);
  });

  // #5 — paths handed back to the model must use POSIX separators so they
  // round-trip safely through JSON and URL query strings, and so the API
  // contract is identical on Windows and POSIX hosts.
  it("emits POSIX-style separators in browse `path` and search `relative_paths` (#5)", async () => {
    const out = JSON.parse(
      await searchSkills(base, {
        mode: "browse",
        relative_path: "02_Cross-Domain/eeg-paradigm-designer",
      }),
    );
    expect(out.path).toBe("02_Cross-Domain/eeg-paradigm-designer");
    expect(out.path).not.toMatch(/\\/);

    const query = JSON.parse(
      await searchSkills(base, { mode: "query", keywords: "EEG" }),
    );
    for (const r of query.results) {
      for (const p of r.relative_paths) {
        expect(p).not.toMatch(/\\/);
      }
    }
  });
});

describe("createSkillSearchTool", () => {
  it("returns a Pi-shaped SystemTool with mode/keywords/skill_name/relative_path", async () => {
    const base = await makeFixtureBase();
    const deps: ToolDeps = {
      sessionId: "s",
      fromAgent: "principal",
      trace: new GraphOfTrace("s"),
      dispatchTask: async () => { throw new Error("unused"); },
      completeTask: async () => { throw new Error("unused"); },
      dispatchTrace: async () => {},
      ensureAgent: async () => {},
      destroyAgent: async () => {},
      wakeAgent: () => {},
      requestUserInput: async () => "",
      routerSkillsDir: base,
    };
    const tool = createSkillSearchTool(deps);

    expect(tool.name).toBe("skill_search");
    expect(tool.parameters).toMatchObject({ type: "object" });
    const params = tool.parameters as {
      properties: Record<string, { type?: string }>;
      required: string[];
    };
    expect(params.properties).toHaveProperty("mode");
    expect(params.properties).toHaveProperty("keywords");
    expect(params.properties).toHaveProperty("skill_name");
    expect(params.properties).toHaveProperty("relative_path");
    expect(params.required).toContain("mode");
    // The schema now advertises `keywords` as a plain string (a
    // comma-separated list), not a union — the previous `oneOf` shape let
    // models pass `["eeg, fmri"]` which silently matched nothing.
    expect(params.properties.keywords!.type).toBe("string");

    // Round-trip: invoking execute with the canonical string shape returns
    // the JSON payload the model sees.
    const out = await tool.execute({ mode: "query", keywords: "EEG" });
    const payload = JSON.parse(out.content[0]!.text);
    expect(payload.results[0].name).toBe("eeg-paradigm-designer");
  });

  it("propagates errors as thrown exceptions (no isError on AgentToolResult)", async () => {
    const base = await makeFixtureBase();
    const deps: ToolDeps = {
      sessionId: "s",
      fromAgent: "principal",
      trace: new GraphOfTrace("s"),
      dispatchTask: async () => { throw new Error("unused"); },
      completeTask: async () => { throw new Error("unused"); },
      dispatchTrace: async () => {},
      ensureAgent: async () => {},
      destroyAgent: async () => {},
      wakeAgent: () => {},
      requestUserInput: async () => "",
      routerSkillsDir: base,
    };
    const tool = createSkillSearchTool(deps);
    await expect(tool.execute({ mode: "query" })).rejects.toThrow(/keywords/);
  });

  it("accepts comma-separated keyword string via execute()", async () => {
    const base = await makeFixtureBase();
    const deps: ToolDeps = {
      sessionId: "s",
      fromAgent: "principal",
      trace: new GraphOfTrace("s"),
      dispatchTask: async () => { throw new Error("unused"); },
      completeTask: async () => { throw new Error("unused"); },
      dispatchTrace: async () => {},
      ensureAgent: async () => {},
      destroyAgent: async () => {},
      wakeAgent: () => {},
      requestUserInput: async () => "",
      routerSkillsDir: base,
    };
    const tool = createSkillSearchTool(deps);
    const out = await tool.execute({ mode: "query", keywords: "EEG, paradigm" });
    const payload = JSON.parse(out.content[0]!.text);
    expect(payload.keywords).toEqual(["EEG", "paradigm"]);
    expect(payload.results[0].name).toBe("eeg-paradigm-designer");
  });
});
