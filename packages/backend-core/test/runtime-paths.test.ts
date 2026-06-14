import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { runtimeArtifactPaths } from "../src/runtime-paths.js";

describe("runtimeArtifactPaths", () => {
  it("derives runtime.log under <dataDir>/.runtime/logs and runtime.pid under <dataDir>/.runtime", () => {
    const d = "/data/bp";
    const p = runtimeArtifactPaths(d);
    expect(p.runtimeLog).toBe(join(d, ".runtime", "logs", "runtime.log"));
    expect(p.runtimePid).toBe(join(d, ".runtime", "runtime.pid"));
  });

  // 防漂移:这些字符串必须与 packages/cli/src/paths.ts 的 dataPaths() 一致。
  // cli/paths.ts: runtimeDir=join(dataDir,".runtime"); logsDir=join(runtimeDir,"logs");
  //   runtimeLog=join(logsDir,"runtime.log"); runtimePid=join(runtimeDir,"runtime.pid")
  it("matches the cli/paths.ts dataPaths() layout (hardcoded mirror)", () => {
    const p = runtimeArtifactPaths("/x");
    expect(p.runtimeLog).toBe("/x/.runtime/logs/runtime.log");
    expect(p.runtimePid).toBe("/x/.runtime/runtime.pid");
  });
});
