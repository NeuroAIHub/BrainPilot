import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgUiEvent } from "@brainpilot/protocol";
import { SessionManager } from "../session-manager.js";
import { WorkspaceCheckpointStore } from "../workspace-checkpoints.js";

const roots: string[] = [];
afterEach(async () => Promise.all(
  roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
));

describe("workspace restore visibility (#492)", () => {
  it("persists and publishes a structured restore event after commit", async () => {
    const root = await mkdtemp(join(tmpdir(), "bp-visible-restore-"));
    roots.push(root);
    const manager = new SessionManager({ dataRoot: root, persist: true });
    const session = await manager.createSession({ title: "Restore demo" });
    const workspace = join(root, "workspaces", session.id);
    const store = new WorkspaceCheckpointStore(session.id, workspace, join(root, ".bp", session.id));

    await writeFile(join(workspace, "result.md"), "VERSION_ONE\n", "utf8");
    const checkpoint = await store.capture("principal");
    await writeFile(join(workspace, "result.md"), "VERSION_TWO\n", "utf8");
    const preview = await manager.getTraceRestorePreview(session.id, checkpoint.id);
    expect(preview?.files.map((file) => file.path)).toEqual(["result.md"]);

    const live: AgUiEvent[] = [];
    manager.subscribe(session.id, (event) => live.push(event));
    await manager.restoreTraceCheckpoint(session.id, checkpoint.id, preview!.stateToken);

    expect(await readFile(join(workspace, "result.md"), "utf8")).toBe("VERSION_ONE\n");
    const restored = live.find((event) =>
      event.type === "system_message"
      && (event as Record<string, unknown>).code === "workspace_restored"
    ) as (AgUiEvent & { metadata?: Record<string, unknown> }) | undefined;
    expect(restored?.metadata).toMatchObject({
      mode: "checkpoint",
      checkpointId: checkpoint.id,
      files: ["result.md"],
      fileCount: 1,
    });

    const persisted = (await readFile(join(root, ".bp", session.id, "events.jsonl"), "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(persisted.some((event) => event.code === "workspace_restored")).toBe(true);
  });
});
