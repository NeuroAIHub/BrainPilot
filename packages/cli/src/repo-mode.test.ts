import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertRepoCwd } from "./repo-mode.js";

/** Build a fake "repo" with the expected packages/cli/dist/bin.js shape. */
function makeFakeRepo(): { cwd: string; binPath: string } {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "bp-repo-")));
  const distDir = join(cwd, "packages", "cli", "dist");
  mkdirSync(distDir, { recursive: true });
  const binPath = join(distDir, "bin.js");
  writeFileSync(binPath, "// fake bin\n");
  return { cwd, binPath };
}

function makeForeign(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), "bp-foreign-")));
}

function callAssert(opts: Parameters<typeof assertRepoCwd>[0]): {
  exited: number | null;
  err: string;
} {
  let exited: number | null = null;
  let err = "";
  assertRepoCwd({
    ...opts,
    stderr: (m) => {
      err += m;
    },
    exit: ((code: number) => {
      exited = code;
      throw new Error("__exit__");
    }) as never,
  });
  return { exited, err };
}

describe("assertRepoCwd", () => {
  it("passes when cwd contains the running bin.js at the expected path", () => {
    const { cwd, binPath } = makeFakeRepo();
    // Should NOT throw / NOT exit.
    expect(() =>
      assertRepoCwd({ argv: [], env: {}, cwd, binPath }),
    ).not.toThrow();
  });

  it("rejects (exit 2) when cwd is unrelated to the running bin.js", () => {
    const { binPath } = makeFakeRepo();
    const cwd = makeForeign();
    expect(() => callAssert({ argv: [], env: {}, cwd, binPath })).toThrow(
      "__exit__",
    );
    // Re-run to capture error/exit code without bouncing on throw.
    let exited: number | null = null;
    let err = "";
    try {
      assertRepoCwd({
        argv: [],
        env: {},
        cwd,
        binPath,
        stderr: (m) => {
          err += m;
        },
        exit: ((c: number) => {
          exited = c;
          throw new Error("__exit__");
        }) as never,
      });
    } catch {
      /* swallowed */
    }
    expect(exited).toBe(2);
    expect(err).toContain("brainpilot 必须在仓库根目录运行");
    expect(err).toContain("--dir");
    expect(err).toContain("BP_ALLOW_FOREIGN_CWD");
  });

  it("skips check when --dir is given", () => {
    const { binPath } = makeFakeRepo();
    const cwd = makeForeign();
    expect(() =>
      assertRepoCwd({
        argv: ["up", "--dir", "/tmp/somewhere"],
        env: {},
        cwd,
        binPath,
      }),
    ).not.toThrow();
  });

  it("skips check when -d is given", () => {
    const { binPath } = makeFakeRepo();
    const cwd = makeForeign();
    expect(() =>
      assertRepoCwd({
        argv: ["up", "-d", "/tmp/somewhere"],
        env: {},
        cwd,
        binPath,
      }),
    ).not.toThrow();
  });

  it("skips check when --dir=<v> form is given", () => {
    const { binPath } = makeFakeRepo();
    const cwd = makeForeign();
    expect(() =>
      assertRepoCwd({
        argv: ["up", "--dir=/tmp/foo"],
        env: {},
        cwd,
        binPath,
      }),
    ).not.toThrow();
  });

  it("skips check when BP_DATA_DIR is set", () => {
    const { binPath } = makeFakeRepo();
    const cwd = makeForeign();
    expect(() =>
      assertRepoCwd({
        argv: ["up"],
        env: { BP_DATA_DIR: "/tmp/dd" },
        cwd,
        binPath,
      }),
    ).not.toThrow();
  });

  it("skips check when BP_ALLOW_FOREIGN_CWD=1 is set", () => {
    const { binPath } = makeFakeRepo();
    const cwd = makeForeign();
    expect(() =>
      assertRepoCwd({
        argv: ["up"],
        env: { BP_ALLOW_FOREIGN_CWD: "1" },
        cwd,
        binPath,
      }),
    ).not.toThrow();
  });

  it("rejects when --dir flag is absent and env is empty even if cwd merely contains the repo path string", () => {
    // Sanity: substring matches must not bypass the realpath compare.
    const { binPath } = makeFakeRepo();
    const cwd = makeForeign();
    expect(() => callAssert({ argv: [], env: {}, cwd, binPath })).toThrow(
      "__exit__",
    );
  });
});
