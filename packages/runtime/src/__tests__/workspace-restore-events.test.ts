import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgUiEvent } from "@brainpilot/protocol";
import { SessionManager } from "../session-manager.js";
import { WorkspaceCheckpointStore } from "../workspace-checkpoints.js";
import { createServer } from "../server.js";
import {
  normalizeWebSocketEvent,
  type WebSocketEvent,
} from "../../../web/src/contracts/backend.js";
import { reduceMessagesForEvent } from "../../../web/src/contexts/messageReducer.js";
import { workspaceRestorePresentation } from "../../../web/src/components/chat/workspaceRestorePresentation.js";
import { restoreNoticeIsCurrent } from "../../../web/src/components/files/workspaceRestoreState.js";

const roots: string[] = [];
const managers: SessionManager[] = [];
afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.shutdownAndSave()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("workspace restore visibility (#492)", () => {
  it("persists and publishes a structured restore event after commit", async () => {
    const root = await mkdtemp(join(tmpdir(), "bp-visible-restore-"));
    roots.push(root);
    const manager = new SessionManager({ dataRoot: root, persist: true });
    managers.push(manager);
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

  it("round-trips HTTP restore through the live/durable event and web reducer", async () => {
    const root = await mkdtemp(join(tmpdir(), "bp-visible-restore-http-"));
    roots.push(root);
    const manager = new SessionManager({ dataRoot: root, persist: true });
    managers.push(manager);
    const session = await manager.createSession({ title: "Restore HTTP demo" });
    const workspace = join(root, "workspaces", session.id);
    const store = new WorkspaceCheckpointStore(session.id, workspace, join(root, ".bp", session.id));
    const app = createServer({ manager }).app;

    await writeFile(join(workspace, "result.md"), "VERSION_ONE\n", "utf8");
    const checkpoint = await store.capture("principal");
    await writeFile(join(workspace, "result.md"), "VERSION_TWO\n", "utf8");

    const live: AgUiEvent[] = [];
    manager.subscribe(session.id, (event) => live.push(event));
    const previewResponse = await app.request(
      `/sessions/${session.id}/trace/checkpoints/${checkpoint.id}/restore-preview`,
    );
    const preview = await previewResponse.json() as { stateToken: string };
    const restoreResponse = await app.request(
      `/sessions/${session.id}/trace/checkpoints/${checkpoint.id}/restore`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stateToken: preview.stateToken }),
      },
    );
    expect(restoreResponse.status).toBe(200);
    expect(await readFile(join(workspace, "result.md"), "utf8")).toBe("VERSION_ONE\n");

    const liveRestore = live.find((event) =>
      event.type === "system_message"
      && event.code === "workspace_restored"
    );
    expect(liveRestore).toBeDefined();

    const historyResponse = await app.request(`/sessions/${session.id}/history?limit=0`);
    const history = await historyResponse.json() as { events: unknown[] };
    const durableRestore = history.events.find((event) =>
      (event as { type?: string }).type === "system_message"
      && (event as { code?: string }).code === "workspace_restored"
    );
    expect(durableRestore).toBeDefined();

    const liveViewEvent = normalizeWebSocketEvent(liveRestore) as WebSocketEvent;
    const durableViewEvent = normalizeWebSocketEvent(durableRestore) as WebSocketEvent;
    let chat = reduceMessagesForEvent([], liveViewEvent);
    chat = reduceMessagesForEvent(chat, durableViewEvent);
    expect(chat).toHaveLength(1);
    expect(chat[0]?.systemMessage?.workspaceRestore).toMatchObject({
      mode: "checkpoint",
      checkpointId: checkpoint.id,
      files: ["result.md"],
    });
    const presentation = workspaceRestorePresentation(
      chat[0]!.systemMessage!,
      (key) => key,
    );
    expect(presentation?.title).toBe("chat.restore.title");
    expect(presentation?.message).toBe("chat.restore.checkpointSuccess");

    expect(restoreNoticeIsCurrent({
      restoreMessageIndex: 0,
      messageCount: 1,
      isDirty: false,
      successfullyReloaded: true,
    })).toBe(true);
    expect(restoreNoticeIsCurrent({
      restoreMessageIndex: 0,
      messageCount: 2,
      isDirty: false,
      successfullyReloaded: true,
    })).toBe(false);
  });
});
