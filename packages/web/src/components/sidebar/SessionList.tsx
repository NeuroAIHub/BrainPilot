import { Check, MessageCircle, PenLine, Search, Trash2, X } from "lucide-react";
import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import type { Session } from "../../contracts/backend";
import type { SessionsListStatus } from "../../contexts/sessionSelection";
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
  /**
   * #324 — readiness of the session-list request. Together with `loadError` it
   * separates "we don't know the list yet / it failed" from "there really are no
   * conversations", so a pending or failed load never renders a 0 count or the
   * empty state. Optional for callers that only have the legacy `isLoading`.
   */
  listStatus?: SessionsListStatus;
  /** Technical detail of the last list-load failure, or null when healthy. */
  loadError?: string | null;
  /** Re-run the list request (kept mounted and busy while it is in flight). */
  onRetry?: () => void;
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
  listStatus,
  loadError = null,
  onRetry,
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

  /** Title + last-updated date: the row's accessible name and hover tooltip. */
  const rowLabel = (session: Session) =>
    t("sidebar.row.label", {
      title: session.title,
      date: new Date(session.updatedAt).toLocaleDateString(),
    });

  // #324 — an unknown or failed list is not an empty list. While a load is
  // pending, or after it failed with nothing cached, suppress both the count and
  // the "No conversations yet" line and show the scoped state instead.
  //
  // `listStatus` is the authority when the host passes it: "idle" means the first
  // read hasn't finished (nothing is known yet) and "error" means it failed, even
  // when no technical detail string came with it. Legacy hosts that only have
  // `isLoading` keep their old behaviour.
  const hasRows = sessions.length > 0;
  const isPending = isLoading || listStatus === "loading" || listStatus === "idle";
  const hasLoadError = listStatus === "error" || !!loadError;
  const countLabel = isPending
    ? t("sidebar.loading")
    : hasRows || !hasLoadError
      ? t("sidebar.sessionCount", { count: sessions.length })
      : null;
  const showEmpty = !hasRows && !isPending && !hasLoadError;

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
      {countLabel ? (
        <p className="muted-label" data-testid="session-list-status">
          {countLabel}
        </p>
      ) : null}
      {hasLoadError ? (
        <div className="composer-notice sidebar-list-error" role="alert" data-testid="session-list-error">
          <span className="composer-notice__text">
            {t(hasRows ? "sidebar.list.refreshFailed" : "sidebar.list.unavailable")}
            {loadError ? (
              <details>
                <summary>{t("sidebar.list.details")}</summary>
                <code>{loadError}</code>
              </details>
            ) : null}
          </span>
          {/* Stays mounted while the retry runs so keyboard focus is not lost. */}
          {onRetry ? (
            <button
              type="button"
              className="composer-notice__cta"
              aria-busy={isPending}
              aria-disabled={isPending}
              data-testid="session-list-retry"
              onClick={() => { if (!isPending) onRetry(); }}
            >
              {t(isPending ? "sidebar.list.retrying" : "sidebar.list.retry")}
            </button>
          ) : null}
        </div>
      ) : null}
      {showEmpty ? <p className="sidebar-empty">{t("sidebar.empty")}</p> : null}
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
                {/* #131 follow-up — the row used to end in a right-aligned date
                    that stole width from the title and truncated most of it to
                    a few characters. The title now gets up to two lines, and
                    the date moves into the row's accessible name/tooltip so it
                    is still readable (and searchable) without the competition. */}
                <button
                  aria-label={rowLabel(session)}
                  className="conversation-row"
                  onClick={() => onSelect(session.id)}
                  title={rowLabel(session)}
                  type="button"
                >
                  <MessageCircle size={16} />
                  <span className="conversation-row__title">{session.title}</span>
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
