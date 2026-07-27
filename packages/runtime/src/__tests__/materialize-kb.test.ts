import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultUserKbDir,
  materializeKb,
  resolveBundledKbDir,
} from "../materialize-kb.js";

async function freshHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), "bp-kb-home-"));
}

async function stageFakePkg(): Promise<string> {
  // Build a synthetic node_modules/@brainpilot/kb-scripts/kb layout so
  // isPackagedSource() accepts it. The scripts don't need to be real —
  // materializeKb only cares about `scripts/build_kb.py` existing.
  const nm = await mkdtemp(join(tmpdir(), "bp-kb-src-"));
  const kbDir = join(nm, "node_modules", "@brainpilot", "kb-scripts", "kb");
  await mkdir(join(kbDir, "scripts"), { recursive: true });
  await mkdir(join(kbDir, "server"), { recursive: true });
  await writeFile(join(kbDir, "scripts", "build_kb.py"), "# stub\n");
  await writeFile(join(kbDir, "scripts", "setup_env.py"), "# stub\n");
  await writeFile(join(kbDir, "server", "model_server.py"), "# stub\n");
  await writeFile(join(kbDir, "requirements.txt"), "FlagEmbedding>=1.2.10\n");
  return kbDir;
}

describe("resolveBundledKbDir", () => {
  it("resolves via the monorepo walk-up in dev (returns repo-root KnowledgeBase)", () => {
    const dir = resolveBundledKbDir();
    // Either phase-1 (require.resolve finds a real kb/ in node_modules,
    // populated by prepack) or phase-2 (repo-root walk-up sibling). In
    // vitest dev mode neither is guaranteed — but ONE of them succeeds
    // because this test file itself lives inside the repo checkout.
    expect(dir).toBeTruthy();
    expect(existsSync(join(dir!, "scripts", "build_kb.py"))).toBe(true);
  });
});

describe("defaultUserKbDir", () => {
  it("joins <home>/.brainpilot/KnowledgeBase", () => {
    expect(defaultUserKbDir("/x/y")).toBe("/x/y/.brainpilot/KnowledgeBase");
  });
});

describe("materializeKb — skip conditions", () => {
  it("BP_SKIP_KB_COPY=1 → reason=skip-env, no copy", async () => {
    const home = await freshHome();
    const res = await materializeKb({
      env: { BP_SKIP_KB_COPY: "1" },
      homeDir: home,
    });
    expect(res.reason).toBe("skip-env");
    expect(res.copied).toBe(0);
    expect(existsSync(res.dest)).toBe(false);
  });

  it("BP_KB_ROOT set → reason=env-override, no copy", async () => {
    const home = await freshHome();
    const res = await materializeKb({
      env: { BP_KB_ROOT: "/some/user/path" },
      homeDir: home,
    });
    expect(res.reason).toBe("env-override");
    expect(res.copied).toBe(0);
    expect(existsSync(res.dest)).toBe(false);
  });

  it("sibling KB (workspace dev) → reason=sibling-kb, no copy", async () => {
    // The default resolver walks up to the repo-root KnowledgeBase/ (or
    // resolves the workspace-linked kb-scripts pkg if `npm pack` was
    // ever run). Either way, the path does NOT contain
    // `node_modules/@brainpilot/kb-scripts`, so isPackagedSource returns
    // false and we get reason=sibling-kb without a copy — regardless of
    // whether packages/kb-scripts/kb/ happens to exist.
    const home = await freshHome();
    const res = await materializeKb({ env: {}, homeDir: home });
    expect(res.reason).toBe("sibling-kb");
    expect(res.source).not.toBeNull();
    expect(res.source!.includes(join("node_modules", "@brainpilot", "kb-scripts"))).toBe(false);
    expect(existsSync(res.dest)).toBe(false);
  });

  it("sourceOverride pointing at a non-packaged path → reason=sibling-kb", async () => {
    const home = await freshHome();
    // Any random dir that doesn't have `node_modules/@brainpilot/kb-scripts`
    // in its path.
    const bogus = await mkdtemp(join(tmpdir(), "bp-kb-bogus-"));
    const res = await materializeKb({
      env: {},
      homeDir: home,
      sourceOverride: bogus,
    });
    expect(res.reason).toBe("sibling-kb");
  });

  it("workspace-symlinked path ending in kb-scripts/kb is NOT accepted as packaged", async () => {
    // Regression test for the PR #379 review finding: previously
    // isPackagedSource accepted any path ending with "kb-scripts/kb",
    // which misfires in workspace dev after `npm pack` (require.resolve
    // resolves the symlink to the real path). Tightened classifier
    // requires the `node_modules/@brainpilot/kb-scripts` substring.
    const home = await freshHome();
    const fakeWorkspace = await mkdtemp(join(tmpdir(), "bp-kb-ws-"));
    const workspaceKb = join(fakeWorkspace, "packages", "kb-scripts", "kb");
    await mkdir(join(workspaceKb, "scripts"), { recursive: true });
    await writeFile(join(workspaceKb, "scripts", "build_kb.py"), "# stub\n");
    const res = await materializeKb({
      env: {},
      homeDir: home,
      sourceOverride: workspaceKb,
    });
    expect(res.reason).toBe("sibling-kb");
    expect(existsSync(res.dest)).toBe(false);
  });
});

describe("materializeKb — copy path", () => {
  it("copies from a packaged source into <home>/.brainpilot/KnowledgeBase idempotently", async () => {
    const home = await freshHome();
    const source = await stageFakePkg();

    // First run: populates the home from scratch.
    const first = await materializeKb({ env: {}, homeDir: home, sourceOverride: source });
    expect(first.reason).toBeUndefined();
    expect(first.source).toBe(source);
    expect(first.dest).toBe(join(home, ".brainpilot", "KnowledgeBase"));
    expect(first.copied).toBeGreaterThan(0);
    expect(first.skipped).toBe(0);
    expect(existsSync(join(first.dest, "scripts", "build_kb.py"))).toBe(true);
    expect(existsSync(join(first.dest, "server", "model_server.py"))).toBe(true);
    expect(existsSync(join(first.dest, "requirements.txt"))).toBe(true);

    // Second run: everything is already there → skipped == prior copied, no new copies.
    const second = await materializeKb({ env: {}, homeDir: home, sourceOverride: source });
    expect(second.copied).toBe(0);
    expect(second.skipped).toBe(first.copied);
  });

  it("preserves user edits under the destination", async () => {
    const home = await freshHome();
    const source = await stageFakePkg();
    await materializeKb({ env: {}, homeDir: home, sourceOverride: source });

    // User edits an installed script.
    const edited = join(home, ".brainpilot", "KnowledgeBase", "scripts", "build_kb.py");
    await writeFile(edited, "# USER EDIT\n");

    // Re-run: skip-if-exists preserves it.
    await materializeKb({ env: {}, homeDir: home, sourceOverride: source });
    expect(await readFile(edited, "utf8")).toBe("# USER EDIT\n");
  });
});
