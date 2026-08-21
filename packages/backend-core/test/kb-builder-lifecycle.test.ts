import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn() };
});

import { getKbBuildStatus, startKbBuild, startKbFullSetup } from "../src/kb-builder.js";

function fakeChild(): ChildProcess {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn(() => true);
  return child as unknown as ChildProcess;
}

describe("Knowledge Base setup lifecycle", () => {
  it("reports model download active after the chained env setup has finished", async () => {
    const root = await mkdtemp(join(tmpdir(), "bp-kb-lifecycle-"));
    await mkdir(join(root, "scripts"), { recursive: true });
    await writeFile(join(root, "scripts", "setup_env.py"), "# test\n");
    await writeFile(join(root, "scripts", "setup_models.py"), "# test\n");

    const envChild = fakeChild();
    const modelChild = fakeChild();
    vi.mocked(spawn)
      .mockReturnValueOnce(envChild)
      .mockReturnValueOnce(modelChild);

    expect(startKbFullSetup({ kbRoot: root }).ok).toBe(true);
    envChild.emit("exit", 0, null);

    expect(getKbBuildStatus(root).active).toBe(true);

    modelChild.emit("exit", 0, null);
  });

  it("runs build_kb.py from the explicitly mapped KB root", async () => {
    const root = await mkdtemp(join(tmpdir(), "bp-kb-build-root-"));
    await mkdir(join(root, "scripts"), { recursive: true });
    await mkdir(join(root, ".venv", "bin"), { recursive: true });
    await writeFile(join(root, "scripts", "build_kb.py"), "# mapped build\n");
    await writeFile(join(root, ".venv", "bin", "python"), "");
    const child = fakeChild();
    vi.mocked(spawn).mockClear().mockReturnValueOnce(child);

    expect(startKbBuild({ kbRoot: root }).ok).toBe(true);
    expect(vi.mocked(spawn).mock.calls[0]?.[1]).toEqual([
      join(root, "scripts", "build_kb.py"),
      "--json",
      "--kb-root",
      root,
    ]);
    child.emit("exit", 0, null);
  });
});
