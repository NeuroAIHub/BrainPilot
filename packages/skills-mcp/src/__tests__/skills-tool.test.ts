import { describe, it, expect } from "vitest";
import { parseFrontmatterDescription } from "../frontmatter.js";
import {
  skillsToolExecute,
  type SkillsToolArgs,
} from "../skills-tool.js";

describe("parseFrontmatterDescription", () => {
  it("extracts a double-quoted description", () => {
    const md = [
      "---",
      'description: "A guide for EEG preprocessing"',
      "---",
      "# Some content",
    ].join("\n");
    expect(parseFrontmatterDescription(md)).toBe("A guide for EEG preprocessing");
  });

  it("extracts a single-quoted description", () => {
    const md = [
      "---",
      "description: 'Analyze fMRI data with GLM'",
      "---",
      "# Content",
    ].join("\n");
    expect(parseFrontmatterDescription(md)).toBe("Analyze fMRI data with GLM");
  });

  it("extracts an unquoted description", () => {
    const md = [
      "---",
      "description: Basic statistical analysis guide",
      "---",
      "# Content",
    ].join("\n");
    expect(parseFrontmatterDescription(md)).toBe("Basic statistical analysis guide");
  });

  it("returns empty string when no frontmatter exists", () => {
    expect(parseFrontmatterDescription("# Just a heading\n\nSome text.")).toBe("");
  });

  it("returns empty string when description field is absent", () => {
    const md = [
      "---",
      "name: my-skill",
      "category: analysis",
      "---",
      "# Content",
    ].join("\n");
    expect(parseFrontmatterDescription(md)).toBe("");
  });
});

describe("skillsToolExecute", () => {
  it("rejects unknown mode", async () => {
    const res = await skillsToolExecute({ mode: "invalid" as any });
    expect(res.content[0]!.text).toContain("ERROR: Unknown mode");
  });

  it("query mode requires keywords or skill_name", async () => {
    const res = await skillsToolExecute({ mode: "query" });
    expect(res.content[0]!.text).toContain("ERROR");
    expect(res.content[0]!.text).toContain("must provide either");
  });

  it("query with empty keywords returns error", async () => {
    const res = await skillsToolExecute({
      mode: "query",
      keywords: [],
    } as unknown as SkillsToolArgs);
    expect(res.content[0]!.text).toContain("ERROR");
  });

  it("query by skill_name returns full SKILL.md text", async () => {
    const res = await skillsToolExecute({
      mode: "query",
      skill_name: "markdown-report-writing",
    });
    const text = res.content[0]!.text;
    expect(text).not.toContain("ERROR");
    // The skill's SKILL.md should mention markdown or writing
    expect(text.toLowerCase()).toMatch(/markdown|writing|report/);
    // It should have the frontmatter section
    expect(text).toContain("---");
  });

  it("query by nonexistent skill_name returns error", async () => {
    const res = await skillsToolExecute({
      mode: "query",
      skill_name: "nonexistent-skill-xyz",
    });
    expect(res.content[0]!.text).toContain("ERROR: Skill 'nonexistent-skill-xyz' not found");
  });

  it("keyword search finds relevant skills", async () => {
    const res = await skillsToolExecute({
      mode: "query",
      keywords: ["EEG", "preprocessing"],
      topk: 5,
    });
    const text = res.content[0]!.text;
    expect(text).not.toContain("ERROR");
    const parsed = JSON.parse(text);
    expect(parsed.keywords).toEqual(["EEG", "preprocessing"]);
    expect(parsed.total_matched).toBeGreaterThan(0);
    expect(parsed.returned).toBeGreaterThan(0);
    expect(parsed.results.length).toBeGreaterThan(0);
    // Each result has required fields
    for (const r of parsed.results) {
      expect(typeof r.name).toBe("string");
      expect(typeof r.description).toBe("string");
      expect(Array.isArray(r.relative_paths)).toBe(true);
      expect(typeof r.keyword_hits).toBe("number");
    }
    // At least one result should be EEG-related
    const names = parsed.results.map((r: any) => r.name);
    const hasEeg = names.some((n: string) =>
      n.toLowerCase().includes("eeg") || n.toLowerCase().includes("erp"),
    );
    expect(hasEeg).toBe(true);
  });

  it("keyword search with topk limits results", async () => {
    const res = await skillsToolExecute({
      mode: "query",
      keywords: ["analysis"],
      topk: 2,
    });
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.returned).toBeLessThanOrEqual(2);
  });

  it("browse root lists category folders", async () => {
    const res = await skillsToolExecute({
      mode: "browse",
      relative_path: "",
    });
    const text = res.content[0]!.text;
    expect(text).not.toContain("ERROR");
    const parsed = JSON.parse(text);
    expect(parsed.type).toBe("directory");
    expect(parsed.path).toBe(".");
    expect(parsed.children.length).toBeGreaterThan(0);
    // Should include known categories
    const names = parsed.children.map((c: any) => c.name);
    expect(names).toContain("14_Writing");
    expect(names).toContain("13_Visualization");
  });

  it("browse root with '.' works the same as ''", async () => {
    const res1 = await skillsToolExecute({ mode: "browse", relative_path: "" });
    const res2 = await skillsToolExecute({ mode: "browse", relative_path: "." });
    expect(res1.content[0]!.text).toBe(res2.content[0]!.text);
  });

  it("browse a skill folder lists its children", async () => {
    const res = await skillsToolExecute({
      mode: "browse",
      relative_path: "14_Writing/markdown-report-writing",
    });
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.type).toBe("directory");
    const names = parsed.children.map((c: any) => c.name);
    expect(names).toContain("SKILL.md");
    if (names.includes("references")) {
      const refs = parsed.children.find((c: any) => c.name === "references");
      expect(refs!.type).toBe("directory");
    }
  });

  it("browse a SKILL.md file returns its content", async () => {
    const res = await skillsToolExecute({
      mode: "browse",
      relative_path: "14_Writing/markdown-report-writing/SKILL.md",
    });
    const text = res.content[0]!.text;
    expect(text).toContain("---");
    expect(text.toLowerCase()).toMatch(/markdown|writing|report/);
  });

  it("browse a reference file returns its content", async () => {
    const res = await skillsToolExecute({
      mode: "browse",
      relative_path: "14_Writing/markdown-report-writing/references/templates.md",
    });
    expect(res.content[0]!.text).not.toContain("ERROR");
    expect(res.content[0]!.text.length).toBeGreaterThan(0);
  });

  it("prevents path traversal outside skills root", async () => {
    const res = await skillsToolExecute({
      mode: "browse",
      relative_path: "../../../etc/passwd",
    });
    expect(res.content[0]!.text).toContain("ERROR: Path traversal");
  });

  it("browse nonexistent path returns error", async () => {
    const res = await skillsToolExecute({
      mode: "browse",
      relative_path: "nonexistent/path/here",
    });
    expect(res.content[0]!.text).toContain("ERROR: Path does not exist");
  });
});