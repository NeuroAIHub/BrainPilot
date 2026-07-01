import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  up,
  buildStartServerOptions,
  resolveUpMode,
  PortInUseError,
  PortPermissionError,
  portFlagHint,
  type ResolvedUpConfig,
} from "./up.js";
import { readPid, readServerState } from "../process-control.js";
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
      mode: "local",
    };
    const opts = buildStartServerOptions(cfg);
    expect(opts).toMatchObject({
      port: 9001,
      hostname: "127.0.0.1",
      dataDir: "/data",
      serveWeb: true,
      webRoot: "/web/dist",
      mode: "local",
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
      mode: "local",
    };
    const opts = buildStartServerOptions(cfg);
    expect(opts.serveWeb).toBe(false);
    expect("webRoot" in opts).toBe(false);
  });
});

describe("resolveUpMode", () => {
  it("defaults to local with an empty env (the source-launch default)", () => {
    expect(resolveUpMode(undefined, {})).toBe("local");
  });

  it("IGNORES a stray BP_RUNTIME_URL — the core fix (no accidental sandbox)", () => {
    // A leftover BP_RUNTIME_URL from a `docker compose` session must NOT flip a
    // source launch into static mode. The backend's env resolver would; the CLI
    // resolver deliberately does not.
    expect(resolveUpMode(undefined, { BP_RUNTIME_URL: "http://sandbox:8081" })).toBe("local");
  });

  it("IGNORES a stray BP_MODE=docker", () => {
    expect(resolveUpMode(undefined, { BP_MODE: "docker" })).toBe("local");
  });

  it("honors an explicit --mode option", () => {
    expect(resolveUpMode("static", { BP_RUNTIME_URL: "http://x" })).toBe("static");
    expect(resolveUpMode("docker", {})).toBe("docker");
  });

  it("honors an explicit BP_ORCHESTRATOR when no --mode given", () => {
    expect(resolveUpMode(undefined, { BP_ORCHESTRATOR: "static" })).toBe("static");
    expect(resolveUpMode(undefined, { BP_ORCHESTRATOR: "docker" })).toBe("docker");
  });

  it("--mode wins over BP_ORCHESTRATOR", () => {
    expect(resolveUpMode("local", { BP_ORCHESTRATOR: "static" })).toBe("local");
  });
});

