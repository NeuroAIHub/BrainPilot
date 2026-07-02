/**
 * Boot-time session restore. `SessionManager.restoreFromDisk` scans
 * `<dataRoot>/.bp/<id>/meta.json` for every persisted session id and rebuilds
 * the in-memory session list with the persisted timestamps intact (the
 * restore path skips `writeMeta` so the canonical file is not clobbered with
 * boot-time values).
 *
 * The `startServer` integration test in server.test.ts asserts the same
 * behavior end-to-end via `GET /sessions` after boot.
 */
import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "../session-manager.js";
import { mockAgentFactory } from "../agent-factory.js";

async function writeMeta(
  dataRoot: string,
  id: string,
  meta: Record<string, unknown>,
): Promise<string> {
  const dir = join(dataRoot, ".bp", id);
  await mkdir(dir, { recursive: true });
  const path = join(dir, "meta.json");
  await writeFile(path, JSON.stringify(meta, null, 2), "utf8");
  return path;
}

describe("SessionManager.restoreFromDisk", () => {
  it("rehydrates sessions preserving on-disk timestamps", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "bp-restore-"));
    await writeMeta(dataRoot, "11111111-1111-1111-1111-111111111111", {
      id: "11111111-1111-1111-1111-111111111111",
      title: "Old session A",
      createdAt: "2026-06-01T10:00:00.000Z",
      updatedAt: "2026-06-02T11:00:00.000Z",
      lastActivityAt: 1780000000000,
    });
    await writeMeta(dataRoot, "22222222-2222-2222-2222-222222222222", {
      id: "22222222-2222-2222-2222-222222222222",
      title: "Old session B",
      createdAt: "2026-05-20T09:00:00.000Z",
      updatedAt: "2026-05-21T12:30:00.000Z",
      lastActivityAt: 1779000000000,
    });

    const m = new SessionManager({
      dataRoot,
      persist: true,
      agentFactory: mockAgentFactory,
    });
    const restored = await m.restoreFromDisk();
    expect(restored.sort()).toEqual([
      "11111111-1111-1111-1111-111111111111",
      "22222222-2222-2222-2222-222222222222",
    ]);

    const sessions = m.listSessions();
    expect(sessions).toHaveLength(2);
    const a = sessions.find((s) => s.id === "11111111-1111-1111-1111-111111111111")!;
    expect(a.title).toBe("Old session A");
    expect(a.createdAt).toBe("2026-06-01T10:00:00.000Z");
    expect(a.updatedAt).toBe("2026-06-02T11:00:00.000Z");
    const b = sessions.find((s) => s.id === "22222222-2222-2222-2222-222222222222")!;
    expect(b.createdAt).toBe("2026-05-20T09:00:00.000Z");
    expect(b.updatedAt).toBe("2026-05-21T12:30:00.000Z");
  });

  it("does NOT rewrite meta.json on restore", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "bp-restore-"));
    const metaPath = await writeMeta(dataRoot, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", {
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      title: "Untouched",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      lastActivityAt: 1770000000000,
    });
    const before = await readFile(metaPath, "utf8");
    const beforeMtime = (await stat(metaPath)).mtimeMs;

    // tiny sleep so any rewrite would change mtimeMs at filesystem resolution
    await new Promise((r) => setTimeout(r, 50));

    const m = new SessionManager({
      dataRoot,
      persist: true,
      agentFactory: mockAgentFactory,
    });
    await m.restoreFromDisk();

    const after = await readFile(metaPath, "utf8");
    const afterMtime = (await stat(metaPath)).mtimeMs;
    expect(after).toBe(before);
    expect(afterMtime).toBe(beforeMtime);
  });

  it("is idempotent — second call is a no-op", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "bp-restore-"));
    await writeMeta(dataRoot, "cccccccc-cccc-cccc-cccc-cccccccccccc", {
      id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      title: "Once",
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-02T00:00:00.000Z",
      lastActivityAt: 1771000000000,
    });
    const m = new SessionManager({
      dataRoot,
      persist: true,
      agentFactory: mockAgentFactory,
    });
    const first = await m.restoreFromDisk();
    expect(first).toHaveLength(1);
    const second = await m.restoreFromDisk();
    expect(second).toEqual([]);
    expect(m.listSessions()).toHaveLength(1);
    // Timestamps still original after the second pass
    expect(m.listSessions()[0]!.createdAt).toBe("2026-03-01T00:00:00.000Z");
  });

  it("returns empty when .bp/ does not exist", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "bp-restore-"));
    const m = new SessionManager({
      dataRoot,
      persist: true,
      agentFactory: mockAgentFactory,
    });
    await expect(m.restoreFromDisk()).resolves.toEqual([]);
  });

  it("skips entries with missing or malformed meta.json", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "bp-restore-"));
    // no meta.json
    await mkdir(join(dataRoot, ".bp", "no-meta"), { recursive: true });
    // malformed json
    const broken = join(dataRoot, ".bp", "broken");
    await mkdir(broken, { recursive: true });
    await writeFile(join(broken, "meta.json"), "{not valid json", "utf8");
    // valid
    await writeMeta(dataRoot, "dddddddd-dddd-dddd-dddd-dddddddddddd", {
      id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
      title: "Good",
      createdAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-02-02T00:00:00.000Z",
      lastActivityAt: 1772000000000,
    });

    const m = new SessionManager({
      dataRoot,
      persist: true,
      agentFactory: mockAgentFactory,
    });
    const restored = await m.restoreFromDisk();
    expect(restored).toEqual(["dddddddd-dddd-dddd-dddd-dddddddddddd"]);
  });

  it("backfills missing timestamp fields without crashing", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "bp-restore-"));
    await writeMeta(dataRoot, "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee", {
      id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
      title: "Legacy meta missing fields",
    });
    const m = new SessionManager({
      dataRoot,
      persist: true,
      agentFactory: mockAgentFactory,
    });
    await m.restoreFromDisk();
    const s = m.listSessions()[0]!;
    expect(s.id).toBe("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee");
    expect(typeof s.createdAt).toBe("string");
    expect(typeof s.updatedAt).toBe("string");
  });

  // #242: restoring an old session must NOT freeze the process-level liveness
  // metric at the session's stale on-disk time — otherwise a hosted reaper doing
  // `now - metrics.lastActivityAt` mis-kills a freshly-restarted container.
  it("resets process-level /metrics.lastActivityAt to ~now on restore (not stale disk time)", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "bp-restore-"));
    const staleMs = Date.parse("2020-01-01T00:00:00.000Z"); // years ago
    await writeMeta(dataRoot, "ffffffff-ffff-ffff-ffff-ffffffffffff", {
      id: "ffffffff-ffff-ffff-ffff-ffffffffffff",
      title: "Stale session",
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
      lastActivityAt: staleMs,
    });
    const before = Date.now();
    const m = new SessionManager({ dataRoot, persist: true, agentFactory: mockAgentFactory });
    await m.restoreFromDisk();

    // Process-level liveness anchor reflects "this process is freshly alive".
    const metricTs = Date.parse(m.metrics().lastActivityAt!);
    expect(metricTs).toBeGreaterThanOrEqual(before);
    expect(metricTs).toBeGreaterThan(staleMs);

    // Per-session historical timestamps are still preserved (UI/history intact).
    const s = m.listSessions().find((x) => x.id === "ffffffff-ffff-ffff-ffff-ffffffffffff")!;
    expect(s.createdAt).toBe("2020-01-01T00:00:00.000Z");
    expect(s.updatedAt).toBe("2020-01-01T00:00:00.000Z");
  });
});
