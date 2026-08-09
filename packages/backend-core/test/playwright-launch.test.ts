import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const launcher = fileURLToPath(new URL("../plugins/playwright-mcp/0.0.78/scripts/launch.mjs", import.meta.url));

async function runCheck(browserRoot: string): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [launcher, "--check"], {
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browserRoot, BRAINPILOT_PLAYWRIGHT_EXECUTABLE_PATH: "" },
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("exit", resolve);
  });
}

describe("Playwright MCP launcher browser discovery", () => {
  it.each([
    "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
    "chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium",
    "chrome-win/chrome.exe",
    "chrome-linux/chrome",
  ])("accepts a cached Chromium layout at %s", async (relative) => {
    const root = await mkdtemp(path.join(tmpdir(), "bp-playwright-cache-"));
    const executable = path.join(root, "chromium-1234", relative);
    await mkdir(path.dirname(executable), { recursive: true });
    await writeFile(executable, "fixture");

    await expect(runCheck(root)).resolves.toBe(0);
  });
});
