import { chmod, stat } from "node:fs/promises";
import { join } from "node:path";

const PI_MANAGED_TOOLS = ["fd", "rg"] as const;

/** Restore executable bits that persisted Pi-managed binaries may have lost. */
export async function repairPiManagedToolPermissions(
  agentDir: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  if (platform === "win32") return;

  await Promise.all(PI_MANAGED_TOOLS.map(async (name) => {
    const file = join(agentDir, "bin", name);
    try {
      const info = await stat(file);
      if (!info.isFile() || (info.mode & 0o111) !== 0) return;
      await chmod(file, (info.mode & 0o777) | 0o111);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "EACCES" && code !== "EPERM") throw error;
    }
  }));
}
