import type { SystemMessageView } from "../../contracts/backend";

type Translate = (key: string, params?: Record<string, string | number>) => string;

function basename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

function checkpointLabel(id?: string): string {
  if (!id) return "—";
  return id.replace(/^checkpoint_/, "").slice(0, 8);
}

export function workspaceRestorePresentation(
  view: SystemMessageView,
  t: Translate,
): { title: string; message: string } | null {
  const restore = view.workspaceRestore;
  if (view.code !== "workspace_restored" || !restore) return null;

  const names = restore.files.map(basename);
  const visible = names.slice(0, 3).join(", ");
  const remaining = Math.max(0, restore.fileCount - 3);
  const files = names.length === 0
    ? t("chat.restore.noFiles")
    : remaining > 0
      ? t("chat.restore.moreFiles", { files: visible, count: remaining })
      : visible;
  const timestamp = restore.restoredAt ?? view.timestamp;
  const time = timestamp ? new Date(timestamp).toLocaleString() : "—";
  const key = restore.mode === "causal"
    ? "chat.restore.causalSuccess"
    : "chat.restore.checkpointSuccess";

  return {
    title: t("chat.restore.title"),
    message: t(key, {
      checkpoint: checkpointLabel(restore.checkpointId),
      time,
      count: restore.fileCount,
      files,
      nodes: restore.affectedNodeCount ?? 0,
    }),
  };
}