describe("up — provider key resolution", () => {
  it("warns but still starts when no key anywhere", async () => {
    const root = join(dir, "brainpilot");
    let started = false;
    const logs: string[] = [];
    const result = await up(
      { dir: root, port: 9810, foreground: true, open: false },
      {
        env: {}, // no ANTHROPIC_API_KEY
        startServer: async () => {
          started = true;
          return { stop: async () => {} } as unknown as RunningServer;
        },
        isPortFree: freePorts(),
        webDist: () => null,
        log: (m) => logs.push(m),
      },
    );
    expect(started).toBe(true);
    expect(result.url).toBe("http://127.0.0.1:9810");
    // a warning pointing users at how to configure the key
    const text = logs.join("\n");
    expect(text).toContain("No provider API key configured");
    expect(text).toContain("Settings UI");
  });

  it("scaffolds the data dir on first launch", async () => {
    const root = join(dir, "brainpilot");
    await up(
      { dir: root, port: 9811, foreground: true, open: false },
      {
        env: {},
        startServer: async () =>
          ({ stop: async () => {} }) as unknown as RunningServer,
        isPortFree: freePorts(),
        webDist: () => null,
        log: () => {},
      },
    );
    const cfg = JSON.parse(
      await readFile(join(root, "brainpilot.config.json"), "utf8"),
    );
    expect(cfg.port).toBeGreaterThan(0);
  });

  it("flashes a drift banner when on-disk agent prompts diverge from built-ins (#102)", async () => {
    const root = join(dir, "brainpilot");
    // Pre-scaffold via a stub override that doesn't match any built-in.
    await mkdir(join(root, "bp_template", "agents", "principal"), { recursive: true });
    await writeFile(
      join(root, "bp_template", "agents", "principal", "prompt.md"),
      "USER CUSTOMISED PROMPT\n",
      "utf8",
    );
    const logs: string[] = [];
    await up(
      { dir: root, port: 9890, foreground: true, open: false },
      {
        env: { BP_MOCK: "1" },
        startServer: async () =>
          ({ stop: async () => {} }) as unknown as RunningServer,
        isPortFree: freePorts(),
        webDist: () => null,
        log: (m) => logs.push(m),
      },
    );
    const text = logs.join("\n");
    expect(text).toContain("on-disk agent prompt override");
    expect(text).toContain("principal");
    expect(text).toContain("template reset");
  });

  it("does NOT flash the drift banner when no overrides exist", async () => {
    const root = join(dir, "brainpilot");
    const logs: string[] = [];
    await up(
      { dir: root, port: 9891, foreground: true, open: false },
      {
        env: { BP_MOCK: "1" },
        startServer: async () =>
          ({ stop: async () => {} }) as unknown as RunningServer,
        isPortFree: freePorts(),
        webDist: () => null,
        log: (m) => logs.push(m),
      },
    );
    expect(logs.join("\n")).not.toContain("on-disk agent prompt override");
  });

  it("skips the key warning under BP_MOCK=1 (no key needed)", async () => {
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

describe("up — port precheck (#201)", () => {
  const startNoop = async () =>
    ({ stop: async () => {} }) as unknown as RunningServer;

  it("throws PortInUseError when the probe reports the port taken", async () => {
    const root = join(dir, "bp");
    await expect(
      up(
        { dir: root, port: 9820, foreground: true, open: false },
        {
          env: { BP_MOCK: "1" },
          startServer: startNoop,
          isPortFree: async () => false,
          webDist: () => null,
          log: () => {},
        },
      ),
    ).rejects.toBeInstanceOf(PortInUseError);
  });

  it("translates an EPERM bind rejection into a PortPermissionError, not 'in use'", async () => {
    const root = join(dir, "bp");
    const eperm = Object.assign(new Error("listen EPERM"), { code: "EPERM" });
    let err: unknown;
    try {
      await up(
        { dir: root, port: 9821, foreground: true, open: false },
        {
          env: { BP_MOCK: "1" },
          startServer: startNoop,
          isPortFree: async () => {
            throw eperm;
          },
          webDist: () => null,
          log: () => {},
        },
      );
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(PortPermissionError);
    expect(err).not.toBeInstanceOf(PortInUseError);
    const msg = (err as Error).message;
    expect(msg).toContain("EPERM");
    expect(msg).toContain("environment");
    expect(msg).not.toContain("already in use");
  });

  it("maps EACCES to PortPermissionError too", async () => {
    const root = join(dir, "bp");
    const eacces = Object.assign(new Error("listen EACCES"), { code: "EACCES" });
    await expect(
      up(
        { dir: root, port: 9822, foreground: true, open: false },
        {
          env: { BP_MOCK: "1" },
          startServer: startNoop,
          isPortFree: async () => {
            throw eacces;
          },
          webDist: () => null,
          log: () => {},
        },
      ),
    ).rejects.toBeInstanceOf(PortPermissionError);
  });

  it("re-throws an unexpected bind errno unchanged (neither in-use nor permission)", async () => {
    const root = join(dir, "bp");
    const weird = Object.assign(new Error("listen ENOTFOUND"), {
      code: "ENOTFOUND",
    });
    let err: unknown;
    try {
      await up(
        { dir: root, port: 9823, foreground: true, open: false },
        {
          env: { BP_MOCK: "1" },
          startServer: startNoop,
          isPortFree: async () => {
            throw weird;
          },
          webDist: () => null,
          log: () => {},
        },
      );
    } catch (e) {
      err = e;
    }
    expect(err).toBe(weird);
    expect(err).not.toBeInstanceOf(PortPermissionError);
    expect(err).not.toBeInstanceOf(PortInUseError);
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
      // #171: the prechecked runtime port (port + 1) must reach the backend,
      // not just be computed into result.config.
      runtimePort: 9501,
    });
    expect(result.server).toBe(fakeServer);
    expect(result.url).toBe("http://127.0.0.1:9500");
    expect(result.config.runtimePort).toBe(9501);
  });

  it("forces mode=local and prints a local banner even with a stray BP_RUNTIME_URL", async () => {
    const root = join(dir, "bp");
    let captured: StartServerOptions | undefined;
    const logs: string[] = [];
    await up(
      { dir: root, port: 9550, foreground: true, open: false },
      {
        env: { ANTHROPIC_API_KEY: "sk", BP_RUNTIME_URL: "http://sandbox:8081" },
        startServer: async (opts) => {
          captured = opts;
          return { stop: async () => {} } as unknown as RunningServer;
        },
        isPortFree: freePorts(),
        webDist: () => null,
        log: (m) => logs.push(m),
      },
    );
    // The stray BP_RUNTIME_URL must NOT have flipped us into static mode.
    expect(captured?.mode).toBe("local");
    expect(logs.join("\n")).toContain("mode=local");
  });

  it("passes mode=static and warns when --mode static is explicit", async () => {
    const root = join(dir, "bp");
    let captured: StartServerOptions | undefined;
    const logs: string[] = [];
    await up(
      { dir: root, port: 9560, foreground: true, open: false, mode: "static" },
      {
        env: { ANTHROPIC_API_KEY: "sk", BP_RUNTIME_URL: "http://sandbox:8081" },
        startServer: async (opts) => {
          captured = opts;
          return { stop: async () => {} } as unknown as RunningServer;
        },
        isPortFree: freePorts(),
        webDist: () => null,
        log: (m) => logs.push(m),
      },
    );
    expect(captured?.mode).toBe("static");
    const text = logs.join("\n");
    expect(text).toContain("mode=static");
    expect(text).toContain("--mode");
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
    // issue #41: detached up persists resolved ports for `status`.
    const state = await readServerState(join(root, ".runtime", "server.json"));
    expect(state).toEqual({ pid: 4242, port: 9700, runtimePort: 9701, host: "127.0.0.1" });
  });
});

describe("portFlagHint", () => {
  it("returns the bare `brainpilot up --port <n>` form when not run via npm", () => {
    expect(portFlagHint({})).toBe("brainpilot up --port <n>");
  });

  it("returns `npm run <script> -- up --port <n>` when npm_lifecycle_event is set", () => {
    // The `up` subcommand has to come *after* `--`, since the npm script
    // itself only runs `node bin.js` — without `up` the CLI defaults to a
    // different command and never reaches the port path.
    expect(portFlagHint({ npm_lifecycle_event: "bp" })).toBe(
      "npm run bp -- up --port <n>",
    );
    expect(portFlagHint({ npm_lifecycle_event: "start" })).toBe(
      "npm run start -- up --port <n>",
    );
  });

  it("ignores the `npx` script name (npx sets npm_lifecycle_event=npx)", () => {
    expect(portFlagHint({ npm_lifecycle_event: "npx" })).toBe(
      "brainpilot up --port <n>",
    );
  });
});

describe("PortInUseError", () => {
  it("includes the supplied hint in the message", () => {
    const e = new PortInUseError(9001, "npm run bp -- up --port <n>");
    expect(e.message).toContain("Port 9001 is already in use.");
    expect(e.message).toContain("`npm run bp -- up --port <n>`");
  });

  it("falls back to the default hint when none supplied", () => {
    const e = new PortInUseError(9001);
    // Default form starts with either `brainpilot` or `npm run` — depends on
    // the test runner's own env. Just assert the port and a backtick are there.
    expect(e.message).toContain("Port 9001 is already in use.");
    expect(e.message).toMatch(/`[^`]+--port <n>`/);
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
