import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOrchestrator } from "../src/create-orchestrator.js";
import { resolveOrchestratorMode } from "../src/orchestrator.js";
import { LocalProcessOrchestrator } from "../src/local-orchestrator.js";
import { DockerOrchestrator } from "../src/docker-orchestrator.js";
import { PerUserDockerOrchestrator } from "../src/per-user-docker-orchestrator.js";
import { StaticRuntimeOrchestrator } from "../src/static-orchestrator.js";

describe("resolveOrchestratorMode", () => {
  it("defaults to local", () => {
    expect(resolveOrchestratorMode({})).toBe("local");
  });
  it("honors BP_ORCHESTRATOR=docker", () => {
    expect(resolveOrchestratorMode({ BP_ORCHESTRATOR: "docker" })).toBe("docker");
  });
  it("honors BP_MODE=docker", () => {
    expect(resolveOrchestratorMode({ BP_MODE: "docker" })).toBe("docker");
  });
  it("BP_ORCHESTRATOR wins over BP_MODE", () => {
    expect(
      resolveOrchestratorMode({ BP_ORCHESTRATOR: "local", BP_MODE: "docker" }),
    ).toBe("local");
  });
  it("returns static when BP_RUNTIME_URL is set", () => {
    expect(
      resolveOrchestratorMode({ BP_RUNTIME_URL: "http://sandbox:8081" }),
    ).toBe("static");
  });
  it("BP_RUNTIME_URL wins over BP_MODE=docker", () => {
    expect(
      resolveOrchestratorMode({
        BP_RUNTIME_URL: "http://sandbox:8081",
        BP_MODE: "docker",
      }),
    ).toBe("static");
  });
  it("explicit BP_ORCHESTRATOR=docker wins over BP_RUNTIME_URL", () => {
    expect(
      resolveOrchestratorMode({
        BP_ORCHESTRATOR: "docker",
        BP_RUNTIME_URL: "http://sandbox:8081",
      }),
    ).toBe("docker");
  });
});

describe("createOrchestrator factory", () => {
  it("creates a LocalProcessOrchestrator by default", () => {
    expect(createOrchestrator({ env: {} })).toBeInstanceOf(LocalProcessOrchestrator);
  });
  it("creates a DockerOrchestrator when mode=docker", () => {
    const fakeDocker = {} as never;
    const orch = createOrchestrator({ mode: "docker", docker: { docker: fakeDocker } });
    expect(orch).toBeInstanceOf(DockerOrchestrator);
  });
  it("creates a PerUserDockerOrchestrator when docker mode + BP_DYNAMIC=1 (#301)", () => {
    const orch = createOrchestrator({
      mode: "docker",
      env: { BP_DYNAMIC: "1" },
      docker: { docker: {} as never },
    });
    expect(orch).toBeInstanceOf(PerUserDockerOrchestrator);
  });
  it("stays single-instance DockerOrchestrator in docker mode without BP_DYNAMIC (#301)", () => {
    const orch = createOrchestrator({
      mode: "docker",
      env: {},
      docker: { docker: {} as never },
    });
    expect(orch).toBeInstanceOf(DockerOrchestrator);
  });
  it("respects an explicit mode override", () => {
    expect(createOrchestrator({ mode: "local" })).toBeInstanceOf(LocalProcessOrchestrator);
  });
  it("creates a StaticRuntimeOrchestrator when mode=static", () => {
    const orch = createOrchestrator({
      mode: "static",
      static: { baseUrl: "http://sandbox:8081" },
    });
    expect(orch).toBeInstanceOf(StaticRuntimeOrchestrator);
  });
  it("creates a StaticRuntimeOrchestrator from BP_RUNTIME_URL env", () => {
    const orch = createOrchestrator({
      env: { BP_RUNTIME_URL: "http://sandbox:8081" },
    });
    expect(orch).toBeInstanceOf(StaticRuntimeOrchestrator);
  });
  it("forwards BP_SHARED_DIR from env into the Docker orchestrator's read-only mount (#261)", async () => {
    const container = {
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
    };
    const docker = { createContainer: vi.fn(async () => container) } as never;
    const orch = createOrchestrator({
      mode: "docker",
      env: { BP_SHARED_DIR: "/host/shared" },
      docker: { docker, dataDir: "/host/bp", healthProbe: async () => true, sleep: async () => {} },
    });
    await orch.ensureRuntime();
    const createArg = (docker as { createContainer: ReturnType<typeof vi.fn> })
      .createContainer.mock.calls[0]![0] as { HostConfig?: Record<string, unknown> };
    expect(createArg.HostConfig!.Mounts).toContainEqual({
      Type: "bind",
      Source: "/host/shared",
      Target: "/shared",
      ReadOnly: true,
    });
  });
});

