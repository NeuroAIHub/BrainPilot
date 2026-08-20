import { describe, expect, it, vi } from "vitest";
import { PerUserDockerOrchestrator } from "../src/per-user-docker-orchestrator.js";
import type {
  EnsureRuntimeOptions,
  Orchestrator,
  RuntimeHandle,
} from "../src/orchestrator.js";
import type { DockerOrchestratorOptions } from "../src/docker-orchestrator.js";

/** A fake per-user orchestrator recording its bound hostPort/dataDir. */
class FakeOrchestrator implements Orchestrator {
  static instances: FakeOrchestrator[] = [];
  readonly hostPort: number;
  readonly dataDir?: string;
  readonly instanceId: string;
  started = false;
  stopped = false;
  healthy = true;

  constructor(opts: DockerOrchestratorOptions) {
    this.hostPort = opts.hostPort!;
    this.dataDir = opts.dataDir;
    this.instanceId = `runtime-${FakeOrchestrator.instances.length + 1}`;
    FakeOrchestrator.instances.push(this);
  }
  async ensureRuntime(_opts?: EnsureRuntimeOptions): Promise<RuntimeHandle> {
    this.started = true;
    return {
      baseUrl: `http://127.0.0.1:${this.hostPort}`,
      instanceId: this.instanceId,
    };
  }
  async health(): Promise<boolean> {
    return this.healthy;
  }
  async stopRuntime(): Promise<void> {
    this.stopped = true;
  }
}

function makeOrch(
  overrides: Partial<
    ConstructorParameters<typeof PerUserDockerOrchestrator>[0]
  > = {},
) {
  FakeOrchestrator.instances = [];
  const orch = new PerUserDockerOrchestrator({
    dataRoot: "/data/users",
    portMin: 8100,
    portMax: 8102,
    createOrchestrator: (o) => new FakeOrchestrator(o),
    ...overrides,
  });
  return orch;
}

