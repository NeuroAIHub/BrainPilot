/**
 * commands/template.ts — `bp template list|diff|reset` for managing per-agent
 * prompt overrides under `bp_template/agents/<name>/prompt.md`.
 *
 * The runtime's `loadPersona` prefers the on-disk override and falls back to
 * the in-code PERSONAS registry. After #102 the scaffold no longer writes
 * prompt.md by default, so users only end up with overrides if they explicitly
 * materialise one — and these subcommands are the supported way to do that
 * and to keep an existing override in sync with upstream prompt updates.
 *
 *   list   — show each built-in agent's drift state (no-local / in-sync / drift)
 *   diff   — print a unified diff between the on-disk override and the built-in
 *   reset  — write the built-in prompt to disk, backing up any existing override
 *
 * `detectPromptDrift(dataDir)` is also exported so `commands/up.ts` can flash
 * a non-blocking banner at launch when stale overrides are detected.
 */
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { constants as FS } from "node:fs";
import { createInterface } from "node:readline/promises";
import { join, dirname } from "node:path";
import pc from "picocolors";
import { BUILTIN_PERSONA_NAMES, PERSONAS } from "@brainpilot/runtime";
import { resolveDataDir, dataPaths } from "../paths.js";

export type DriftState = "no-local" | "in-sync" | "drift";

export interface AgentStatus {
  name: string;
  state: DriftState;
  /** Absolute path to the on-disk override (always populated, even if absent). */
  path: string;
}

export interface CommonOptions {
  dir?: string;
  env?: Record<string, string | undefined>;
  cwd?: string;
  log?: (msg: string) => void;
  /** Test hook so we don't actually read stdin. */
  confirm?: (prompt: string) => Promise<boolean>;
}

