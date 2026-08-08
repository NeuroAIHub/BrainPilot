import { mkdtemp } from "node:fs/promises";
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

async function fixture() {
  const batches: MonitorEventBatch[] = [];
  const states: MonitorInfo[] = [];
  const manager = new MonitorManager({
    cwd: await mkdtemp(join(tmpdir(), "bp-monitor-")),
    onEvents: (batch) => { batches.push(batch); return true; },
    onState: (state) => states.push(state),
  });
  return { manager, batches, states };
}

describe("MonitorManager", () => {
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

  it("defaults finite monitors to blocking and persistent monitors to background", async () => {
    const finite = await fixture();
    finite.manager.start({
      ownerAgent: "engineer",
      description: "finite",
      command: nodeCommand("setTimeout(() => {}, 50)"),
    });
    expect(finite.manager.list()[0]?.blocking).toBe(true);
    expect(finite.manager.hasBlocking()).toBe(true);
    await finite.manager.stopAll();

    const persistent = await fixture();
    persistent.manager.start({
      ownerAgent: "engineer",
      description: "subscription",
      command: nodeCommand("setInterval(() => {}, 1000)"),
      persistent: true,
    });
    expect(persistent.manager.list()[0]?.blocking).toBe(false);
    expect(persistent.manager.hasBlocking()).toBe(false);
    await persistent.manager.stopAll();
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
