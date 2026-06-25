import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, mkdir, writeFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PERSONAS } from "@brainpilot/runtime";
import {
  templateList,
  detectPromptDrift,
  runList,
  runDiff,
  runReset,
  agentPromptPath,
} from "./template.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "bp-tpl-"));
  // Ensure bp_template/agents/ exists so resolveDataDir() finds a real dir.
  await mkdir(join(dir, "bp_template", "agents"), { recursive: true });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writePrompt(name: string, body: string): Promise<void> {
  const path = agentPromptPath(dir, name);
  await mkdir(join(dir, "bp_template", "agents", name), { recursive: true });
  await writeFile(path, body, "utf8");
}

describe("templateList", () => {
  it("reports `no-local` for every agent in a fresh template dir", async () => {
    const rows = await templateList({ dir, env: {}, cwd: "/" });
    expect(rows.every((r) => r.state === "no-local")).toBe(true);
  });

  it("reports `in-sync` when the on-disk file matches the built-in (modulo trailing newline)", async () => {
    await writePrompt("principal", PERSONAS.principal!);
    const rows = await templateList({ dir, env: {}, cwd: "/" });
    expect(rows.find((r) => r.name === "principal")?.state).toBe("in-sync");
  });

  it("reports `drift` when the on-disk file diverges from the built-in", async () => {
    await writePrompt("librarian", "USER EDITED PROMPT\n");
    const rows = await templateList({ dir, env: {}, cwd: "/" });
    expect(rows.find((r) => r.name === "librarian")?.state).toBe("drift");
  });

  it("scoping to one agent returns just that agent's row", async () => {
    const rows = await templateList({ dir, env: {}, cwd: "/", agent: "principal" });
    expect(rows.map((r) => r.name)).toEqual(["principal"]);
  });
});

// #3 — cross-platform: Windows editors and `git autocrlf=true` save the
// on-disk `prompt.md` with CRLF, but `PERSONAS[name]` is shipped as an LF
// TypeScript string literal. Without the CRLF collapse, every line from the
// second onward differs by one `\r`, every agent reports `drift` on every
// Windows install, and `bp template diff` paints the whole file red/green.
describe("CRLF tolerance (#3)", () => {
  it("a CRLF-line-ended on-disk file matching the built-in is `in-sync`, not `drift`", async () => {
    const crlf = PERSONAS.principal!.replace(/\n/g, "\r\n");
    await writePrompt("principal", crlf);
    const rows = await templateList({ dir, env: {}, cwd: "/" });
    expect(rows.find((r) => r.name === "principal")?.state).toBe("in-sync");
  });

  it("`detectPromptDrift` reports a CRLF-converted file as no-drift", async () => {
    await writePrompt("principal", PERSONAS.principal!.replace(/\n/g, "\r\n"));
    await writePrompt("librarian", PERSONAS.librarian!.replace(/\n/g, "\r\n"));
    expect(await detectPromptDrift(dir)).toEqual([]);
  });

  it("`runDiff` produces no `+`/`-` rows for a CRLF copy of the built-in", async () => {
    await writePrompt("trace", PERSONAS.trace!.replace(/\n/g, "\r\n"));
    const out: string[] = [];
    await runDiff({ dir, env: {}, cwd: "/", agent: "trace", log: (m) => out.push(m) });
    // After the CRLF fold, the on-disk file should match the built-in, so the
    // command's "no drift" path is hit and no diff body is emitted.
    expect(out.join("\n")).toMatch(/no drift/);
  });
});

describe("detectPromptDrift", () => {
  it("returns only drifted agents", async () => {
    await writePrompt("principal", PERSONAS.principal!);
    await writePrompt("librarian", "EDITED\n");
    await writePrompt("auditor", "ALSO EDITED\n");
    const drift = await detectPromptDrift(dir);
    expect(drift.map((d) => d.name).sort()).toEqual(["auditor", "librarian"]);
  });

  it("returns empty when no overrides exist", async () => {
    expect(await detectPromptDrift(dir)).toEqual([]);
  });
});

describe("runList", () => {
  it("prints a row per agent + a drift summary when applicable", async () => {
    await writePrompt("writer", "edited\n");
    const out: string[] = [];
    await runList({ dir, env: {}, cwd: "/", log: (m) => out.push(m) });
    const joined = out.join("\n");
    expect(joined).toContain("AGENT");
    expect(joined).toContain("principal");
    expect(joined).toContain("writer");
    expect(joined).toMatch(/agent\(s\) in drift/);
  });
});

