import { describe, expect, it } from "vitest";
import { buildServerOrchestrator } from "../src/server.js";
import { LocalProcessOrchestrator } from "../src/local-orchestrator.js";
import type { Orchestrator } from "../src/orchestrator.js";

/**
 * Regression coverage for issue #169 — `startServer` dropped `dataDir` when
 * constructing the orchestrator, so the runtime child it spawns fell back to
 * `./brainpilot` (relative to cwd) instead of the requested data dir. The
 * orchestrator construction is now a pure, exported function so this seam is
 * testable without binding a socket.
 *
 * The `create-orchestrator.test.ts` suite already covers the factory in
 * isolation; what was missing was the *caller* wiring — that `options.dataDir`
 * actually reaches the local orchestrator's `BP_DATA_DIR`.
 */
describe("buildServerOrchestrator", () => {
  it("threads dataDir through to the local runtime env (#169)", () => {
    const orch = buildServerOrchestrator({
      dataDir: "/data/xyz",
      // foreground/CLI mode — exercises the stdioInherit branch too.
      stdioInherit: true,
    });
    expect(orch).toBeInstanceOf(LocalProcessOrchestrator);
    const env = (orch as LocalProcessOrchestrator).buildEnv();
    expect(env.BP_DATA_DIR).toBe("/data/xyz");
  });

  it("threads dataDir through in detached (non-stdioInherit) mode too", () => {
    const orch = buildServerOrchestrator({ dataDir: "/data/detached" });
    expect(orch).toBeInstanceOf(LocalProcessOrchestrator);
    const env = (orch as LocalProcessOrchestrator).buildEnv();
    expect(env.BP_DATA_DIR).toBe("/data/detached");
  });

  it("returns an injected orchestrator verbatim (short-circuit)", () => {
    const injected = { id: "injected" } as unknown as Orchestrator;
    expect(buildServerOrchestrator({ orchestrator: injected })).toBe(injected);
  });

  it("falls back to BP_DATA_DIR env when no dataDir option is given", () => {
    const prev = process.env.BP_DATA_DIR;
    process.env.BP_DATA_DIR = "/data/from-env";
    try {
      const orch = buildServerOrchestrator({ stdioInherit: true });
      const env = (orch as LocalProcessOrchestrator).buildEnv();
      expect(env.BP_DATA_DIR).toBe("/data/from-env");
    } finally {
      if (prev === undefined) delete process.env.BP_DATA_DIR;
      else process.env.BP_DATA_DIR = prev;
    }
  });
});
