import { Check, MessageCircle, PenLine, Search, Trash2, X } from "lucide-react";
import { FormEvent, useState } from "react";
import type { Session } from "../../contracts/backend";
import { useT } from "../../i18n/useT";
import { IconButton } from "../primitives/IconButton";

type SessionListProps = {
  sessions: Session[];
  currentId: string | undefined;
  isLoading: boolean;
  /** Select an existing session (callers also switch to the workspace page). */
  onSelect: (sessionId: string) => void;
  /** Rename a session by id. */
  onRename: (sessionId: string, title: string) => void | Promise<void>;
  /** Delete a session by id. */
  onDelete: (sessionId: string) => void | Promise<void>;
  /** Open the search dialog. */
  onOpenSearch: () => void;
};

/**
 * #131 — the conversation list, extracted from Sidebar so the same markup and
 * rename/delete affordances render both inline (expanded sidebar) and inside
 * the icon-rail session popover. Owns only its transient edit/confirm UI state;
 * the session data and mutations are passed in by the host.
 */
export function SessionList({
  sessions,
  currentId,
  isLoading,
  onSelect,
  onRename,
  onDelete,
  onOpenSearch,
}: SessionListProps) {
  const t = useT();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const submitRename = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingId || !editingTitle.trim()) {
      setEditingId(null);
      return;
    }
    await onRename(editingId, editingTitle.trim());
    setEditingId(null);
  };

  return (
    <div className="conversation-stack">
      <button className="conversation-search-trigger" onClick={onOpenSearch} type="button">
        <Search size={14} />
        <span>{t("sidebar.search")}</span>
      </button>
      <p className="muted-label">
        {isLoading ? t("sidebar.loading") : t("sidebar.sessionCount", { count: sessions.length })}
      </p>
      {sessions.length === 0 && !isLoading ? <p className="sidebar-empty">{t("sidebar.empty")}</p> : null}
      {sessions.map((session) => {
        const isEditing = editingId === session.id;
        const isConfirming = confirmDeleteId === session.id;
        return (
          <div className={`conversation-item ${currentId === session.id ? "is-active" : ""}`} key={session.id}>
            {isEditing ? (
              <form className="conversation-edit" onSubmit={submitRename}>
                <input
                  autoFocus
                  onChange={(event) => setEditingTitle(event.target.value)}
                  value={editingTitle}
                />
                <IconButton label={t("sidebar.aria.saveTitle")} type="submit">
                  <Check size={14} />
                </IconButton>
                <IconButton label={t("sidebar.aria.cancelRename")} onClick={() => setEditingId(null)}>
                  <X size={14} />
                </IconButton>
              </form>
            ) : (
              <>
                <button className="conversation-row" onClick={() => onSelect(session.id)} type="button">
                  <MessageCircle size={16} />
                  <span>{session.title}</span>
                  <small>{new Date(session.updatedAt).toLocaleDateString()}</small>
                </button>
                <div className="conversation-actions">
                  {isConfirming ? (
                    <>
                      <IconButton
                        label={t("sidebar.aria.confirmDelete")}
                        onClick={() => {
                          void onDelete(session.id);
                          setConfirmDeleteId(null);
                        }}
                      >
                        <Check size={14} />
                      </IconButton>
                      <IconButton label={t("sidebar.aria.cancelDelete")} onClick={() => setConfirmDeleteId(null)}>
                        <X size={14} />
                      </IconButton>
                    </>
                  ) : (
                    <>
                      <IconButton
                        label={t("sidebar.aria.rename")}
                        onClick={() => {
                          setEditingId(session.id);
                          setEditingTitle(session.title);
                        }}
                      >
                        <PenLine size={14} />
                      </IconButton>
                      <IconButton label={t("sidebar.aria.delete")} onClick={() => setConfirmDeleteId(session.id)}>
                        <Trash2 size={14} />
                      </IconButton>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
