import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessageCircle, X } from "lucide-react";
import { useSessions } from "../../contexts/SessionContext";
import { useT } from "../../i18n/useT";
import { IconButton } from "../primitives/IconButton";
import { listFocusable, trapFocusKeyDown } from "../settings/settingsModalStack";
import {
  clampActiveIndex,
  filterSessionsByQuery,
  moveActiveIndex,
  navigateToSearchResult,
  searchResultMeta,
  titleCollisionIds,
} from "./searchResults";

type SearchDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  onOpenWorkspace: () => void;
  confirmNavigation?: () => boolean;
};

/**
 * Conversation search modal (#315).
 * list + listitem buttons (not listbox/button mismatch), arrow navigation,
 * visible Close, and same-title disambiguation via date + short id.
 */
export function SearchDialog({ isOpen, onClose, onOpenWorkspace, confirmNavigation }: SearchDialogProps) {
  const { sessions, selectSession, sessionsListStatus, sessionsListError, refreshSessions } = useSessions();
  const t = useT();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const filteredSessions = useMemo(
    () => filterSessionsByQuery(sessions, query),
    [query, sessions],
  );

  const collisions = useMemo(
    () => titleCollisionIds(filteredSessions),
    [filteredSessions],
  );

  // #324 — with nothing cached, a pending or failed session-list load must not
  // read as "no matching conversations": there is nothing to search yet. Cached
  // rows stay searchable and the failure is marked instead. The status is the
  // authority: "error" is a failure even when no detail string came with it.
  const isListPending = sessionsListStatus === "loading" || sessionsListStatus === "idle";
  const hasListError = sessionsListStatus === "error" || !!sessionsListError;
  const listUnavailable = sessions.length === 0 && (isListPending || hasListError);

  const openSession = useCallback((sessionId: string) => navigateToSearchResult(sessionId, {
    confirmNavigation,
    openWorkspace: onOpenWorkspace,
    selectSession,
    close: onClose,
  }), [confirmNavigation, onClose, onOpenWorkspace, selectSession]);

  // Keep highlight in range when the filtered list changes.
  useEffect(() => {
    setActiveIndex((i) => clampActiveIndex(i, filteredSessions.length));
  }, [filteredSessions.length]);

  // Focus belongs to the open/close lifecycle, not every callback/filter rerender.
  useEffect(() => {
    if (!isOpen) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(timer);
      const target = returnFocusRef.current;
      if (target?.isConnected) target.focus();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      setActiveIndex(0);
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (dialog && trapFocusKeyDown(dialog, event)) {
        return;
      }

      if (event.key === "Escape" || event.key === "Esc") {
        event.preventDefault();
        onClose();
        return;
      }

      if (filteredSessions.length === 0) return;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((i) => moveActiveIndex(i, filteredSessions.length, "down"));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((i) => moveActiveIndex(i, filteredSessions.length, "up"));
        return;
      }
      if (event.key === "Enter") {
        const target = filteredSessions[clampActiveIndex(activeIndex, filteredSessions.length)];
        if (target && document.activeElement === inputRef.current) {
          event.preventDefault();
          openSession(target.id);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isOpen, onClose, filteredSessions, activeIndex, openSession]);

  if (!isOpen) {
    return null;
  }

  const formatWhen = (iso: string) => {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  };

  return (
    <div className="search-modal" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        aria-label={t("search.aria")}
        aria-modal="true"
        className="search-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="search-dialog__header">
          <label className="sr-only" htmlFor="conversation-search">
            {t("search.placeholder")}
          </label>
          <input
            id="conversation-search"
            ref={inputRef}
            autoComplete="off"
            className="search-dialog__input"
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            placeholder={t("search.placeholder")}
            type="search"
            value={query}
            aria-controls="search-results-list"
          />
          <IconButton label={t("search.close")} onClick={onClose} className="search-dialog__close">
            <X size={16} />
          </IconButton>
        </header>

        <div className="search-dialog__body">
          <p className="search-dialog__heading">
            {query.trim() ? t("search.results") : t("search.recent")}
          </p>
          {hasListError ? (
            <div className="composer-notice search-dialog__error" role="alert" data-testid="search-list-error">
              <span className="composer-notice__text">
                {t(sessions.length > 0 ? "search.refreshFailed" : "search.loadFailed")}
                {sessionsListError ? (
                  <details>
                    <summary>{t("search.details")}</summary>
                    <code>{sessionsListError}</code>
                  </details>
                ) : null}
              </span>
              {/* Kept mounted while the retry runs so focus is not lost. */}
              <button
                type="button"
                className="composer-notice__cta"
                aria-busy={sessionsListStatus === "loading"}
                aria-disabled={sessionsListStatus === "loading"}
                data-testid="search-list-retry"
                onClick={() => { if (sessionsListStatus !== "loading") void refreshSessions(); }}
              >
                {t(sessionsListStatus === "loading" ? "search.retrying" : "search.retry")}
              </button>
            </div>
          ) : null}
          {filteredSessions.length > 0 ? (
            <ul className="search-results" id="search-results-list" role="list">
              {filteredSessions.map((session, index) => {
                const meta = searchResultMeta(session, collisions);
                const isActive = index === activeIndex;
                return (
                  <li key={session.id} role="listitem">
                    <button
                      className={`search-result${isActive ? " is-highlighted" : ""}`}
                      id={`search-result-${session.id}`}
                      onClick={() => openSession(session.id)}
                      onMouseEnter={() => setActiveIndex(index)}
                      type="button"
                      aria-current={isActive ? "true" : undefined}
                    >
                      <MessageCircle size={18} aria-hidden />
                      <span className="search-result__text">
                        <span className="search-result__title">{session.title}</span>
                        <span className="search-result__meta">
                          <time dateTime={session.updatedAt}>{formatWhen(session.updatedAt)}</time>
                          {meta.showShortId ? (
                            <>
                              <span className="search-result__meta-sep" aria-hidden>
                                ·
                              </span>
                              <span className="search-result__id" title={session.id}>
                                {t("search.shortId", { id: meta.shortId })}
                              </span>
                            </>
                          ) : null}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : listUnavailable ? (
            isListPending ? (
              <p className="search-dialog__empty" role="status" data-testid="search-list-loading">
                {t("search.loading")}
              </p>
            ) : null
          ) : (
            <p className="search-dialog__empty">{t("search.empty")}</p>
          )}
        </div>
      </section>
    </div>
  );
}
