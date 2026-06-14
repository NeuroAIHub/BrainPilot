import {
  Clock3,
  Check,
  MessageCircle,
  MessageSquarePlus,
  MonitorPlay,
  PanelLeft,
  PenLine,
  Plug,
  Search,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { FormEvent, useState } from "react";
import { useSessions } from "../../contexts/SessionContext";
import { useT } from "../../i18n/useT";
import { IconButton } from "../primitives/IconButton";

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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const submitRename = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingId || !editingTitle.trim()) {
      setEditingId(null);
      return;
    }
    await updateSessionTitle(editingId, editingTitle.trim());
    setEditingId(null);
  };

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
        <button className="nav-item nav-item--strong" onClick={() => { onGoWorkspace(); startDraftSession(); }} type="button">
          <PenLine size={16} />
          <span>{t("sidebar.newChat")}</span>
        </button>
        <button className="nav-item" type="button">
          <Plug size={16} />
          <span>{t("sidebar.plugins")}</span>
        </button>
        <button className="nav-item" type="button">
          <Clock3 size={16} />
          <span>{t("sidebar.automations")}</span>
        </button>
        <button
          className={`nav-item ${activePage === "demo" ? "is-active" : ""}`}
          onClick={onOpenDemo}
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
            <IconButton label={t("sidebar.aria.newConversation")} onClick={() => { onGoWorkspace(); startDraftSession(); }}>
              <MessageSquarePlus size={13} />
            </IconButton>
          </div>
        </div>

        <div className="conversation-stack">
          <button className="conversation-search-trigger" onClick={onOpenSearch} type="button">
            <Search size={14} />
            <span>{t("sidebar.search")}</span>
          </button>
          <p className="muted-label">{isLoading ? t("sidebar.loading") : t("sidebar.sessionCount", { count: sessions.length })}</p>
          {sessions.length === 0 && !isLoading ? <p className="sidebar-empty">{t("sidebar.empty")}</p> : null}
          {sessions.map((session) => {
            const isEditing = editingId === session.id;
            const isConfirming = confirmDeleteId === session.id;
            return (
              <div className={`conversation-item ${currentSession?.id === session.id ? "is-active" : ""}`} key={session.id}>
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
                    <button className="conversation-row" onClick={() => { onGoWorkspace(); selectSession(session.id); }} type="button">
                      <MessageCircle size={16} />
                      <span>{session.title}</span>
                      <small>{new Date(session.updatedAt).toLocaleDateString()}</small>
                    </button>
                    <div className="conversation-actions">
                      {isConfirming ? (
                        <>
                          <IconButton label={t("sidebar.aria.confirmDelete")} onClick={() => void deleteSession(session.id)}>
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
      </section>

      <div className="sidebar__footer">
        <button className="nav-item" onClick={onOpenSettings} type="button">
          <Settings size={16} />
          <span>{t("sidebar.settings")}</span>
        </button>
      </div>
    </aside>
  );
}