/** Path to an agent's on-disk persona override (the runtime's load contract). */
export function agentPromptPath(dataDir: string, name: string): string {
  return join(dataDir, "bp_template", "agents", name, "prompt.md");
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p, FS.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readOrNull(p: string): Promise<string | null> {
  try {
    return await readFile(p, "utf8");
  } catch {
    return null;
  }
}

/** Normalize for byte-level comparison so an EOL-only or line-ending-only
 *  divergence doesn't show as `drift`. Cross-platform (#3): Windows editors
 *  and git's `autocrlf=true` save `prompt.md` with CRLF, but the built-in
 *  persona strings ship as LF — without the CRLF collapse, every line from
 *  the second onward differs by one `\r`, so every agent reports `drift` on
 *  every Windows install and `bp template diff` paints the whole file
 *  red/green. We fold CRLF → LF first, then strip a single trailing
 *  newline. */
function normalize(s: string): string {
  const lf = s.replace(/\r\n/g, "\n");
  return lf.endsWith("\n") ? lf.slice(0, -1) : lf;
}

/** Compute drift status for every built-in agent (or just one). */
export async function templateList(
  options: CommonOptions & { agent?: string } = {},
): Promise<AgentStatus[]> {
  const dataDir = resolveDataDir({
    dir: options.dir,
    env: options.env,
    cwd: options.cwd,
  });
  const names = options.agent ? [options.agent] : BUILTIN_PERSONA_NAMES;
  const out: AgentStatus[] = [];
  for (const name of names) {
    const path = agentPromptPath(dataDir, name);
    const disk = await readOrNull(path);
    const builtin = PERSONAS[name];
    if (!builtin) {
      // Unknown agent name (e.g. user passed `template list someExpert` for a
      // runtime-created expert). Report it as `no-local` so the user sees the
      // tool didn't crash, and the path so they can dump one if they want.
      out.push({ name, state: "no-local", path });
      continue;
    }
    if (disk === null) {
      out.push({ name, state: "no-local", path });
    } else if (normalize(disk) === normalize(builtin)) {
      out.push({ name, state: "in-sync", path });
    } else {
      out.push({ name, state: "drift", path });
    }
  }
  return out;
}

/** Subset of `templateList` used by `up`'s banner — only agents in drift. */
export async function detectPromptDrift(
  dataDir: string,
): Promise<AgentStatus[]> {
  const all = await templateList({ dir: dataDir, env: {}, cwd: "/" });
  return all.filter((s) => s.state === "drift");
}

/* ------------------------------ list command ------------------------------ */

const STATE_LABEL: Record<DriftState, string> = {
  "no-local": pc.dim("no-local"),
  "in-sync": pc.green("in-sync"),
  drift: pc.yellow("drift"),
};
const STATE_NOTE: Record<DriftState, string> = {
  "no-local": "no override (using built-in)",
  "in-sync": "matches built-in",
  drift: "local prompt differs from built-in",
};

export async function runList(options: CommonOptions = {}): Promise<void> {
  const log = options.log ?? ((m: string) => console.log(m));
  const rows = await templateList(options);
  log(pc.bold("AGENT             STATUS      NOTE"));
  for (const r of rows) {
    const name = r.name.padEnd(17, " ");
    const state = STATE_LABEL[r.state].padEnd(20, " "); // colour codes add width
    log(`${name} ${state} ${STATE_NOTE[r.state]}`);
  }
  const drifted = rows.filter((r) => r.state === "drift");
  if (drifted.length > 0) {
    log("");
    log(
      pc.yellow(
        `${drifted.length} agent(s) in drift — \`bp template diff [<agent>]\` to inspect, \`bp template reset [<agent>]\` to overwrite.`,
      ),
    );
  }
}

/* ------------------------------ diff command ------------------------------ */

/**
 * Tiny line-level unified diff. Not designed to match `diff -u` byte-for-byte;
 * it just needs to make divergences scannable. We deliberately avoid pulling
 * in a `diff` dependency for what is effectively a debug helper.
 */
function unifiedDiff(a: string, b: string, label: string): string {
  // Cross-platform (#3): the diff is computed line-by-line on `\n` splits,
  // so a CRLF disk file vs an LF built-in would otherwise compare every line
  // as "different by one `\r`" and paint the entire output. Fold first.
  const aLines = a.replace(/\r\n/g, "\n").split("\n");
  const bLines = b.replace(/\r\n/g, "\n").split("\n");
  const lines: string[] = [];
  lines.push(pc.bold(`--- ${label} (built-in)`));
  lines.push(pc.bold(`+++ ${label} (on-disk)`));
  // Longest common subsequence is overkill for prompt diffs that usually
  // touch a handful of lines. Use a per-line sweep: identical lines pass,
  // divergent runs are emitted as `-old` then `+new` blocks.
  let i = 0;
  let j = 0;
  while (i < aLines.length || j < bLines.length) {
    if (i < aLines.length && j < bLines.length && aLines[i] === bLines[j]) {
      lines.push("  " + aLines[i]);
      i++;
      j++;
      continue;
    }
    // Find next sync point: matching pair within a small window so we don't
    // emit the entire rest of both files when one line diverges.
    let synced = false;
    const window = 32;
    outer: for (let di = 0; di < window && i + di < aLines.length; di++) {
      for (let dj = 0; dj < window && j + dj < bLines.length; dj++) {
        if (aLines[i + di] === bLines[j + dj] && aLines[i + di] !== "") {
          for (let k = 0; k < di; k++) lines.push(pc.red("- " + aLines[i + k]));
          for (let k = 0; k < dj; k++) lines.push(pc.green("+ " + bLines[j + k]));
          i += di;
          j += dj;
          synced = true;
          break outer;
        }
      }
    }
    if (!synced) {
      if (i < aLines.length) lines.push(pc.red("- " + aLines[i++]));
      if (j < bLines.length) lines.push(pc.green("+ " + bLines[j++]));
    }
  }
  return lines.join("\n");
}

export async function runDiff(
  options: CommonOptions & { agent?: string } = {},
): Promise<void> {
  const log = options.log ?? ((m: string) => console.log(m));
  const rows = await templateList({ ...options, agent: options.agent });
  let printed = 0;
  for (const r of rows) {
    if (r.state !== "drift") continue;
    const disk = (await readOrNull(r.path)) ?? "";
    const builtin = PERSONAS[r.name] ?? "";
    log("");
    log(pc.bold(pc.cyan(`■ ${r.name}`)));
    log(unifiedDiff(builtin, disk, r.name));
    printed++;
  }
  if (printed === 0) {
    if (options.agent) {
      log(
        `${options.agent}: no drift (state: ${
          rows.find((r) => r.name === options.agent)?.state ?? "unknown"
        }).`,
      );
    } else {
      log("No agents in drift.");
    }
  }
}

/* ----------------------------- reset command ----------------------------- */

export interface ResetResult {
  /** Agents whose prompt.md was (over)written from the built-in. */
  written: string[];
  /** Backup directory created (only when at least one existing file was replaced). */
  backupDir?: string;
  /** Agents skipped (e.g. already in-sync, or user declined). */
  skipped: { name: string; reason: string }[];
}

/** ISO-ish timestamp safe for use in a directory name. */
function timestampDir(): string {
  // Mock-friendly time source so tests don't have to freeze Date.
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

async function defaultConfirm(prompt: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const ans = (await rl.question(prompt)).trim().toLowerCase();
    return ans === "y" || ans === "yes";
  } finally {
    rl.close();
  }
}

export async function runReset(
  options: CommonOptions & { agent?: string; yes?: boolean } = {},
): Promise<ResetResult> {
  const log = options.log ?? ((m: string) => console.log(m));
  const dataDir = resolveDataDir({
    dir: options.dir,
    env: options.env,
    cwd: options.cwd,
  });
  const paths = dataPaths(dataDir);
  const rows = await templateList({ ...options, agent: options.agent });

  // Semantics:
  //  - `reset <agent>` (single): materialise or overwrite — includes `no-local`
  //    so the user can `dump` a built-in to disk as a starting point.
  //  - `reset` (bulk): only touch drifted files. `no-local` agents already use
  //    the built-in via fallback, so materialising them would only manufacture
  //    new overrides for the user to maintain.
  const isSingle = Boolean(options.agent);
  const targets = rows.filter((r) => {
    if (!(r.name in PERSONAS)) return false; // unknown agent — nothing to reset to
    if (r.state === "in-sync") return false;
    if (!isSingle && r.state === "no-local") return false;
    return true;
  });
  const skipped: { name: string; reason: string }[] = [];
  for (const r of rows) {
    if (!(r.name in PERSONAS)) {
      skipped.push({ name: r.name, reason: "unknown agent (no built-in persona)" });
    } else if (r.state === "in-sync") {
      skipped.push({ name: r.name, reason: "already in sync" });
    } else if (!isSingle && r.state === "no-local") {
      skipped.push({ name: r.name, reason: "no override (already using built-in)" });
    }
  }

  if (targets.length === 0) {
    log("Nothing to reset.");
    return { written: [], skipped };
  }

  if (!options.yes) {
    log(`About to (over)write ${targets.length} prompt file(s):`);
    for (const t of targets) log(`  - ${t.name}  (${t.state})`);
    log(
      pc.dim(
        "  Existing local prompts will be backed up to `.bp/backups/<timestamp>/`.",
      ),
    );
    const confirm = options.confirm ?? defaultConfirm;
    const ok = await confirm("Proceed? [y/N] ");
    if (!ok) {
      log("Aborted.");
      return {
        written: [],
        skipped: targets.map((t) => ({ name: t.name, reason: "user declined" })),
      };
    }
  }

  const ts = timestampDir();
  const backupDir = join(paths.bp, "backups", ts);
  let backupCreated = false;
  const written: string[] = [];

  for (const t of targets) {
    // Back up existing on-disk file (only if it exists — drift implies it
    // does, but be defensive: a `no-local` reset has nothing to back up).
    if (await pathExists(t.path)) {
      const existing = await readOrNull(t.path);
      if (existing !== null) {
        const backupPath = join(backupDir, "agents", t.name, "prompt.md");
        await mkdir(dirname(backupPath), { recursive: true });
        await writeFile(backupPath, existing, "utf8");
        backupCreated = true;
      }
    }
    await mkdir(dirname(t.path), { recursive: true });
    await writeFile(t.path, PERSONAS[t.name]!, "utf8");
    written.push(t.name);
  }

  log(pc.green(`✓ Wrote ${written.length} prompt file(s): ${written.join(", ")}`));
  if (backupCreated) log(pc.dim(`  Backup: ${backupDir}`));
  if (skipped.length > 0) {
    log(pc.dim(`  Skipped: ${skipped.map((s) => `${s.name}(${s.reason})`).join(", ")}`));
  }
  return {
    written,
    skipped,
    ...(backupCreated ? { backupDir } : {}),
  };
}
