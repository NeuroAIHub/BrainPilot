import { Check, MessageCircle, PenLine, Search, Trash2, X } from "lucide-react";
import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import type { Session } from "../../contracts/backend";
import { useT } from "../../i18n/useT";
import { IconButton } from "../primitives/IconButton";
import {
  canCommitRename,
  isCancelKey,
  renameValidation,
  renameValidationKey,
} from "./sessionListActions";

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
 *
 * #325 — rename/delete are keyboard-complete: labeled input, disabled Save
 * when empty/unchanged, Escape cancels, delete confirm has visible risk text
 * and named actions, focus returns to the trigger control.
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
  const [editingOriginal, setEditingOriginal] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showRenameHint, setShowRenameHint] = useState(false);

  const renameTriggersRef = useRef<Map<string, HTMLButtonElement | null>>(new Map());
  const deleteTriggersRef = useRef<Map<string, HTMLButtonElement | null>>(new Map());
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const deleteCancelRef = useRef<HTMLButtonElement | null>(null);

  const canSave = editingId ? canCommitRename(editingOriginal, editingTitle) : false;
  const validation = editingId ? renameValidation(editingOriginal, editingTitle) : "ok";
  const validationMsgKey = renameValidationKey(validation);

  useEffect(() => {
    if (editingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [editingId]);

  useEffect(() => {
    if (confirmDeleteId && deleteCancelRef.current) {
      deleteCancelRef.current.focus();
    }
  }, [confirmDeleteId]);

  const beginRename = (session: Session) => {
    setConfirmDeleteId(null);
    setEditingId(session.id);
    setEditingTitle(session.title);
    setEditingOriginal(session.title);
    setShowRenameHint(false);
  };

  const cancelRename = (sessionId: string) => {
    setEditingId(null);
    setEditingTitle("");
    setEditingOriginal("");
    setShowRenameHint(false);
    queueMicrotask(() => {
      renameTriggersRef.current.get(sessionId)?.focus();
    });
  };

  const submitRename = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingId) return;
    if (!canCommitRename(editingOriginal, editingTitle)) {
      setShowRenameHint(true);
      return;
    }
    const id = editingId;
    await onRename(id, editingTitle.trim());
    setEditingId(null);
    setEditingTitle("");
    setEditingOriginal("");
    setShowRenameHint(false);
    queueMicrotask(() => {
      renameTriggersRef.current.get(id)?.focus();
    });
  };

  const onRenameKeyDown = (event: KeyboardEvent) => {
    if (!editingId) return;
    if (isCancelKey(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      cancelRename(editingId);
    }
  };

  const beginDeleteConfirm = (sessionId: string) => {
    setEditingId(null);
    setConfirmDeleteId(sessionId);
  };

  const cancelDeleteConfirm = (sessionId: string) => {
    setConfirmDeleteId(null);
    queueMicrotask(() => {
      deleteTriggersRef.current.get(sessionId)?.focus();
    });
  };

  const confirmDelete = async (sessionId: string) => {
    await onDelete(sessionId);
    setConfirmDeleteId(null);
  };

  const onDeleteConfirmKeyDown = (event: KeyboardEvent, sessionId: string) => {
    if (isCancelKey(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      cancelDeleteConfirm(sessionId);
    }
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
          <div
            className={`conversation-item ${currentId === session.id ? "is-active" : ""}`}
            key={session.id}
          >
            {isEditing ? (
              <form
                className="conversation-edit"
                onSubmit={(e) => void submitRename(e)}
                onKeyDown={onRenameKeyDown}
              >
                <label className="sr-only" htmlFor={`session-rename-${session.id}`}>
                  {t("sidebar.aria.renameInput", { title: session.title })}
                </label>
                <input
                  id={`session-rename-${session.id}`}
                  ref={renameInputRef}
                  autoFocus
                  type="text"
                  value={editingTitle}
                  onChange={(event) => {
                    setEditingTitle(event.target.value);
                    if (showRenameHint) setShowRenameHint(false);
                  }}
                  aria-invalid={showRenameHint && !canSave ? true : undefined}
                  aria-describedby={
                    showRenameHint && validationMsgKey
                      ? `session-rename-hint-${session.id}`
                      : undefined
                  }
                />
                <IconButton
                  label={t("sidebar.aria.saveTitle")}
                  type="submit"
                  disabled={!canSave}
                >
                  <Check size={14} />
                </IconButton>
                <IconButton
                  label={t("sidebar.aria.cancelRename")}
                  type="button"
                  onClick={() => cancelRename(session.id)}
                >
                  <X size={14} />
                </IconButton>
                {showRenameHint && validationMsgKey ? (
                  <p
                    id={`session-rename-hint-${session.id}`}
                    className="conversation-edit__hint"
                    role="status"
                  >
                    {t(validationMsgKey)}
                  </p>
                ) : null}
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
                    <div
                      className="conversation-delete-confirm"
                      role="group"
                      aria-label={t("sidebar.delete.confirmGroup", { title: session.title })}
                      onKeyDown={(e) => onDeleteConfirmKeyDown(e, session.id)}
                    >
                      <p className="conversation-delete-confirm__text">
                        {t("sidebar.delete.confirmPrompt", { title: session.title })}
                      </p>
                      <div className="conversation-delete-confirm__actions">
                        <button
                          type="button"
                          className="conversation-delete-confirm__btn conversation-delete-confirm__btn--danger"
                          onClick={() => void confirmDelete(session.id)}
                        >
                          <Check size={14} aria-hidden />
                          <span>{t("sidebar.delete.confirm")}</span>
                        </button>
                        <button
                          type="button"
                          className="conversation-delete-confirm__btn"
                          ref={deleteCancelRef}
                          onClick={() => cancelDeleteConfirm(session.id)}
                        >
                          <X size={14} aria-hidden />
                          <span>{t("sidebar.delete.cancel")}</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <IconButton
                        label={t("sidebar.aria.rename")}
                        ref={(el) => {
                          renameTriggersRef.current.set(session.id, el);
                        }}
                        onClick={() => beginRename(session)}
                      >
                        <PenLine size={14} />
                      </IconButton>
                      <IconButton
                        label={t("sidebar.aria.delete")}
                        ref={(el) => {
                          deleteTriggersRef.current.set(session.id, el);
                        }}
                        onClick={() => beginDeleteConfirm(session.id)}
                      >
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
