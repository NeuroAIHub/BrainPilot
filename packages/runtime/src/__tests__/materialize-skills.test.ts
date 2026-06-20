import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { materializeSkills, resolveBundledSkillsDir } from "../materialize-skills.js";

async function freshRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "bp-skills-"));
}

describe("resolveBundledSkillsDir", () => {
  it("resolves the bundled @brainpilot/skills skills/ dir", () => {
    const dir = resolveBundledSkillsDir();
    expect(dir).toBeTruthy();
    expect(dir!.replace(/\\/g, "/")).toMatch(/@brainpilot\/skills\/skills$|packages\/skills\/skills$/);
  });
});

describe("materializeSkills", () => {
  it("copies the bundled skills into <dataRoot>/bp_template/skills", async () => {
    const root = await freshRoot();
    const res = await materializeSkills(root);

    expect(res.dest).toBe(join(root, "bp_template", "skills"));
    expect(res.source).not.toBeNull();
    expect(res.copied).toBeGreaterThan(0);

    // At least one category dir with a SKILL.md landed.
    const cats = await readdir(res.dest, { withFileTypes: true });
    expect(cats.some((d) => d.isDirectory())).toBe(true);
  });

  it("is idempotent and never overwrites an existing file (skip-if-exists)", async () => {
    const root = await freshRoot();
    // Pre-create one destination file with sentinel content.
    const dest = join(root, "bp_template", "skills");
    const cat = join(dest, "01_Meta-Skills", "verify-skill");
    await mkdir(cat, { recursive: true });
    const guarded = join(cat, "SKILL.md");
    await writeFile(guarded, "USER EDIT — DO NOT TOUCH", "utf8");

    const res = await materializeSkills(root);

    // The pre-existing file must be preserved verbatim.
    expect(await readFile(guarded, "utf8")).toBe("USER EDIT — DO NOT TOUCH");
    expect(res.skipped).toBeGreaterThan(0);

    // A second run copies nothing new.
    const again = await materializeSkills(root);
    expect(again.copied).toBe(0);
  });

  it("creates the destination dir even when nothing is copied", async () => {
    const root = await freshRoot();
    await materializeSkills(root); // first run populates
    const second = await materializeSkills(root); // nothing new
    expect(second.copied).toBe(0);
    const entries = await readdir(join(root, "bp_template", "skills"));
    expect(entries.length).toBeGreaterThan(0);
  });
});
