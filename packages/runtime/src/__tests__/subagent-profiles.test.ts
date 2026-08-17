import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { allowedSubagentProfiles, builtinSubagentProfiles, loadSubagentProfile } from "../subagent-profiles.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("subagent profile overrides", () => {
  it("ships the common research, code exploration, API, and review profiles", () => {
    const profiles = builtinSubagentProfiles();
    expect(profiles.map((profile) => profile.name).sort()).toEqual([
      "api-librarian", "code-reviewer", "code-runner", "evidence-extractor",
      "literature-scout", "method-reviewer", "repo-scout",
    ]);
    expect(profiles
      .filter((profile) => profile.allowedParents.includes("auditor"))
      .map((profile) => profile.name)
      .sort()).toEqual([
      "code-reviewer", "evidence-extractor", "method-reviewer", "repo-scout",
    ]);
    for (const name of ["literature-scout", "evidence-extractor", "api-librarian"]) {
      expect(profiles.find((profile) => profile.name === name)?.builtinTools).toEqual(
        expect.arrayContaining(["write", "edit"]),
      );
    }
    expect(profiles.find((profile) => profile.name === "code-reviewer")?.builtinTools)
      .toEqual(expect.arrayContaining(["write", "bash"]));
    expect(profiles.find((profile) => profile.name === "code-reviewer")?.prompt)
      .toContain("asymmetric dimensions and index-distinct values");
  });

  it("loads prompt and validated config overrides while stripping forbidden tools", async () => {
    const root = await mkdtemp(join(tmpdir(), "bp-subagent-profile-"));
    roots.push(root);
    const dir = join(root, "bp_template", "subagents", "code-runner");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "prompt.md"), "# Custom child", "utf8");
    await writeFile(join(dir, "profile.json"), JSON.stringify({
      version: 1,
      allowedParents: ["engineer"],
      builtinTools: ["read", "bash", "spawn_subagent"],
      systemTools: ["skill_search", "send_message"],
      modelId: "small-model",
      timeoutMs: 1234,
    }), "utf8");
    const profile = await loadSubagentProfile(root, "code-runner");
    expect(profile).toMatchObject({ prompt: "# Custom child", modelId: "small-model", timeoutMs: 1234 });
    expect(profile?.builtinTools).toEqual(["read", "bash"]);
    expect(profile?.systemTools).toEqual(["skill_search"]);
  });

  it("rejects malformed versioned config instead of silently widening permissions", async () => {
    const root = await mkdtemp(join(tmpdir(), "bp-subagent-profile-"));
    roots.push(root);
    const dir = join(root, "bp_template", "subagents", "literature-scout");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "profile.json"), JSON.stringify({ version: 2, surprise: true }), "utf8");
    await expect(loadSubagentProfile(root, "literature-scout")).rejects.toThrow("invalid subagent profile");
  });

  it("discovers a complete deployment-defined profile and filters it by parent", async () => {
    const root = await mkdtemp(join(tmpdir(), "bp-subagent-profile-"));
    roots.push(root);
    const dir = join(root, "bp_template", "subagents", "citation-checker");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "prompt.md"), "Verify every citation, then submit the result.", "utf8");
    await writeFile(join(dir, "profile.json"), JSON.stringify({
      version: 1,
      description: "Checks citations",
      allowedParents: ["librarian", "auditor"],
      builtinTools: ["read", "grep"],
      systemTools: ["search_papers_local"],
      mcp: false,
    }), "utf8");
    await expect(loadSubagentProfile(root, "citation-checker")).resolves.toMatchObject({
      name: "citation-checker", allowedParents: ["librarian", "auditor"], builtinTools: ["read", "grep"],
    });
    expect((await allowedSubagentProfiles(root, "librarian")).map((profile) => profile.name)).toContain("citation-checker");
    expect((await allowedSubagentProfiles(root, "engineer")).map((profile) => profile.name)).not.toContain("citation-checker");
  });

  it("rejects incomplete custom profiles and unsafe names", async () => {
    const root = await mkdtemp(join(tmpdir(), "bp-subagent-profile-"));
    roots.push(root);
    const dir = join(root, "bp_template", "subagents", "unsafe-worker");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "prompt.md"), "unsafe", "utf8");
    await writeFile(join(dir, "profile.json"), JSON.stringify({ version: 1, description: "unsafe", allowedParents: ["principal"] }), "utf8");
    await expect(loadSubagentProfile(root, "unsafe-worker")).rejects.toThrow("invalid subagent profile");
    await expect(loadSubagentProfile(root, "../escape")).rejects.toThrow("invalid subagent profile name");
  });
});
