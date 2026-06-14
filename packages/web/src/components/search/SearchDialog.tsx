import { useEffect, useMemo, useRef, useState } from "react";
import { MessageCircle } from "lucide-react";
import { useSessions } from "../../contexts/SessionContext";
import { useT } from "../../i18n/useT";

type SearchDialogProps = {
  isOpen: boolean;
  onClose: () => void;
};

export function SearchDialog({ isOpen, onClose }: SearchDialogProps) {
  const { sessions, selectSession } = useSessions();
  const t = useT();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      return;
    }

    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  const filteredSessions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return sessions;
    }

    return sessions.filter((session) => {
      return session.title.toLowerCase().includes(normalizedQuery);
    });
  }, [query, sessions]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="search-modal" role="presentation" onMouseDown={onClose}>
      <section
        aria-label={t("search.aria")}
        aria-modal="true"
        className="search-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <label className="sr-only" htmlFor="conversation-search">
          {t("search.placeholder")}
        </label>
        <input
          id="conversation-search"
          ref={inputRef}
          autoComplete="off"
          className="search-dialog__input"
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("search.placeholder")}
          type="search"
          value={query}
        />

        <div className="search-dialog__body">
          <p className="search-dialog__heading">{t("search.recent")}</p>
          {filteredSessions.length > 0 ? (
            <div className="search-results" role="listbox">
              {filteredSessions.map((session, index) => (
                <button
                  className={`search-result ${index === 0 ? "is-highlighted" : ""}`}
                  key={session.id}
                  onClick={() => {
                    selectSession(session.id);
                    onClose();
                  }}
                  type="button"
                >
                  <MessageCircle size={18} />
                  <span className="search-result__title">{session.title}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="search-dialog__empty">{t("search.empty")}</p>
          )}
        </div>
      </section>
    </div>
  );
}
