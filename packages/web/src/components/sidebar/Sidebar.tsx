import {
  MessagesSquare,
  MonitorPlay,
  PanelLeft,
  PenLine,
  Settings,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSessions } from "../../contexts/SessionContext";
import { useT } from "../../i18n/useT";
import { IconButton } from "../primitives/IconButton";
import { SessionList } from "./SessionList";

type SidebarProps = {
  isCollapsed: boolean;
  activePage: "workspace" | "demo";
  onOpenDemo: () => void;
  onGoWorkspace: () => void;
  onOpenSettings: () => void;
  onOpenSearch: () => void;
  onResizeStart: (pointerX: number) => void;
  onToggle: () => void;
};

export function Sidebar({ isCollapsed, activePage, onOpenDemo, onGoWorkspace, onOpenSettings, onOpenSearch, onResizeStart, onToggle }: SidebarProps) {
  const {
    sessions,
    currentSession,
    isLoading,
    startDraftSession,
    selectSession,
    updateSessionTitle,
    deleteSession,
  } = useSessions();
  const t = useT();
  // #131 — when collapsed to the icon rail, the session list moves into a
  // floating popover opened from a single icon, so it no longer competes for
  // horizontal space yet stays one click away.
  const [isSessionsPopoverOpen, setIsSessionsPopoverOpen] = useState(false);
  const sessionsPopoverRef = useRef<HTMLDivElement | null>(null);

  const newConversation = () => {
    onGoWorkspace();
    startDraftSession();
  };

  const selectAndGo = (sessionId: string) => {
    onGoWorkspace();
    selectSession(sessionId);
  };

  // Collapsing the rail (manually or at narrow widths) closes a stale popover.
  useEffect(() => {
    if (!isCollapsed) setIsSessionsPopoverOpen(false);
  }, [isCollapsed]);

  // Dismiss the popover on outside click / Escape, like a standard menu.
  useEffect(() => {
    if (!isSessionsPopoverOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!sessionsPopoverRef.current?.contains(event.target as Node)) {
        setIsSessionsPopoverOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsSessionsPopoverOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isSessionsPopoverOpen]);

  return (
    <aside className="sidebar" aria-label={t("sidebar.aria.nav")}>
      <div
        aria-label={t("sidebar.aria.resize")}
        className="sidebar__resize-handle"
        onPointerDown={(event) => {
          event.preventDefault();
          onResizeStart(event.clientX);
        }}
        role="separator"
      />

      <div className="sidebar__topbar">
        <IconButton
          aria-expanded={!isCollapsed}
          label={isCollapsed ? t("sidebar.aria.expand") : t("sidebar.aria.collapse")}
          onClick={onToggle}
        >
          <PanelLeft size={16} />
        </IconButton>
      </div>

      <nav className="sidebar__nav" aria-label={t("sidebar.aria.primary")}>
        <button className="nav-item nav-item--strong" onClick={newConversation} type="button" title={t("sidebar.newChat")}>
          <PenLine size={16} />
          <span>{t("sidebar.newChat")}</span>
        </button>
        {/*
          #131 — collapsed icon rail: a single Sessions icon opens the session
          list in a popover (the inline list below is hidden when collapsed).
          Rendered only in the rail so the expanded sidebar keeps its full list.
        */}
        {isCollapsed ? (
          <div className="sidebar__sessions-popover-anchor" ref={sessionsPopoverRef}>
            <button
              aria-expanded={isSessionsPopoverOpen}
              aria-haspopup="menu"
              className={`nav-item ${isSessionsPopoverOpen ? "is-active" : ""}`}
              onClick={() => setIsSessionsPopoverOpen((open) => !open)}
              title={t("sidebar.conversations")}
              type="button"
            >
              <MessagesSquare size={16} />
              <span>{t("sidebar.conversations")}</span>
            </button>
            {isSessionsPopoverOpen ? (
              <div className="sidebar__sessions-popover" role="menu" aria-label={t("sidebar.conversations")}>
                <div className="sidebar__sessions-popover-head">
                  <h2>{t("sidebar.conversations")}</h2>
                  <button className="nav-item nav-item--strong" onClick={() => { newConversation(); setIsSessionsPopoverOpen(false); }} type="button">
                    <PenLine size={14} />
                    <span>{t("sidebar.newChat")}</span>
                  </button>
                </div>
                <SessionList
                  sessions={sessions}
                  currentId={currentSession?.id}
                  isLoading={isLoading}
                  onSelect={(id) => { selectAndGo(id); setIsSessionsPopoverOpen(false); }}
                  onRename={updateSessionTitle}
                  onDelete={deleteSession}
                  onOpenSearch={() => { onOpenSearch(); setIsSessionsPopoverOpen(false); }}
                />
              </div>
            ) : null}
          </div>
        ) : null}
        <button
          className={`nav-item ${activePage === "demo" ? "is-active" : ""}`}
          onClick={onOpenDemo}
          title={t("sidebar.demo")}
          type="button"
        >
          <MonitorPlay size={16} />
          <span>{t("sidebar.demo")}</span>
        </button>
      </nav>

      <section className="sidebar-section sidebar-section--conversations" aria-labelledby="conversations-heading">
        <div className="section-heading">
          <h2 id="conversations-heading">{t("sidebar.conversations")}</h2>
          <div className="section-heading__actions">
            <IconButton label={t("sidebar.aria.newConversation")} onClick={newConversation}>
              <PenLine size={13} />
            </IconButton>
          </div>
        </div>

        <SessionList
          sessions={sessions}
          currentId={currentSession?.id}
          isLoading={isLoading}
          onSelect={selectAndGo}
          onRename={updateSessionTitle}
          onDelete={deleteSession}
          onOpenSearch={onOpenSearch}
        />
      </section>

      <div className="sidebar__footer">
        <button className="nav-item" onClick={onOpenSettings} type="button" title={t("sidebar.settings")}>
          <Settings size={16} />
          <span>{t("sidebar.settings")}</span>
        </button>
      </div>
    </aside>
  );
}
