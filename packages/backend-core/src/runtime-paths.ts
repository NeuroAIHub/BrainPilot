// Mirrors cli/paths.ts dataPaths(); inlined here to avoid a cli→backend-core import cycle.
import { join } from "node:path";

export interface RuntimeArtifactPaths {
  /** Where the runtime child's stdout/stderr is appended. */
  runtimeLog: string;
  /** Where the runtime child's pid is written. */
  runtimePid: string;
}

export function runtimeArtifactPaths(dataDir: string): RuntimeArtifactPaths {
  const runtimeDir = join(dataDir, ".runtime");
  return {
    runtimeLog: join(runtimeDir, "logs", "runtime.log"),
    runtimePid: join(runtimeDir, "runtime.pid"),
  };
}
