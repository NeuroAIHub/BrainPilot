import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scaffold, isScaffolded } from "./scaffold.js";

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
    expect(await exists(join(paths.bpTemplateAgents, "principal", "prompt.md"))).toBe(true);
    expect(await exists(join(paths.bpTemplateAgents, "principal", "settings.json"))).toBe(true);
    expect(await exists(join(paths.bpTemplateAgents, "principal", "manifest.json"))).toBe(true);
    expect(await exists(paths.bpTemplateSettings)).toBe(true);
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

  it("scaffolds prompt.md + manifest.json for every built-in agent", async () => {
    const root = join(dir, "brainpilot");
    const { paths } = await scaffold(root);
    for (const name of ["principal", "librarian", "experimentalist", "engineer", "writer", "trace"]) {
      const agentDir = join(paths.bpTemplateAgents, name);
      expect(await exists(join(agentDir, "prompt.md")), `${name}/prompt.md`).toBe(true);
      expect(await exists(join(agentDir, "manifest.json")), `${name}/manifest.json`).toBe(true);
      const prompt = await readFile(join(agentDir, "prompt.md"), "utf8");
      expect(prompt, name).not.toContain("mcp__builtin__");
    }
  });

  it("engineer manifest grants write + bash; librarian does not", async () => {
    const { paths } = await scaffold(join(dir, "bp"));
    const eng = JSON.parse(
      await readFile(join(paths.bpTemplateAgents, "engineer", "manifest.json"), "utf8"),
    );
    expect(eng.role).toBe("expert");
    expect(eng.allowedTools).toEqual(expect.arrayContaining(["write", "bash", "send_message"]));
    const lib = JSON.parse(
      await readFile(join(paths.bpTemplateAgents, "librarian", "manifest.json"), "utf8"),
    );
    expect(lib.allowedTools).not.toContain("write");
    expect(lib.allowedTools).not.toContain("bash");
  });

  it("bakes the port into brainpilot.config.json", async () => {
    const { paths } = await scaffold(join(dir, "bp"), { port: 9100 });
    const cfg = JSON.parse(await readFile(paths.brainpilotConfig, "utf8"));
    expect(cfg.port).toBe(9100);
  });

  it("is idempotent and does not overwrite user edits", async () => {
    const root = join(dir, "bp");
    await scaffold(root);

    const promptPath = join(root, "bp_template", "agents", "principal", "prompt.md");
    await writeFile(promptPath, "USER EDITED", "utf8");

    const second = await scaffold(root);
    // Nothing new created on the second run.
    expect(second.created).toEqual([]);
    // User edit preserved.
    expect(await readFile(promptPath, "utf8")).toBe("USER EDITED");
  });

  it("isScaffolded is false before scaffolding", async () => {
    expect(await isScaffolded(join(dir, "nope"))).toBe(false);
  });

  it("uses the current default model id (claude-sonnet-4-6) in settings", async () => {
    const { paths } = await scaffold(join(dir, "bp"));
    const tmpl = JSON.parse(await readFile(paths.bpTemplateSettings, "utf8"));
    expect(tmpl.model).toBe("claude-sonnet-4-6");
    const principal = JSON.parse(
      await readFile(
        join(paths.bpTemplateAgents, "principal", "settings.json"),
        "utf8",
      ),
    );
    expect(principal.model).toBe("claude-sonnet-4-6");
  });
});
