import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { repairPiManagedToolPermissions } from "../managed-tool-permissions.js";

describe("Pi managed tool permissions", () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it.runIf(process.platform !== "win32")("repairs a persisted non-executable fd before Pi uses it", async () => {
    const agentDir = await mkdtemp(join(tmpdir(), "brainpilot-agent-tools-"));
    temporaryRoots.push(agentDir);
    const binDir = join(agentDir, "bin");
    const fd = join(binDir, "fd");
    await mkdir(binDir);
    await writeFile(fd, "#!/bin/sh\nprintf 'fd test version\\n'\n", { mode: 0o644 });
    await chmod(fd, 0o644);

    expect(spawnSync(fd, ["--version"]).error).toMatchObject({ code: "EACCES" });

    await repairPiManagedToolPermissions(agentDir);

    const result = spawnSync(fd, ["--version"], { encoding: "utf8" });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("fd test version\n");
  });
});
