/**
 * repo-mode.ts — assert the CLI is being run from the BrainPilot repo root.
 *
 * The supported launch shape today is `npm run bp -- <cmd>` from the cloned
 * repo's root directory. Running from any other cwd is rejected because:
 *
 *  - `paths.resolveDataDir` defaults to `<cwd>/brainpilot`, so a foreign cwd
 *    would silently spawn an isolated data dir nowhere near the repo (#102 had
 *    a sibling-of: configs and prompts that were supposed to update with
 *    `git pull` instead live next to wherever the user happened to cd to).
 *  - Doc/CLAUDE.md says "must run from <repo>", and we want that to be a
 *    hard contract, not a hope.
 *
 * Detection is "the bin.js you are currently running came from $cwd/packages/
 * cli/dist/bin.js" — comparing realpaths defeats symlinks and ./node_modules/
 * .bin hoisting. The check is conservatively skipped when the caller has
 * pinned the data dir explicitly (`--dir` / `BP_DATA_DIR` / `BP_DATA_ROOT`)
 * or set the env escape hatch `BP_ALLOW_FOREIGN_CWD=1`; those paths are
 * dev/CI/test scenarios where the cwd-is-repo assumption legitimately doesn't
 * hold.
 */
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Lookup of argv flags that pin the data dir explicitly (skip the cwd guard). */
const EXPLICIT_DIR_FLAGS = new Set(["-d", "--dir"]);

function hasExplicitDirFlag(argv: readonly string[]): boolean {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (EXPLICIT_DIR_FLAGS.has(a)) return true;
    if (a.startsWith("--dir=") || a.startsWith("-d=")) return true;
  }
  return false;
}

export interface AssertRepoCwdOptions {
  /** argv slice (no node + script). */
  argv?: readonly string[];
  /** Environment (defaults to `process.env`). */
  env?: Record<string, string | undefined>;
  /** Override for tests. */
  cwd?: string;
  /** Absolute path to the running bin.js (defaults to import.meta.url resolver). */
  binPath?: string;
  /** Sink for the error message (defaults to console.error). */
  stderr?: (msg: string) => void;
  /** Exit hook (defaults to process.exit). */
  exit?: (code: number) => never;
}

/**
 * Compare two paths via realpath; returns false if either side is missing.
 * `realpathSync` is sync to keep this off any startup-async race.
 */
function samePath(a: string, b: string): boolean {
  try {
    const ra = realpathSync(a);
    const rb = realpathSync(b);
    // Windows/macOS filesystems are case-insensitive and realpathSync does not
    // canonicalize drive-letter casing, so compare case-insensitively there.
    if (process.platform === "win32" || process.platform === "darwin") {
      return ra.toLowerCase() === rb.toLowerCase();
    }
    return ra === rb;
  } catch {
    return false;
  }
}

/**
 * Verify cwd is the BrainPilot repo root. Exits the process (code 2) with a
 * Chinese-language explanation when it isn't. Returns normally on success or
 * when an escape-hatch condition applies.
 */
export function assertRepoCwd(options: AssertRepoCwdOptions = {}): void {
  const argv = options.argv ?? process.argv.slice(2);
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const binPath = options.binPath ?? fileURLToPath(new URL("./bin.js", import.meta.url));
  const stderr = options.stderr ?? ((m: string) => console.error(m));
  const exit = options.exit ?? ((c: number) => process.exit(c) as never);

  // Escape hatches: explicit data dir means the user has opted out of the
  // "cwd is the repo" assumption — let them through.
  if (env.BP_ALLOW_FOREIGN_CWD === "1") return;
  if (env.BP_DATA_DIR?.trim()) return;
  if (env.BP_DATA_ROOT?.trim()) return;
  if (hasExplicitDirFlag(argv)) return;

  const expected = resolve(cwd, "packages/cli/dist/bin.js");
  if (samePath(expected, binPath)) return;

  stderr(
    [
      "✗ brainpilot 必须在仓库根目录运行 (当前 cwd 不是 BrainPilotPi 仓库根)",
      `    cwd      = ${cwd}`,
      `    bin.js   = ${binPath}`,
      "",
      "  请 `cd` 到 BrainPilotPi 仓库根目录后再执行 `npm run bp -- ...`。",
      "  这样配置随 `git pull` 自动更新, 且 dataDir (bp_template/, workspaces/) 不漂移。",
      "",
      "  例外情况 (开发 / CI):",
      "    - 用 `--dir <path>` 显式指定数据目录",
      "    - 或设置 BP_DATA_DIR=<path> 环境变量",
      "    - 或设置 BP_ALLOW_FOREIGN_CWD=1 强制绕过此检查",
    ].join("\n"),
  );
  exit(2);
}
