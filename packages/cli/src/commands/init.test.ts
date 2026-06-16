import { describe, it, expect, vi } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { init } from "./init.js";

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "bp-init-"));
}

describe("init — onboarding guidance", () => {
  it("already-scaffolded + no key still tells the user how to configure", async () => {
    const root = await tmp();
    // Pre-scaffold by running once.
    await init({ dir: root }, { env: {}, log: () => {} });

    const logs: string[] = [];
    await init({ dir: root }, { env: {}, log: (m) => logs.push(m) });
    const text = logs.join("\n");
    expect(text).toContain("No provider API key configured");
    expect(text).toContain("--base-url");
    expect(text).toContain("Settings UI");
  });

  it("persists --base-url alongside the key", async () => {
    const root = await tmp();
    const writeSettings = vi.fn().mockResolvedValue(undefined);
    await init(
      { dir: root, apiKey: "sk-1", baseUrl: "https://gw/api", model: "m1" },
      { env: {}, log: () => {}, writeSettings },
    );
    expect(writeSettings).toHaveBeenCalledWith(
      root,
      expect.objectContaining({ apiKey: "sk-1", baseUrl: "https://gw/api", model: "m1" }),
    );
  });

  it("persists --base-url even without an api key", async () => {
    const root = await tmp();
    const writeSettings = vi.fn().mockResolvedValue(undefined);
    await init(
      { dir: root, baseUrl: "https://gw/api" },
      { env: {}, log: () => {}, writeSettings },
    );
    expect(writeSettings).toHaveBeenCalledWith(
      root,
      expect.objectContaining({ baseUrl: "https://gw/api" }),
    );
  });

  it("reports the key as configured when one is resolvable", async () => {
    const root = await tmp();
    await mkdir(join(root, "bp_template"), { recursive: true });
    await writeFile(
      join(root, "bp_template", "settings.json"),
      JSON.stringify({ apiKey: "sk-existing", model: "m9" }),
    );
    const logs: string[] = [];
    await init({ dir: root }, { env: {}, log: (m) => logs.push(m) });
    const text = logs.join("\n");
    expect(text).toContain("Provider key configured");
    expect(text).toContain("m9");
  });
});
