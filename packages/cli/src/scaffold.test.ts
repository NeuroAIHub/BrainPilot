import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, stat, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scaffold, isScaffolded, shouldSkipSkillCopy } from "./scaffold.js";
import { EXAMPLE_MODEL } from "@brainpilot/protocol";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "bp-scaffold-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

describe("scaffold", () => {
  it("creates the expected directory tree + default files", async () => {
    const root = join(dir, "brainpilot");
    const { paths, created } = await scaffold(root);

    expect(await exists(paths.bpTemplate)).toBe(true);
    expect(await exists(paths.bpTemplateAgents)).toBe(true);
    expect(await exists(paths.bpTemplateSubagents)).toBe(true);
    expect(await exists(join(paths.bpTemplateSubagents, "repo-scout", "prompt.md"))).toBe(true);
    expect(await exists(join(paths.bpTemplateSubagents, "repo-scout", "profile.json"))).toBe(true);
    expect(await exists(join(paths.bpTemplateAgents, "README.md"))).toBe(true);
    expect(await exists(paths.bpTemplateProviders)).toBe(true);
    expect(await exists(paths.bpTemplateMcpServers)).toBe(true);
    expect(await exists(paths.bpTemplateSkills)).toBe(true);
    expect(await exists(join(paths.bpTemplateSkills, "README.md"))).toBe(true);
    expect(await exists(join(paths.bpTemplateSkills, "example.md"))).toBe(true);
    expect(await exists(paths.brainpilotConfig)).toBe(true);
    expect(await exists(paths.bp)).toBe(true);
    expect(await exists(paths.workspaces)).toBe(true);
    expect(await exists(paths.logsDir)).toBe(true);

    expect(created.length).toBeGreaterThan(0);
    expect(await isScaffolded(root)).toBe(true);
  });

  it("does NOT write per-agent prompt.md / manifest.json / settings.json (#102)", async () => {
    // The scaffold used to materialise these for every built-in agent, but the
    // writeIfAbsent guard meant prompt updates after `git pull` never reached
    // existing users. The runtime now falls back to the in-code PERSONAS when
    // no override file is present, so the dir starts empty by design.
    const { paths } = await scaffold(join(dir, "brainpilot"));
    for (const name of [
      "principal",
      "librarian",
      "experimentalist",
      "engineer",
      "writer",
      "auditor",
      "trace",
    ]) {
      const agentDir = join(paths.bpTemplateAgents, name);
      expect(await exists(agentDir), `${name} dir should not exist`).toBe(false);
    }
    // The only file under bp_template/agents/ is the README explaining why.
    const entries = await readdir(paths.bpTemplateAgents);
    expect(entries).toEqual(["README.md"]);
  });

  it("agents/README.md points users at `template reset` to materialise overrides", async () => {
    const { paths } = await scaffold(join(dir, "brainpilot"));
    const md = await readFile(join(paths.bpTemplateAgents, "README.md"), "utf8");
    expect(md).toContain("template reset");
    expect(md).toContain("agents/<name>/prompt.md");
  });

  it("preserves local subagent profile edits", async () => {
    const root = join(dir, "brainpilot");
    const { paths } = await scaffold(root);
    const prompt = join(paths.bpTemplateSubagents, "repo-scout", "prompt.md");
    await writeFile(prompt, "# Local repo scout", "utf8");
    await scaffold(root);
    expect(await readFile(prompt, "utf8")).toBe("# Local repo scout");
  });

  it("ships an empty mcp_servers.json ready for user config", async () => {
    const { paths } = await scaffold(join(dir, "brainpilot"));
    const mcp = JSON.parse(await readFile(paths.bpTemplateMcpServers, "utf8"));
    expect(mcp.mcpServers).toEqual({});
  });

  it("bakes the port into brainpilot.config.json", async () => {
    const { paths } = await scaffold(join(dir, "bp"), { port: 9100 });
    const cfg = JSON.parse(await readFile(paths.brainpilotConfig, "utf8"));
    expect(cfg.port).toBe(9100);
  });

  it("is idempotent and does not overwrite user edits", async () => {
    const root = join(dir, "bp");
    await scaffold(root);

    // mcp_servers.json IS scaffolded, so we use it (rather than prompt.md
    // which we now intentionally never scaffold) to prove user edits survive
    // a second `scaffold()` call.
    const target = join(root, "bp_template", "mcp_servers.json");
    await writeFile(target, '{"mcpServers":{"USER_EDIT":{}}}', "utf8");

    const second = await scaffold(root);
    expect(second.created).toEqual([]);
    expect(await readFile(target, "utf8")).toBe('{"mcpServers":{"USER_EDIT":{}}}');
  });

  it("isScaffolded is false before scaffolding", async () => {
    expect(await isScaffolded(join(dir, "nope"))).toBe(false);
  });

  it("provider registry starts empty (users fill via UI / init)", async () => {
    const { paths } = await scaffold(join(dir, "bp"));
    const providers = JSON.parse(await readFile(paths.bpTemplateProviders, "utf8"));
    expect(providers.profiles).toEqual([]);
  });

  it("#207 providers.example.json uses the shared EXAMPLE_MODEL constant", async () => {
    const { paths } = await scaffold(join(dir, "bp"));
    const example = JSON.parse(
      await readFile(join(paths.bpTemplate, "providers.example.json"), "utf8"),
    );
    expect(example.profiles[0].models).toEqual([EXAMPLE_MODEL]);
  });
});