describe("PerUserDockerOrchestrator", () => {
  it("gives each user a distinct container/port and data dir", async () => {
    const orch = makeOrch();
    const a = await orch.ensureRuntime({ userId: "alice" });
    const b = await orch.ensureRuntime({ userId: "bob" });
    expect(a.baseUrl).not.toBe(b.baseUrl);
    expect(FakeOrchestrator.instances).toHaveLength(2);
    expect(FakeOrchestrator.instances[0]!.dataDir).toBe("/data/users/alice");
    expect(FakeOrchestrator.instances[1]!.dataDir).toBe("/data/users/bob");
    expect(orch.activeUsers.sort()).toEqual(["alice", "bob"]);
  });

  it("reuses an existing healthy container for the same user (idempotent)", async () => {
    const orch = makeOrch();
    const a1 = await orch.ensureRuntime({ userId: "alice" });
    const a2 = await orch.ensureRuntime({ userId: "alice" });
    expect(a2.baseUrl).toBe(a1.baseUrl);
    expect(a2.instanceId).toBe(a1.instanceId);
    expect(FakeOrchestrator.instances).toHaveLength(1);
  });

  it("recreates the container when the user's runtime is unhealthy", async () => {
    const orch = makeOrch();
    const a1 = await orch.ensureRuntime({ userId: "alice" });
    FakeOrchestrator.instances[0]!.healthy = false;
    const a2 = await orch.ensureRuntime({ userId: "alice" });
    expect(FakeOrchestrator.instances).toHaveLength(2);
    expect(a2.baseUrl).toBe("http://127.0.0.1:8100");
    expect(a2.instanceId).not.toBe(a1.instanceId);
    expect(FakeOrchestrator.instances[0]!.stopped).toBe(true);
  });

  it("falls back to a single shared instance when no userId is given", async () => {
    const orch = makeOrch();
    const a = await orch.ensureRuntime();
    const b = await orch.ensureRuntime();
    expect(b.baseUrl).toBe(a.baseUrl);
    expect(FakeOrchestrator.instances).toHaveLength(1);
    expect(orch.activeUsers).toEqual([]);
  });

  it("is single-flight per user under concurrent first requests", async () => {
    const orch = makeOrch();
    const [a1, a2] = await Promise.all([
      orch.ensureRuntime({ userId: "alice" }),
      orch.ensureRuntime({ userId: "alice" }),
    ]);
    expect(a1.baseUrl).toBe(a2.baseUrl);
    expect(FakeOrchestrator.instances).toHaveLength(1);
  });

  it("releases a port on stop so it can be reallocated", async () => {
    const orch = makeOrch();
    await orch.ensureRuntime({ userId: "alice" });
    await orch.ensureRuntime({ userId: "bob" });
    await orch.stopRuntime("alice");
    expect(orch.activeUsers).toEqual(["bob"]);
    // alice's freed port (8100) is reused by the next new user.
    const c = await orch.ensureRuntime({ userId: "carol" });
    expect(c.baseUrl).toBe("http://127.0.0.1:8100");
  });

  it("throws when the port pool is exhausted", async () => {
    const orch = makeOrch({ portMin: 8100, portMax: 8100 });
    await orch.ensureRuntime({ userId: "alice" });
    await expect(orch.ensureRuntime({ userId: "bob" })).rejects.toThrow(
      /no free host port/i,
    );
  });

  it("frees the port when a user's launch fails", async () => {
    let calls = 0;
    const orch = makeOrch({
      portMin: 8100,
      portMax: 8100,
      createOrchestrator: (o) => {
        calls++;
        if (calls === 1) {
          return {
            async ensureRuntime() {
              throw new Error("boom");
            },
            async health() {
              return false;
            },
            async stopRuntime() {},
          } satisfies Orchestrator;
        }
        return new FakeOrchestrator(o);
      },
    });
    await expect(orch.ensureRuntime({ userId: "alice" })).rejects.toThrow("boom");
    // Port was released → a retry (single-port pool) can succeed.
    const a = await orch.ensureRuntime({ userId: "alice" });
    expect(a.baseUrl).toBe("http://127.0.0.1:8100");
  });

  it("stopRuntime() with no arg stops all users", async () => {
    const orch = makeOrch();
    await orch.ensureRuntime({ userId: "alice" });
    await orch.ensureRuntime({ userId: "bob" });
    await orch.stopRuntime();
    expect(orch.activeUsers).toEqual([]);
    expect(FakeOrchestrator.instances.every((i) => i.stopped)).toBe(true);
  });

  describe("idle reclaim (R-3)", () => {
    it("reaps an idle user with no running agents past the threshold", async () => {
      let clock = 1_000_000;
      const metricsProbe = vi.fn(async () => ({
        runningAgents: 0,
        lastActivityAt: new Date(clock - 10 * 60_000).toISOString(),
      }));
      const orch = makeOrch({
        idleMs: 5 * 60_000,
        metricsProbe,
        now: () => clock,
        setIntervalFn: () => 0 as unknown as ReturnType<typeof setInterval>,
        clearIntervalFn: () => {},
      });
      await orch.ensureRuntime({ userId: "alice" });
      await orch.reapIdle();
      expect(orch.activeUsers).toEqual([]);
      expect(FakeOrchestrator.instances[0]!.stopped).toBe(true);
    });

    it("does NOT reap a user with running agents", async () => {
      let clock = 1_000_000;
      const orch = makeOrch({
        idleMs: 1,
        metricsProbe: async () => ({ runningAgents: 2, lastActivityAt: null }),
        now: () => clock,
        setIntervalFn: () => 0 as unknown as ReturnType<typeof setInterval>,
        clearIntervalFn: () => {},
      });
      await orch.ensureRuntime({ userId: "alice" });
      await orch.reapIdle();
      expect(orch.activeUsers).toEqual(["alice"]);
    });

    it("does NOT reap when metrics are unreadable (transient probe failure)", async () => {
      const orch = makeOrch({
        idleMs: 1,
        metricsProbe: async () => null,
        setIntervalFn: () => 0 as unknown as ReturnType<typeof setInterval>,
        clearIntervalFn: () => {},
      });
      await orch.ensureRuntime({ userId: "alice" });
      await orch.reapIdle();
      expect(orch.activeUsers).toEqual(["alice"]);
    });
  });
});
