import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceCheckpointStore } from "../workspace-checkpoints.js";

const roots: string[] = [];

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "bp-checkpoints-test-"));
  roots.push(root);
  const workspace = join(root, "workspaces", "s1");
  const state = join(root, ".bp", "s1");
  await mkdir(workspace, { recursive: true });
  return { root, workspace, state, store: new WorkspaceCheckpointStore("s1", workspace, state) };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
describe("WorkspaceCheckpointStore", () => {
  it("captures ordered commits, honours gitignore, and returns per-file diffs", async () => {
    const { workspace, store } = await fixture();
    await writeFile(join(workspace, ".gitignore"), "ignored.txt\n", "utf8");
    await writeFile(join(workspace, "note.txt"), "one\n", "utf8");
    await writeFile(join(workspace, "ignored.txt"), "secret\n", "utf8");

    const first = await store.capture("principal");
    expect(first.status).toBe("partial");
    expect(first.commitId).toMatch(/^[a-f0-9]{40}$/);
    expect(first.stats?.added).toBe(2);

    await writeFile(join(workspace, "note.txt"), "one\ntwo\n", "utf8");
    await writeFile(join(workspace, "new.txt"), "new\n", "utf8");
    const second = await store.capture("engineer");
    expect(second.baseCheckpointId).toBe(first.id);
    expect(second.commitId).not.toBe(first.commitId);
    expect(second.stats).toMatchObject({ added: 1, modified: 1 });

    const detail = await store.detail(second.id);
    expect(detail?.files.map((item) => [item.path, item.status])).toEqual([
      ["new.txt", "added"],
      ["note.txt", "modified"],
    ]);
    expect(await store.diff(second.id, "note.txt")).toContain("+two");
    expect(detail?.skipped.some((item) => item.path === "ignored.txt" && item.reason === "ignored")).toBe(true);
  });

  it("excludes generated environments and bounds provenance expansion", async () => {
    const { workspace, store } = await fixture();
    await mkdir(join(workspace, ".venv", "lib", "python", "site-packages"), { recursive: true });
    await writeFile(join(workspace, ".venv", "pyvenv.cfg"), "home = /usr/bin\n", "utf8");
    for (let i = 0; i < 20; i++) {
      await writeFile(
        join(workspace, ".venv", "lib", "python", "site-packages", `dependency_${i}.py`),
        `VALUE = ${i}\n`,
        "utf8",
      );
    }
    for (let i = 0; i < 5; i++) {
      await writeFile(join(workspace, `result_${i}.txt`), `${i}\n`, "utf8");
    }

    const checkpoint = await store.capture("engineer");
    expect(checkpoint.stats?.files).toBe(5);
    const detail = await store.detail(checkpoint.id);
    expect(detail?.files.every((item) => !item.path.startsWith(".venv/"))).toBe(true);
    expect(detail?.skipped.filter((item) => item.path.startsWith(".venv/"))).toEqual([
      expect.objectContaining({ path: ".venv/", reason: "internal" }),
    ]);

    const bounded = await store.provenance(checkpoint.id, 2);
    expect(bounded).toHaveLength(2);
    expect(bounded?.every((item) => item.path.startsWith("result_"))).toBe(true);
  });

  it("uses an initial baseline so pre-existing inputs are not trace outputs", async () => {
    const { workspace, store } = await fixture();
    await writeFile(join(workspace, "input.csv"), "subject,value\n1,2\n", "utf8");
    const baseline = await store.ensureBaseline();
    expect(baseline?.stats).toMatchObject({ files: 1, added: 1 });
    expect(await store.ensureBaseline()).toBeUndefined();

    await writeFile(join(workspace, "result.csv"), "score\n0.8\n", "utf8");
    const trace = await store.capture("engineer");
    expect(trace.stats).toMatchObject({ files: 1, added: 1 });
    expect((await store.detail(trace.id))?.files.map((item) => item.path)).toEqual([
      "result.csv",
    ]);
  });
  it("persists experiment and best checkpoint kinds", async () => {
    const { workspace, state, store } = await fixture();
    await writeFile(join(workspace, "benchmark.txt"), "baseline\n", "utf8");
    const baseline = await store.capture("autoresearch-worker", "experiment-best");
    await writeFile(join(workspace, "benchmark.txt"), "candidate\n", "utf8");
    const candidate = await store.capture("autoresearch-worker", "experiment");
    const index = JSON.parse(await readFile(join(state, "workspace-checkpoints.json"), "utf8")) as { checkpoints: Record<string, { kind: string }> };
    expect(index.checkpoints[baseline.id]?.kind).toBe("experiment-best");
    expect(index.checkpoints[candidate.id]?.kind).toBe("experiment");
  });

  it("restores managed files and makes the restored tree the next checkpoint baseline", async () => {
    const { workspace, state, store } = await fixture();
    await writeFile(join(workspace, ".gitignore"), "keep.local\n", "utf8");
    await writeFile(join(workspace, "tracked.txt"), "old\n", "utf8");
    await writeFile(join(workspace, "keep.local"), "untouched\n", "utf8");
    const old = await store.capture("principal");

    await writeFile(join(workspace, "tracked.txt"), "new\n", "utf8");
    await writeFile(join(workspace, "later.txt"), "later\n", "utf8");
    const current = await store.capture("principal");
    expect(current.commitId).toBeTruthy();

    const preview = await store.preview(old.id);
    expect(preview?.files.some((item) => item.path === "later.txt" && item.status === "deleted")).toBe(true);
    let committed = 0;
    await store.restore(old.id, preview!.stateToken, async () => {
      expect(await readFile(join(workspace, "tracked.txt"), "utf8")).toBe("old\n");
      committed++;
    });
    expect(committed).toBe(1);
    expect(await readFile(join(workspace, "tracked.txt"), "utf8")).toBe("old\n");
    await expect(readFile(join(workspace, "later.txt"), "utf8")).rejects.toThrow();
    expect(await readFile(join(workspace, "keep.local"), "utf8")).toBe("untouched\n");

    await writeFile(join(workspace, "after-restore.txt"), "after\n", "utf8");
    const next = await store.capture("writer");
    expect(next.stats).toMatchObject({ files: 1, added: 1, modified: 0, deleted: 0 });
    const index = JSON.parse(await readFile(join(state, "workspace-checkpoints.json"), "utf8")) as {
      checkpoints: Record<string, { kind: string }>;
    };
    expect(next.baseCheckpointId).toBeTruthy();
    expect(index.checkpoints[next.baseCheckpointId!]?.kind).toBe("baseline");
  });

  it("rejects a restore when the workspace changed after preview", async () => {
    const { workspace, store } = await fixture();
    await writeFile(join(workspace, "a.txt"), "a\n", "utf8");
    const target = await store.capture("principal");
    await writeFile(join(workspace, "a.txt"), "b\n", "utf8");
    const preview = await store.preview(target.id);
    await writeFile(join(workspace, "a.txt"), "c\n", "utf8");
    let prepared = false;
    await expect(store.restore(target.id, preview!.stateToken, async () => { prepared = true; })).rejects.toMatchObject({ code: "STALE_WORKSPACE" });
    expect(prepared).toBe(false);
  });

  it("does not commit caller state when the target Git tree cannot materialize", async () => {
    const { workspace, state, store } = await fixture();
    await writeFile(join(workspace, "value.txt"), "old\n", "utf8");
    const target = await store.capture("principal");
    await writeFile(join(workspace, "value.txt"), "current\n", "utf8");
    await store.capture("principal");
    const preview = await store.preview(target.id);
    const index = JSON.parse(await readFile(join(state, "workspace-checkpoints.json"), "utf8")) as {
      checkpoints: Record<string, { treeId: string }>;
    };
    const treeId = index.checkpoints[target.id]!.treeId;
    await rm(join(state, "workspace-checkpoints.git", "objects", treeId.slice(0, 2), treeId.slice(2)), { force: true });

    let committed = false;
    await expect(store.restore(target.id, preview!.stateToken, async () => { committed = true; })).rejects.toThrow();
    expect(committed).toBe(false);
    expect(await readFile(join(workspace, "value.txt"), "utf8")).toBe("current\n");
  });

  it("restores the original workspace when the final commit callback fails", async () => {
    const { workspace, store } = await fixture();
    await writeFile(join(workspace, "value.txt"), "old\n", "utf8");
    const target = await store.capture("principal");
    await writeFile(join(workspace, "value.txt"), "current\n", "utf8");
    await store.capture("principal");
    const preview = await store.preview(target.id);

    await expect(store.restore(target.id, preview!.stateToken, async () => {
      expect(await readFile(join(workspace, "value.txt"), "utf8")).toBe("old\n");
      throw new Error("ledger commit failed");
    })).rejects.toThrow("ledger commit failed");
    expect(await readFile(join(workspace, "value.txt"), "utf8")).toBe("current\n");

    await writeFile(join(workspace, "after-failure.txt"), "after\n", "utf8");
    const next = await store.capture("writer");
    expect(next.stats).toMatchObject({ files: 1, added: 1, modified: 0, deleted: 0 });
  });

  it("marks oversized and binary files correctly and reloads its index after restart", async () => {
    const { workspace, state, store } = await fixture();
    await writeFile(join(workspace, "large.bin"), Buffer.alloc(10 * 1024 * 1024 + 1, 1));
    await writeFile(join(workspace, "binary.dat"), Buffer.from([0, 1, 2, 3]));
    const first = await store.capture("principal");
    expect((await store.detail(first.id))?.skipped).toContainEqual(expect.objectContaining({ path: "large.bin", reason: "too_large" }));

    await writeFile(join(workspace, "binary.dat"), Buffer.from([0, 9, 2, 3]));
    const [second, third] = await Promise.all([store.capture("engineer"), store.capture("auditor")]);
    expect(second.id).not.toBe(third.id);
    expect(third.baseCheckpointId).toBe(second.id);
    expect((await store.detail(second.id))?.files.find((item) => item.path === "binary.dat")?.binary).toBe(true);

    const reloaded = new WorkspaceCheckpointStore("s1", workspace, state);
    expect((await reloaded.refs([first.id, second.id, third.id])).map((item) => item.id)).toEqual([first.id, second.id, third.id]);
    const index = JSON.parse(await readFile(join(state, "workspace-checkpoints.json"), "utf8")) as {
      version: number;
      checkpoints: Record<string, Record<string, unknown>>;
    };
    expect(index.version).toBe(2);
    expect(Object.values(index.checkpoints).every((record) => !("files" in record))).toBe(true);
  });

  it("stops adding snapshots after the repository quota is reached", async () => {
    const { workspace, state } = await fixture();
    await writeFile(join(workspace, "value.txt"), "one\n", "utf8");
    const store = new WorkspaceCheckpointStore("s1", workspace, state, { maxRepositoryBytes: 1024 });
    const first = await store.capture("principal");
    expect(first.status).toBe("ready");
    const blocked = await store.capture("principal");
    expect(blocked.status).toBe("failed");
    expect(blocked.error).toContain("repository quota exceeded");

    // A full history quota must never prevent restoring an existing point.
    await writeFile(join(workspace, "value.txt"), "two\n", "utf8");
    const preview = await store.preview(first.id);
    await store.restore(first.id, preview!.stateToken);
    expect(await readFile(join(workspace, "value.txt"), "utf8")).toBe("one\n");
  });

  it("migrates a V1 index without retaining duplicated file lists", async () => {
    const { workspace, state, store } = await fixture();
    await writeFile(join(workspace, "value.txt"), "old\n", "utf8");
    const target = await store.capture("principal");
    const indexPath = join(state, "workspace-checkpoints.json");
    const legacy = JSON.parse(await readFile(indexPath, "utf8")) as {
      version: number;
      checkpoints: Record<string, Record<string, unknown>>;
    };
    legacy.version = 1;
    legacy.checkpoints[target.id]!.files = ["value.txt"];
    await writeFile(indexPath, JSON.stringify(legacy, null, 2), "utf8");
    await writeFile(join(workspace, "value.txt"), "new\n", "utf8");

    const reloaded = new WorkspaceCheckpointStore("s1", workspace, state);
    const preview = await reloaded.preview(target.id);
    await reloaded.restore(target.id, preview!.stateToken);
    expect(await readFile(join(workspace, "value.txt"), "utf8")).toBe("old\n");
    const migrated = JSON.parse(await readFile(indexPath, "utf8")) as {
      version: number;
      checkpoints: Record<string, Record<string, unknown>>;
    };
    expect(migrated.version).toBe(2);
    expect(Object.values(migrated.checkpoints).every((record) => !("files" in record))).toBe(true);
  });

  it("never overwrites a path that is ignored at restore time", async () => {
    const { workspace, store } = await fixture();
    await mkdir(join(workspace, "local"));
    await writeFile(join(workspace, ".gitignore"), "", "utf8");
    await writeFile(join(workspace, "local", "state.txt"), "checkpoint\n", "utf8");
    const target = await store.capture("principal");

    await writeFile(join(workspace, ".gitignore"), "local/\n", "utf8");
    await writeFile(join(workspace, "local", "state.txt"), "keep-current\n", "utf8");
    const preview = await store.preview(target.id);
    expect(preview?.files.some((item) => item.path === "local/state.txt")).toBe(false);
    await store.restore(target.id, preview!.stateToken);
    expect(await readFile(join(workspace, "local", "state.txt"), "utf8")).toBe("keep-current\n");
  });

  it("reverses only selected checkpoint patches for causal rollback", async () => {
    const { workspace, store } = await fixture();
    await writeFile(join(workspace, "shared.txt"), "A\n", "utf8");
    await store.capture("principal");

    await writeFile(join(workspace, "a2.txt"), "A2\n", "utf8");
    const a2 = await store.capture("engineer");

    await writeFile(join(workspace, "shared.txt"), "B\n", "utf8");
    await writeFile(join(workspace, "b.txt"), "B\n", "utf8");
    const b = await store.capture("engineer");

    const preview = await store.previewCausal([a2.id, b.id]);
    expect(preview.conflicts).toEqual([]);
    expect(preview.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "a2.txt", status: "deleted" }),
      expect.objectContaining({ path: "b.txt", status: "deleted" }),
      expect.objectContaining({ path: "shared.txt", status: "modified" }),
    ]));
    await store.restoreCausal([a2.id, b.id], preview.stateToken);
    expect(await readFile(join(workspace, "shared.txt"), "utf8")).toBe("A\n");
    await expect(readFile(join(workspace, "a2.txt"), "utf8")).rejects.toThrow();
    await expect(readFile(join(workspace, "b.txt"), "utf8")).rejects.toThrow();
    await writeFile(join(workspace, "after.txt"), "after\n", "utf8");
    const next = await store.capture("writer");
    expect(next.stats).toMatchObject({ files: 1, added: 1, modified: 0, deleted: 0 });
  });

  it("reports a conflict instead of overwriting a later independent edit", async () => {
    const { workspace, store } = await fixture();
    await writeFile(join(workspace, "shared.txt"), "base\n", "utf8");
    await store.capture("principal");

    await writeFile(join(workspace, "shared.txt"), "branch-a\n", "utf8");
    const branchA = await store.capture("engineer");

    await writeFile(join(workspace, "shared.txt"), "independent-current\n", "utf8");
    const preview = await store.previewCausal([branchA.id]);
    expect(preview.conflicts).toEqual([
      expect.objectContaining({ path: "shared.txt", checkpointIds: [branchA.id] }),
    ]);
    let prepared = false;
    await expect(store.restoreCausal([branchA.id], preview.stateToken, async () => { prepared = true; })).rejects.toMatchObject({ code: "CAUSAL_CONFLICT" });
    expect(prepared).toBe(false);
    expect(await readFile(join(workspace, "shared.txt"), "utf8")).toBe("independent-current\n");
  });
});
