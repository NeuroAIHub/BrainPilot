import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("trusted Pi package extensions", () => {
  it("loads the pinned Superpowers extension and preserves its native lifecycle", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bp-superpowers-extension-"));
    roots.push(root);
    const testDir = path.dirname(fileURLToPath(import.meta.url));
    const pluginRoot = path.resolve(testDir, "../../../backend-core/plugins/superpowers/6.2.0");
    // Run Pi's generated SDK through Node, as npm consumers do. Vitest's module
    // runner does not implement import.meta.resolve used by Pi's extension loader.
    const { stdout } = await execFileAsync(process.execPath, [
      path.join(testDir, "fixtures", "pi-package-extension.mjs"), root, pluginRoot,
    ]);
    const loaded = JSON.parse(stdout);
    expect(loaded.errors).toEqual([]);
    expect(loaded.extensionCount).toBe(1);
    expect(loaded.handlerNames).toEqual([
      "resources_discover", "session_start", "session_compact", "agent_end", "context",
    ]);
    expect(loaded.discovered).toEqual({ skillPaths: [path.join(pluginRoot, "skills")] });
    expect(loaded.firstText).toContain("superpowers:using-superpowers bootstrap for pi");
    expect(loaded.firstText).toContain("Pi tool mapping");
    expect(loaded.afterEnd).toBeNull();
    expect(loaded.afterCompact).toEqual(expect.objectContaining({ messages: expect.any(Array) }));
  });
});