describe("DockerOrchestrator (stubbed dockerode)", () => {
  it("creates + starts a container and waits for health", async () => {
    const started = { value: false };
    const container = {
      start: vi.fn(async () => {
        started.value = true;
      }),
      stop: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
    };
    const docker = {
      createContainer: vi.fn(async () => container),
    } as never;
    const orch = new DockerOrchestrator({
      docker,
      image: "brainpilot-sandbox:test",
      containerPort: 8081,
      hostPort: 18081,
      dataDir: "/host/bp",
      healthProbe: async () => started.value,
      sleep: async () => {},
    });
    const handle = await orch.ensureRuntime();
    expect(handle.baseUrl).toBe("http://127.0.0.1:18081");
    expect(handle.instanceId).toEqual(expect.any(String));
    expect(container.start).toHaveBeenCalledTimes(1);
    const createArg = (docker as { createContainer: ReturnType<typeof vi.fn> })
      .createContainer.mock.calls[0]![0] as Record<string, unknown>;
    expect(createArg.Image).toBe("brainpilot-sandbox:test");
    expect((createArg.Env as string[]).some((e) => e.startsWith("BP_DATA_DIR="))).toBe(true);

    await orch.stopRuntime();
    expect(container.stop).toHaveBeenCalledTimes(1);
  });

  // #1 — cross-platform: the legacy `Binds: ["src:dst:rw"]` colon-string is
  // unparseable when `src` is a Windows path that already contains a colon
  // after the drive letter, so we use the structured `Mounts` API instead.
  // The two assertions below pin that contract: a structured `Mounts` array
  // exists with the bind shape, and the deprecated `Binds` field is gone.
  it("uses HostConfig.Mounts (structured) instead of Binds for bind mounts (#1)", async () => {
    const container = {
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
    };
    const docker = {
      createContainer: vi.fn(async () => container),
    } as never;
    const orch = new DockerOrchestrator({
      docker,
      image: "brainpilot-sandbox:test",
      containerPort: 8081,
      hostPort: 18081,
      dataDir: "/host/bp",
      containerDataDir: "/root/.bp-root",
      healthProbe: async () => true,
      sleep: async () => {},
    });
    await orch.ensureRuntime();
    const createArg = (docker as { createContainer: ReturnType<typeof vi.fn> })
      .createContainer.mock.calls[0]![0] as { HostConfig?: Record<string, unknown> };
    const hostConfig = createArg.HostConfig!;
    expect(hostConfig.Binds).toBeUndefined();
    expect(hostConfig.Mounts).toEqual([
      { Type: "bind", Source: "/host/bp", Target: "/root/.bp-root", ReadOnly: false },
    ]);
  });

  // The bind-mount block is conditional on `dataDir` — when no dataDir is
  // configured the container runs without a host bind, and neither field
  // should be present (matches the original code path's intent).
  it("emits neither Binds nor Mounts when no dataDir is configured (#1)", async () => {
    const container = {
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
    };
    const docker = {
      createContainer: vi.fn(async () => container),
    } as never;
    const orch = new DockerOrchestrator({
      docker,
      image: "brainpilot-sandbox:test",
      healthProbe: async () => true,
      sleep: async () => {},
    });
    await orch.ensureRuntime();
    const createArg = (docker as { createContainer: ReturnType<typeof vi.fn> })
      .createContainer.mock.calls[0]![0] as { HostConfig?: Record<string, unknown> };
    const hostConfig = createArg.HostConfig!;
    expect(hostConfig.Binds).toBeUndefined();
    expect(hostConfig.Mounts).toBeUndefined();
  });

  // #261: the cross-user shared root is bind-mounted READ-ONLY alongside the
  // dataDir mount, and its container path is injected as BP_SHARED_DIR so the
  // runtime exposes the `/shared` prefix.
  it("adds a read-only /shared bind + BP_SHARED_DIR env when sharedDir is set (#261)", async () => {
    const container = {
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
    };
    const docker = {
      createContainer: vi.fn(async () => container),
    } as never;
    const orch = new DockerOrchestrator({
      docker,
      image: "brainpilot-sandbox:test",
      containerPort: 8081,
      hostPort: 18081,
      dataDir: "/host/bp",
      containerDataDir: "/root/.bp-root",
      sharedDir: "/host/shared",
      healthProbe: async () => true,
      sleep: async () => {},
    });
    await orch.ensureRuntime();
    const createArg = (docker as { createContainer: ReturnType<typeof vi.fn> })
      .createContainer.mock.calls[0]![0] as {
      Env?: string[];
      HostConfig?: Record<string, unknown>;
    };
    const hostConfig = createArg.HostConfig!;
    expect(hostConfig.Mounts).toEqual([
      { Type: "bind", Source: "/host/bp", Target: "/root/.bp-root", ReadOnly: false },
      { Type: "bind", Source: "/host/shared", Target: "/shared", ReadOnly: true },
    ]);
    expect(createArg.Env).toContain("BP_SHARED_DIR=/shared");
  });

  it("emits no /shared mount and no BP_SHARED_DIR when sharedDir is unset (#261)", async () => {
    const container = {
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
    };
    const docker = {
      createContainer: vi.fn(async () => container),
    } as never;
    const orch = new DockerOrchestrator({
      docker,
      image: "brainpilot-sandbox:test",
      dataDir: "/host/bp",
      healthProbe: async () => true,
      sleep: async () => {},
    });
    await orch.ensureRuntime();
    const createArg = (docker as { createContainer: ReturnType<typeof vi.fn> })
      .createContainer.mock.calls[0]![0] as {
      Env?: string[];
      HostConfig?: Record<string, unknown>;
    };
    expect(createArg.HostConfig!.Mounts as unknown[]).toHaveLength(1);
    expect((createArg.Env ?? []).some((e) => e.startsWith("BP_SHARED_DIR="))).toBe(false);
  });

  it("auto-pulls the image when createContainer reports it is missing", async () => {
    const container = {
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
    };
    let attempts = 0;
    const createContainer = vi.fn(async () => {
      attempts++;
      if (attempts === 1) {
        const err = Object.assign(new Error("no such image: brainpilot-sandbox:test"), {
          statusCode: 404,
        });
        throw err;
      }
      return container;
    });
    const pull = vi.fn((_image: string, cb: (e: Error | null, s: unknown) => void) => {
      cb(null, { fake: "stream" });
    });
    const docker = {
      createContainer,
      pull,
      modem: { followProgress: (_s: unknown, done: (e: Error | null) => void) => done(null) },
    } as never;

    const orch = new DockerOrchestrator({
      docker,
      image: "brainpilot-sandbox:test",
      healthProbe: async () => true,
      sleep: async () => {},
    });
    const handle = await orch.ensureRuntime();
    expect(handle.baseUrl).toContain("http://");
    expect(pull).toHaveBeenCalledTimes(1);
    expect(createContainer).toHaveBeenCalledTimes(2); // 404, pull, retry
    expect(container.start).toHaveBeenCalledTimes(1);
  });

  it("throws a clear error when dockerode cannot be loaded and none injected", async () => {
    const orch = new DockerOrchestrator({
      dockerLoader: async () => {
        throw new Error("Cannot find module 'dockerode'");
      },
      healthProbe: async () => true,
      sleep: async () => {},
    });
    await expect(orch.ensureRuntime()).rejects.toThrow(/requires 'dockerode'/);
  });
});

describe("createOrchestrator local artifact wiring", () => {
  it("derives runtime pid path from BP_DATA_DIR and the local orchestrator writes it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bp-co-"));
    const proc = {
      pid: 5555,
      on() {
        return this;
      },
      kill() {
        return true;
      },
    };
    const orch = createOrchestrator({
      mode: "local",
      env: { BP_DATA_DIR: dir },
      local: {
        runtimeServerPath: "/s.js",
        spawnFn: () => proc as never,
        healthProbe: async () => true,
        sleep: async () => {},
      },
    });
    await orch.ensureRuntime();
    expect(existsSync(join(dir, ".runtime", "runtime.pid"))).toBe(true);
  });
});
