import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ALWAYS_ON_CATEGORY,
  materializeSkills,
  resolveBundledSkillsDir,
} from "../materialize-skills.js";

async function freshRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "bp-skills-"));
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

describe("resolveBundledSkillsDir", () => {
  it("resolves the bundled @brainpilot/skills skills/ dir", () => {
    const dir = resolveBundledSkillsDir();
    expect(dir).toBeTruthy();
    expect(dir!.replace(/\\/g, "/")).toMatch(/@brainpilot\/skills\/skills$|packages\/skills\/skills$/);
  });
});

describe("materializeSkills (split: always-on vs router)", () => {
  it("places Meta-Skills in always-on and every other category in the router", async () => {
    const root = await freshRoot();
    const res = await materializeSkills(root);

    expect(res.dest).toBe(join(root, "bp_template", "skills"));
    expect(res.routerDest).toBe(join(root, "bp_template", "skills-router"));
    expect(res.source).not.toBeNull();

    // Always-on side: must contain ONLY 01_Meta-Skills (the always-on category).
    const alwaysOnEntries = await readdir(res.dest, { withFileTypes: true });
    const alwaysOnDirs = alwaysOnEntries.filter((d) => d.isDirectory()).map((d) => d.name);
    expect(alwaysOnDirs).toEqual([ALWAYS_ON_CATEGORY]);

    // Router side: must contain at least one OTHER category and NOT 01_Meta-Skills.
    const routerEntries = await readdir(res.routerDest, { withFileTypes: true });
    const routerDirs = routerEntries.filter((d) => d.isDirectory()).map((d) => d.name);
    expect(routerDirs.length).toBeGreaterThan(0);
    expect(routerDirs).not.toContain(ALWAYS_ON_CATEGORY);

    // Counts must reflect the split (real bundle ships content on both sides).
    expect(res.copied).toBeGreaterThan(0);
    expect(res.routerCopied).toBeGreaterThan(0);

    const auditSkill = join(res.dest, ALWAYS_ON_CATEGORY, "audit-feedback-loop");
    expect(await exists(join(auditSkill, "SKILL.md"))).toBe(true);
    expect(await exists(join(auditSkill, "references", "pi-orchestration.md"))).toBe(true);
    expect(await exists(join(auditSkill, "references", "auditor-review.md"))).toBe(true);
    expect(await exists(join(auditSkill, "references", "audit-request-template.md"))).toBe(true);
    expect(await exists(join(auditSkill, "references", "audit-response-template.md"))).toBe(true);
    expect(await exists(join(auditSkill, "references", "revision-loop.md"))).toBe(true);
    expect(await readFile(join(auditSkill, "SKILL.md"), "utf8")).toContain("If you are `principal`");
    expect(await readFile(join(auditSkill, "references", "pi-orchestration.md"), "utf8"))
      .toContain("Raw Expert output is a valid intermediate target");
    expect(await readFile(join(auditSkill, "references", "auditor-review.md"), "utf8"))
      .toContain("return it with `complete_task`");

    // A representative router skill (one that does NOT live in 01_Meta-Skills)
    // should land under skills-router, not under skills.
    const sampleRouterCat = routerDirs[0]!;
    const sampleSkillName = (
      await readdir(join(res.routerDest, sampleRouterCat), { withFileTypes: true })
    ).find((d) => d.isDirectory())?.name;
    expect(sampleSkillName).toBeTruthy();
    expect(await exists(join(res.dest, sampleRouterCat, sampleSkillName!, "SKILL.md"))).toBe(false);
    expect(
      await exists(join(res.routerDest, sampleRouterCat, sampleSkillName!, "SKILL.md")),
    ).toBe(true);
  });

  it("is idempotent and preserves user edits on BOTH sides", async () => {
    const root = await freshRoot();

    // Pre-create one always-on file (a known meta-skill) with sentinel content.
    const alwaysOnSkill = join(root, "bp_template", "skills", ALWAYS_ON_CATEGORY, "verify-skill");
    await mkdir(alwaysOnSkill, { recursive: true });
    const alwaysOnGuarded = join(alwaysOnSkill, "SKILL.md");
    await writeFile(alwaysOnGuarded, "USER EDIT — META", "utf8");

    // Pre-create a router-side file under a category we know is shipped (drop in
    // via a pre-known relative path; a stable category that is NOT 01_Meta-Skills).
    const routerCustom = join(
      root,
      "bp_template",
      "skills-router",
      "99_user_added",
      "my-skill",
    );
    await mkdir(routerCustom, { recursive: true });
    await writeFile(join(routerCustom, "SKILL.md"), "USER ROUTER EDIT", "utf8");

    const res = await materializeSkills(root);

    expect(await readFile(alwaysOnGuarded, "utf8")).toBe("USER EDIT — META");
    expect(await readFile(join(routerCustom, "SKILL.md"), "utf8")).toBe("USER ROUTER EDIT");
    expect(res.skipped).toBeGreaterThan(0); // at least the guarded meta file

    // A second run copies nothing new on either side.
    const again = await materializeSkills(root);
    expect(again.copied).toBe(0);
    expect(again.routerCopied).toBe(0);

    // The user-added router category survives (nothing in the bundle clobbers it).
    expect(await exists(join(routerCustom, "SKILL.md"))).toBe(true);
  });

  it("creates BOTH destination dirs even when nothing is copied a second time", async () => {
    const root = await freshRoot();
    await materializeSkills(root); // first run populates
    const second = await materializeSkills(root); // nothing new
    expect(second.copied).toBe(0);
    expect(second.routerCopied).toBe(0);
    expect((await readdir(join(root, "bp_template", "skills"))).length).toBeGreaterThan(0);
    expect((await readdir(join(root, "bp_template", "skills-router"))).length).toBeGreaterThan(0);
  });
});
