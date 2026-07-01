import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, stat, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scaffold, isScaffolded } from "./scaffold.js";
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
