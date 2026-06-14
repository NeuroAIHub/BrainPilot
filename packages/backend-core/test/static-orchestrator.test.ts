import { describe, expect, it, vi } from "vitest";
import { StaticRuntimeOrchestrator } from "../src/static-orchestrator.js";

describe("StaticRuntimeOrchestrator", () => {
  it("returns the configured baseUrl once health passes", async () => {
    const orch = new StaticRuntimeOrchestrator({
      baseUrl: "http://sandbox:8081",
      healthProbe: async () => true,
      sleep: async () => {},
    });
    const handle = await orch.ensureRuntime();
    expect(handle.baseUrl).toBe("http://sandbox:8081");
  });

  it("strips a trailing slash from baseUrl", async () => {
    const orch = new StaticRuntimeOrchestrator({
      baseUrl: "http://sandbox:8081/",
      healthProbe: async () => true,
      sleep: async () => {},
    });
    const handle = await orch.ensureRuntime();
    expect(handle.baseUrl).toBe("http://sandbox:8081");
  });

  it("polls until healthy, then resolves", async () => {
    let calls = 0;
    const orch = new StaticRuntimeOrchestrator({
      baseUrl: "http://sandbox:8081",
      healthProbe: async () => ++calls >= 3,
      sleep: async () => {},
    });
    const handle = await orch.ensureRuntime();
    expect(handle.baseUrl).toBe("http://sandbox:8081");
    expect(calls).toBe(3);
  });

  it("throws a fatal error when health never passes within timeout", async () => {
    const orch = new StaticRuntimeOrchestrator({
      baseUrl: "http://sandbox:8081",
      healthProbe: async () => false,
      healthTimeoutMs: 10,
      sleep: async () => {},
    });
    await expect(orch.ensureRuntime()).rejects.toThrow(/did not become healthy/);
  });

  it("health() delegates to the probe", async () => {
    const probe = vi.fn(async () => true);
    const orch = new StaticRuntimeOrchestrator({
      baseUrl: "http://sandbox:8081",
      healthProbe: probe,
    });
    expect(await orch.health()).toBe(true);
    expect(probe).toHaveBeenCalledWith("http://sandbox:8081");
  });

  it("stopRuntime is a no-op (container lifecycle owned by compose)", async () => {
    const orch = new StaticRuntimeOrchestrator({
      baseUrl: "http://sandbox:8081",
      healthProbe: async () => true,
    });
    await expect(orch.stopRuntime()).resolves.toBeUndefined();
  });

  it("throws if constructed without a baseUrl", () => {
    expect(() => new StaticRuntimeOrchestrator({ baseUrl: "" })).toThrow(
      /baseUrl is required/,
    );
  });
});
