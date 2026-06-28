import { describe, it, expect } from "vitest";
import { resolveDataDir, dataPaths } from "./paths.js";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

describe("resolveDataDir precedence", () => {
  // Use the OS tmpdir so the cwd literal is a valid absolute path on every
  // host (Windows in particular — `/tmp/launch` resolves to `C:\tmp\launch`
  // there, which is technically fine for resolve()-based equality but
  // depends on a fragile detail). (#9 — cross-platform pass.)
  const cwd = join(tmpdir(), "launch");

  it("uses --dir when provided (highest priority)", () => {
    const d = resolveDataDir({
      dir: "custom",
      env: { BP_DATA_DIR: "/from/env" },
      cwd,
    });
    expect(d).toBe(resolve(cwd, "custom"));
  });

  it("resolves an absolute --dir as-is", () => {
    const d = resolveDataDir({ dir: "/abs/path", cwd });
    expect(d).toBe("/abs/path");
  });

  it("falls back to BP_DATA_DIR when no --dir", () => {
    const d = resolveDataDir({ env: { BP_DATA_DIR: "envdir" }, cwd });
    expect(d).toBe(resolve(cwd, "envdir"));
  });

  it("defaults to <cwd>/brainpilot when neither is set", () => {
    const d = resolveDataDir({ env: {}, cwd });
    expect(d).toBe(join(cwd, "brainpilot"));
  });

  it("ignores empty/whitespace --dir and env values", () => {
    const d = resolveDataDir({ dir: "   ", env: { BP_DATA_DIR: "" }, cwd });
    expect(d).toBe(join(cwd, "brainpilot"));
  });
});

describe("dataPaths", () => {
  it("derives all well-known paths under the data dir", () => {
    const p = dataPaths("/data");
    expect(p.bpTemplate).toBe("/data/bp_template");
    expect(p.bpTemplateAgents).toBe("/data/bp_template/agents");
    expect(p.bpTemplateSettings).toBe("/data/bp_template/settings.json");
    expect(p.bp).toBe("/data/.bp");
    expect(p.workspaces).toBe("/data/workspaces");
    expect(p.brainpilotConfig).toBe("/data/brainpilot.config.json");
    expect(p.runtimeDir).toBe("/data/.runtime");
    expect(p.logsDir).toBe("/data/.runtime/logs");
    expect(p.backendLog).toBe("/data/.runtime/logs/backend.log");
    expect(p.backendPid).toBe("/data/.runtime/backend.pid");
    expect(p.runtimePid).toBe("/data/.runtime/runtime.pid");
  });
});
