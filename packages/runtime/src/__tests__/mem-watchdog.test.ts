import { describe, it, expect } from "vitest";
import { MemWatchdog, parseMemLimitMb } from "../mem-watchdog.js";

describe("parseMemLimitMb", () => {
  it("parses a positive MB value to bytes", () => {
    expect(parseMemLimitMb({ BP_MEM_LIMIT_MB: "2048" })).toBe(2048 * 1024 * 1024);
    expect(parseMemLimitMb({ BP_MEM_LIMIT_MB: "1" })).toBe(1024 * 1024);
  });

  it("treats unset / empty / non-positive / unparseable as disabled (null)", () => {
    expect(parseMemLimitMb({})).toBeNull();
    expect(parseMemLimitMb({ BP_MEM_LIMIT_MB: "" })).toBeNull();
    expect(parseMemLimitMb({ BP_MEM_LIMIT_MB: "   " })).toBeNull();
    expect(parseMemLimitMb({ BP_MEM_LIMIT_MB: "0" })).toBeNull();
    expect(parseMemLimitMb({ BP_MEM_LIMIT_MB: "-512" })).toBeNull();
    expect(parseMemLimitMb({ BP_MEM_LIMIT_MB: "abc" })).toBeNull();
  });
});

describe("MemWatchdog", () => {
  const LIMIT = 1000;

  it("isOverSoftLimit honors the 85% threshold", () => {
    let rss = 0;
    const wd = new MemWatchdog({ limitBytes: LIMIT, readRss: () => rss });
    rss = 840; // below 85% of 1000
    expect(wd.isOverSoftLimit()).toBe(false);
    rss = 850; // exactly at the threshold
    expect(wd.isOverSoftLimit()).toBe(true);
    rss = 999;
    expect(wd.isOverSoftLimit()).toBe(true);
  });

  it("snapshot reports rss, limit, and ratio", () => {
    const wd = new MemWatchdog({ limitBytes: LIMIT, readRss: () => 500 });
    expect(wd.snapshot()).toEqual({ limitBytes: LIMIT, rss: 500, ratio: 0.5 });
  });

  it("fires onThrottle once on the rising edge, not every tick", () => {
    let rss = 100;
    const fired: number[] = [];
    const wd = new MemWatchdog({
      limitBytes: LIMIT,
      readRss: () => rss,
      onThrottle: (s) => fired.push(s.rss),
    });

    wd.tick(); // under threshold -> no fire
    expect(fired).toHaveLength(0);

    rss = 900; // cross the threshold
    wd.tick();
    wd.tick(); // still over -> must NOT re-fire
    expect(fired).toEqual([900]);

    rss = 100; // fall back below -> re-arm
    wd.tick();
    rss = 950; // spike again -> fires once more
    wd.tick();
    expect(fired).toEqual([900, 950]);
  });

  it("start/stop is idempotent and does not hold the event loop", () => {
    const wd = new MemWatchdog({ limitBytes: LIMIT, readRss: () => 0, pollMs: 10 });
    wd.start();
    wd.start(); // no double timer
    wd.stop();
    wd.stop(); // safe to call twice
  });
});
