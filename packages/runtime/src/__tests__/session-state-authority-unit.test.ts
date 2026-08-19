import { describe, expect, it, vi } from "vitest";
import { SessionStateAuthority } from "../session-state-authority.js";

describe("SessionStateAuthority", () => {
  it("moves from idle to active and settles through a stable idle pass", () => {
    let active = false;
    const scheduled: Array<() => void> = [];
    const authority = new SessionStateAuthority({
      inspect: () => ({ active }),
      publish: vi.fn(),
      persist: vi.fn(),
      schedule: (callback) => scheduled.push(callback),
    });

    expect(authority.snapshot()).toEqual({ active: false, status: "idle", epoch: 0 });
    authority.beginEpoch();
    expect(authority.snapshot()).toEqual({ active: true, status: "active", epoch: 1 });

    authority.changed();
    expect(authority.snapshot().status).toBe("active");
    expect(scheduled).toHaveLength(1);
    scheduled.shift()!();
    expect(authority.snapshot()).toEqual({ active: false, status: "idle", epoch: 1 });
  });

  it("invalidates an idle candidate when a handoff appears", () => {
    let active = false;
    const scheduled: Array<() => void> = [];
    const authority = new SessionStateAuthority({
      inspect: () => ({ active }),
      publish: vi.fn(),
      persist: vi.fn(),
      schedule: (callback) => scheduled.push(callback),
    });
    authority.beginEpoch();
    authority.changed();

    active = true;
    authority.changed();
    scheduled.shift()!();
    expect(authority.snapshot()).toEqual({ active: true, status: "active", epoch: 1 });
  });

  it("treats dormant work as idle and a live wait as active", () => {
    let active = false;
    const scheduled: Array<() => void> = [];
    const authority = new SessionStateAuthority({
      inspect: () => ({ active }),
      publish: vi.fn(),
      persist: vi.fn(),
      schedule: (callback) => scheduled.push(callback),
    });
    authority.beginEpoch();
    authority.changed();
    scheduled.shift()!();
    expect(authority.snapshot().status).toBe("idle");

    active = true;
    authority.changed();
    expect(authority.snapshot().status).toBe("active");
  });

  it("restores a sandbox idle without changing its epoch", async () => {
    const persist = vi.fn();
    const authority = new SessionStateAuthority({
      restored: { epoch: 4 },
      inspect: () => ({ active: false }),
      publish: vi.fn(),
      persist,
    });
    await authority.recoverAfterRestart();
    expect(authority.snapshot()).toEqual({ active: false, status: "idle", epoch: 4 });
    expect(persist).toHaveBeenLastCalledWith({ epoch: 4 });
  });
});