describe("runDiff", () => {
  it("prints unified-ish diff for drifted agents", async () => {
    await writePrompt("trace", "line one\nUSER LINE\nline three\n");
    const out: string[] = [];
    await runDiff({ dir, env: {}, cwd: "/", agent: "trace", log: (m) => out.push(m) });
    // Strip ANSI: picocolors emits colour codes on CI (TTY-detected) but not
    // when stdout is piped locally, so the diff markers can be wrapped in
    // `\x1b[31m…\x1b[39m`. Compare against the de-coloured text.
    // eslint-disable-next-line no-control-regex
    const plain = out.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
    expect(plain).toContain("trace");
    // At least one removed or added line marker should be present.
    expect(plain).toMatch(/[+-] /);
  });

  it("says 'no drift' when nothing diverges", async () => {
    await writePrompt("principal", PERSONAS.principal!);
    const out: string[] = [];
    await runDiff({ dir, env: {}, cwd: "/", agent: "principal", log: (m) => out.push(m) });
    expect(out.join("\n")).toMatch(/no drift/);
  });
});

describe("runReset", () => {
  it("writes the built-in prompt to disk and backs up the previous version", async () => {
    await writePrompt("engineer", "PREVIOUS USER EDIT\n");
    const result = await runReset({
      dir,
      env: {},
      cwd: "/",
      agent: "engineer",
      yes: true,
      log: () => {},
    });
    expect(result.written).toEqual(["engineer"]);
    expect(result.backupDir).toBeTruthy();
    // The new on-disk content equals the built-in.
    const after = await readFile(agentPromptPath(dir, "engineer"), "utf8");
    expect(after).toBe(PERSONAS.engineer);
    // A backup of the previous content exists.
    const backupFile = join(result.backupDir!, "agents", "engineer", "prompt.md");
    expect(await readFile(backupFile, "utf8")).toBe("PREVIOUS USER EDIT\n");
  });

  it("skips agents that are already in-sync", async () => {
    await writePrompt("writer", PERSONAS.writer!);
    const result = await runReset({
      dir,
      env: {},
      cwd: "/",
      agent: "writer",
      yes: true,
      log: () => {},
    });
    expect(result.written).toEqual([]);
    expect(result.skipped.find((s) => s.name === "writer")?.reason).toMatch(/in sync/);
  });

  it("resets every drifted agent when no --agent is given", async () => {
    await writePrompt("librarian", "edit-a\n");
    await writePrompt("auditor", "edit-b\n");
    const result = await runReset({
      dir,
      env: {},
      cwd: "/",
      yes: true,
      log: () => {},
    });
    expect(result.written.sort()).toEqual(["auditor", "librarian"]);
  });

  it("aborts without writing when confirm returns false (no --yes)", async () => {
    await writePrompt("librarian", "edit\n");
    const result = await runReset({
      dir,
      env: {},
      cwd: "/",
      agent: "librarian",
      log: () => {},
      confirm: async () => false,
    });
    expect(result.written).toEqual([]);
    // Disk file unchanged.
    expect(await readFile(agentPromptPath(dir, "librarian"), "utf8")).toBe("edit\n");
  });

  it("creates the prompt file even from no-local state (no backup made)", async () => {
    const result = await runReset({
      dir,
      env: {},
      cwd: "/",
      agent: "principal",
      yes: true,
      log: () => {},
    });
    expect(result.written).toEqual(["principal"]);
    expect(result.backupDir).toBeUndefined();
    expect(await readFile(agentPromptPath(dir, "principal"), "utf8")).toBe(
      PERSONAS.principal,
    );
  });

  it("returns 'Nothing to reset.' when nothing diverges and no-local agents excluded by name scope", async () => {
    await writePrompt("principal", PERSONAS.principal!);
    const out: string[] = [];
    const result = await runReset({
      dir,
      env: {},
      cwd: "/",
      agent: "principal",
      yes: true,
      log: (m) => out.push(m),
    });
    expect(result.written).toEqual([]);
    expect(out.join("\n")).toMatch(/Nothing to reset/);
  });
});

describe("program subcommand wiring", () => {
  it("dispatches `template list/diff/reset` to their handlers", async () => {
    const { run } = await import("../program.js");
    const calls: { who: string; opts: unknown }[] = [];
    const make = (who: string) => async (opts: unknown) => {
      calls.push({ who, opts });
      return undefined as never;
    };
    await run(["template", "list", "--dir", "/x"], {
      templateListFn: make("list") as never,
    });
    await run(["template", "diff", "principal", "--dir", "/x"], {
      templateDiffFn: make("diff") as never,
    });
    await run(["template", "reset", "librarian", "--dir", "/x", "--yes"], {
      templateResetFn: make("reset") as never,
    });
    expect(calls.map((c) => c.who)).toEqual(["list", "diff", "reset"]);
    expect(calls[1]!.opts).toMatchObject({ agent: "principal", dir: "/x" });
    expect(calls[2]!.opts).toMatchObject({ agent: "librarian", yes: true });
  });
});

// Silence an unused-import warning if vitest's tree-shake misses the read.
void stat;
void readdir;