// #284: the bundled-skill copy is the single most expensive thing scaffold does
// (hundreds of files, growing with the skill catalogue). It is gated so the CLI
// test suite doesn't pay it on every scaffold. These tests pin the gate.
//
// The gate's on-disk marker is the materialised category tree
// `bp_template/skills/<ALWAYS_ON_CATEGORY>/` — scaffold's own default writes only
// put README.md/example.md directly in `bp_template/skills/`, so a materialised
// category dir appears iff `materializeSkills` actually ran.
describe("shouldSkipSkillCopy (#284)", () => {
  it("reads BP_SKIP_SKILL_COPY (1/true on, anything else off)", () => {
    expect(shouldSkipSkillCopy({ BP_SKIP_SKILL_COPY: "1" })).toBe(true);
    expect(shouldSkipSkillCopy({ BP_SKIP_SKILL_COPY: "true" })).toBe(true);
    expect(shouldSkipSkillCopy({ BP_SKIP_SKILL_COPY: "0" })).toBe(false);
    expect(shouldSkipSkillCopy({ BP_SKIP_SKILL_COPY: "" })).toBe(false);
    expect(shouldSkipSkillCopy({})).toBe(false);
  });
});

describe("scaffold — skill copy gate (#284)", () => {
  // The materialised always-on category (01_Meta-Skills) — present only when
  // the recursive copy actually ran.
  const materialisedMarker = (root: string) =>
    join(root, "bp_template", "skills", "01_Meta-Skills");

  it("skips the bundled-skill copy when skipSkillCopy is set", async () => {
    const root = join(dir, "skip");
    const { created } = await scaffold(root, { skipSkillCopy: true });
    // The skeleton + default files are still written…
    expect(await exists(join(root, "bp_template", "skills", "README.md"))).toBe(true);
    expect(await isScaffolded(root)).toBe(true);
    // …but the heavy category copy did not run.
    expect(await exists(materialisedMarker(root))).toBe(false);
    expect(created.some((c) => c.includes("skill files"))).toBe(false);
  });

  it("still copies the bundled skills when the gate is off (skipSkillCopy: false)", async () => {
    const root = join(dir, "copy");
    // Explicit override so this test is independent of the suite-wide
    // BP_SKIP_SKILL_COPY set in vitest.setup.ts — it proves the copy path is a
    // real, reachable gate, not dead code.
    await scaffold(root, { skipSkillCopy: false });
    expect(await exists(materialisedMarker(root))).toBe(true);
  });
});
