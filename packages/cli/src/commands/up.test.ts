import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  up,
  buildStartServerOptions,
  ProviderKeyError,
  PortInUseError,
  type ResolvedUpConfig,
} from "./up.js";
import { readPid } from "../process-control.js";
import type { StartServerOptions, RunningServer } from "@brainpilot/backend-core";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "bp-up-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const freePorts = () => async () => true;

describe("buildStartServerOptions", () => {
  it("maps the resolved config to StartServerOptions", () => {
    const cfg: ResolvedUpConfig = {
      dataDir: "/data",
      port: 9001,
      runtimePort: 9002,
      host: "127.0.0.1",
      webDist: "/web/dist",
      foreground: true,
      open: false,
    };
    const opts = buildStartServerOptions(cfg);
    expect(opts).toMatchObject({
      port: 9001,
      hostname: "127.0.0.1",
      dataDir: "/data",
      serveWeb: true,
      webRoot: "/web/dist",
    });
  });

  it("omits webRoot + disables serveWeb when no web dist", () => {
    const cfg: ResolvedUpConfig = {
      dataDir: "/d",
      port: 9001,
      runtimePort: 9002,
      host: "127.0.0.1",
      webDist: null,
      foreground: true,
      open: false,
    };
    const opts = buildStartServerOptions(cfg);
    expect(opts.serveWeb).toBe(false);
    expect("webRoot" in opts).toBe(false);
  });
});

describe("up — provider key resolution", () => {
  it("throws ProviderKeyError when no key anywhere", async () => {
    const root = join(dir, "brainpilot");
    await expect(
      up(
        { dir: root, foreground: true, open: false },
        {
          env: {}, // no ANTHROPIC_API_KEY
          startServer: async () => {
            throw new Error("should not start");
          },
          isPortFree: freePorts(),
          webDist: () => null,
          log: () => {},
        },
      ),
    ).rejects.toBeInstanceOf(ProviderKeyError);
  });

  it("scaffolds before failing on the missing key", async () => {
    const root = join(dir, "brainpilot");
    await up(
      { dir: root, foreground: true, open: false },
      { env: {}, isPortFree: freePorts(), webDist: () => null, log: () => {} },
    ).catch(() => {});
    // scaffold ran even though provider check failed afterward.
    const cfg = JSON.parse(
      await readFile(join(root, "brainpilot.config.json"), "utf8"),
    );
    expect(cfg.port).toBeGreaterThan(0);
  });

  it("skips the key check under BP_MOCK=1 (no key needed)", async () => {
    const root = join(dir, "brainpilot");
    let started = false;
    const result = await up(
      { dir: root, port: 9800, foreground: true, open: false },
      {
        env: { BP_MOCK: "1" }, // no ANTHROPIC_API_KEY
        startServer: async () => {
          started = true;
          return { stop: async () => {} } as unknown as RunningServer;
        },
        isPortFree: freePorts(),
        webDist: () => null,
        log: () => {},
      },
    );
    expect(started).toBe(true);
    expect(result.url).toBe("http://127.0.0.1:9800");
  });
});

describe("up — foreground start", () => {
  it("builds correct startServer options + returns the server handle", async () => {
    const root = join(dir, "bp");
    let captured: StartServerOptions | undefined;
    const fakeServer = { stop: async () => {} } as unknown as RunningServer;

    const result = await up(
      { dir: root, port: 9500, foreground: true, open: false },
      {
        env: { ANTHROPIC_API_KEY: "sk-test" },
        startServer: async (opts) => {
          captured = opts;
          return fakeServer;
        },
        isPortFree: freePorts(),
        webDist: () => "/web/dist",
        log: () => {},
      },
    );

    expect(captured).toMatchObject({
      port: 9500,
      dataDir: root,
      serveWeb: true,
      webRoot: "/web/dist",
    });
    expect(result.server).toBe(fakeServer);
    expect(result.url).toBe("http://127.0.0.1:9500");
    expect(result.config.runtimePort).toBe(9501);
  });

  it("calls the browser-open hook when open=true", async () => {
    const root = join(dir, "bp");
    let opened: string | undefined;
    await up(
      { dir: root, port: 9600, foreground: true, open: true },
      {
        env: { ANTHROPIC_API_KEY: "sk" },
        startServer: async () => ({ stop: async () => {} }) as unknown as RunningServer,
        isPortFree: freePorts(),
        webDist: () => null,
        openBrowser: async (u) => {
          opened = u;
        },
        log: () => {},
      },
    );
    expect(opened).toBe("http://127.0.0.1:9600");
  });
});

describe("up — detached start", () => {
  it("spawns a detached backend and writes a pid file", async () => {
    const root = join(dir, "bp");
    const result = await up(
      { dir: root, port: 9700, foreground: false, open: false },
      {
        env: { ANTHROPIC_API_KEY: "sk" },
        spawnDetached: async () => 4242,
        isPortFree: freePorts(),
        webDist: () => null,
        log: () => {},
      },
    );
    expect(result.pid).toBe(4242);
    const pidFromFile = await readPid(join(root, ".runtime", "backend.pid"));
    expect(pidFromFile).toBe(4242);
  });
});

describe("up — port pre-check", () => {
  it("throws PortInUseError when the backend port is taken", async () => {
    const root = join(dir, "bp");
    await expect(
      up(
        { dir: root, port: 9001, foreground: true, open: false },
        {
          env: { ANTHROPIC_API_KEY: "sk" },
          startServer: async () => ({ stop: async () => {} }) as unknown as RunningServer,
          isPortFree: async (p) => p !== 9001, // backend port busy
          webDist: () => null,
          log: () => {},
        },
      ),
    ).rejects.toBeInstanceOf(PortInUseError);
  });

  it("throws PortInUseError when the runtime port is taken", async () => {
    const root = join(dir, "bp");
    await expect(
      up(
        { dir: root, port: 9001, foreground: true, open: false },
        {
          env: { ANTHROPIC_API_KEY: "sk" },
          startServer: async () => ({ stop: async () => {} }) as unknown as RunningServer,
          isPortFree: async (p) => p !== 9002, // runtime port busy
          webDist: () => null,
          log: () => {},
        },
      ),
    ).rejects.toBeInstanceOf(PortInUseError);
  });
});
