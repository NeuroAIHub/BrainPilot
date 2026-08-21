import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MONITOR_MAX_LINE_BYTES,
  MonitorManager,
  monitorEnvironment,
  type MonitorEventBatch,
  type MonitorInfo,
} from "../monitor-manager.js";

function nodeCommand(source: string): string {
  return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(source)}`;
}

async function waitFor(predicate: () => boolean, timeoutMs = 4_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for monitor state");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function fixture() {
  const batches: MonitorEventBatch[] = [];
  const states: MonitorInfo[] = [];
  const cwd = await mkdtemp(join(tmpdir(), "bp-monitor-"));
  const manager = new MonitorManager({
    cwd,
    onEvents: (batch) => { batches.push(batch); return true; },
    onState: (state) => states.push(state),
  });
  return { manager, batches, states, cwd };
}

describe("MonitorManager", () => {
  it("executes logical /workspace paths in the session cwd without exposing the host path", async () => {
    const { manager, cwd } = await fixture();
    const logicalCommand = nodeCommand("require('node:fs').writeFileSync('/workspace/background.txt', 'BACKGROUND_OK')");
    manager.start({
      ownerAgent: "engineer",
      description: "managed workspace output",
      command: logicalCommand,
      timeoutMs: 2_000,
    });
    await waitFor(() => manager.list()[0]?.finishedAt !== undefined);

    await expect(readFile(join(cwd, "background.txt"), "utf8")).resolves.toBe("BACKGROUND_OK");
    expect(manager.list()[0]).toMatchObject({ status: "completed", command: logicalCommand });
    expect(manager.list()[0]?.command).not.toContain(cwd);
  });

  it("batches stdout lines and never promotes stderr to an event", async () => {
    const { manager, batches } = await fixture();
    const monitor = manager.start({
      ownerAgent: "engineer",
      description: "test output",
      command: nodeCommand("console.log('one'); console.log('two'); console.error('diagnostic')"),
      timeoutMs: 2_000,
    });
    await waitFor(() => manager.list()[0]?.finishedAt !== undefined);
    expect(batches.flatMap((batch) => batch.lines)).toEqual(["one", "two"]);
    expect(manager.list()[0]).toMatchObject({
      id: monitor.id,
      status: "completed",
      stderr: expect.stringContaining("diagnostic"),
    });
  });

  it("spends no event callback on a silent command", async () => {
    const { manager, batches } = await fixture();
    manager.start({
      ownerAgent: "principal",
      description: "silent",
      command: nodeCommand("setTimeout(() => {}, 20)"),
      timeoutMs: 2_000,
    });
    await waitFor(() => manager.list()[0]?.finishedAt !== undefined);
    expect(batches).toEqual([]);
  });

  it("emits one terminal event for a silent finite background job", async () => {
    const { manager, batches } = await fixture();
    manager.start({
      ownerAgent: "engineer",
      description: "silent background job",
      command: nodeCommand("setTimeout(() => {}, 20)"),
      timeoutMs: 2_000,
      notifyOnExit: true,
    });
    await waitFor(() => manager.list()[0]?.finishedAt !== undefined);

    expect(batches).toHaveLength(1);
    expect(batches[0]?.lines).toContain("Background job completed successfully.");
  });

  it("delivers bounded stderr diagnostics when a background job fails", async () => {
    const { manager, batches } = await fixture();
    manager.start({
      ownerAgent: "engineer",
      description: "failing background job",
      command: nodeCommand("console.error('failure detail'); process.exit(7)"),
      timeoutMs: 2_000,
      notifyOnExit: true,
    });
    await waitFor(() => manager.list()[0]?.finishedAt !== undefined);

    expect(batches).toHaveLength(1);
    expect(batches[0]?.lines).toEqual(expect.arrayContaining([
      "Background job ended with status: failed.",
      "Exit code: 7.",
      "Stderr summary: failure detail",
    ]));
  });

  it("times out a bounded monitor and can stop a persistent monitor", async () => {
    const first = await fixture();
    first.manager.start({
      ownerAgent: "principal",
      description: "timeout",
      command: nodeCommand("setInterval(() => {}, 1000)"),
      timeoutMs: 30,
    });
    await waitFor(() => first.manager.list()[0]?.finishedAt !== undefined);
    expect(first.manager.list()[0]?.status).toBe("timed_out");

    const second = await fixture();
    const persistent = second.manager.start({
      ownerAgent: "experimentalist",
      description: "persistent",
      command: nodeCommand("setInterval(() => {}, 1000)"),
      persistent: true,
    });
    expect(await second.manager.stop(persistent.id, "experimentalist")).toBe(true);
    expect(second.manager.list()[0]?.finishedAt).toBeDefined();
  });

  it("force-kills a timed-out command that ignores SIGTERM", async () => {
    const { manager, batches } = await fixture();
    manager.start({
      ownerAgent: "principal",
      description: "ignore term",
      command: nodeCommand("console.log(process.pid); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"),
      timeoutMs: 800,
    });
    await waitFor(() => batches.length > 0);
    const pid = Number(batches[0]?.lines[0]);
    expect(Number.isInteger(pid)).toBe(true);
    try {
      await waitFor(() => !processIsAlive(pid), 2_500);
      expect(manager.list()[0]?.status).toBe("timed_out");
    } finally {
      if (processIsAlive(pid)) process.kill(pid, "SIGKILL");
    }
  });

  it("stops a monitor that emits an oversized line", async () => {
    const { manager } = await fixture();
    manager.start({
      ownerAgent: "engineer",
      description: "oversized",
      command: nodeCommand(`process.stdout.write('x'.repeat(${MONITOR_MAX_LINE_BYTES + 1}))`),
      timeoutMs: 2_000,
    });
    await waitFor(() => manager.list()[0]?.finishedAt !== undefined);
    expect(manager.list()[0]).toMatchObject({
      status: "flooded",
      stderr: expect.stringContaining("exceeded"),
    });
  });

  it("scrubs credential-like environment variables", () => {
    expect(monitorEnvironment({ PATH: "/bin", API_KEY: "secret", SESSION_TOKEN: "secret" })).toEqual({ PATH: "/bin" });
  });
});
