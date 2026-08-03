import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Bot, FolderOpen, GitBranch, MessageSquare, RefreshCw } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { useSandbox } from "../../contexts/SandboxContext";
import { useSessions } from "../../contexts/SessionContext";
import { useT } from "../../i18n/useT";
import { runtimeConfig } from "../../config";
import { PromptComposer } from "../chat/PromptComposer";
import { DemoView } from "../demo/DemoView";
import { FileSidebar } from "../files/FileSidebar";
import { IconButton } from "../primitives/IconButton";
import { SearchDialog } from "../search/SearchDialog";
import { SettingsDialog, type SettingsTab } from "../settings/SettingsDialog";
import { AgentsPanel, TracePanel } from "../session/AgentTraceViews";
import { SandboxBuildingOverlay } from "./SandboxBuildingOverlay";
import { SandboxStatus } from "./SandboxStatus";
import { Sidebar } from "../sidebar/Sidebar";
import { DiskQuotaWarningDialog } from "../quota/DiskQuotaWarningDialog";
import { DiskQuotaCriticalDialog } from "../quota/DiskQuotaCriticalDialog";
import { DEFAULT_SIDEBAR_WIDTH, resolveResize } from "./sidebarResize";

const PluginMarketplace = lazy(() => import("../plugins/PluginMarketplace").then((module) => ({ default: module.PluginMarketplace })));

export function DesktopShell() {
  const { isAuthReady } = useAuth();
  const { currentSandbox, operation, error, stats } = useSandbox();
  const { currentSession, currentView, isRefreshingMessages, refreshMessages, setCurrentView, traceUnread, hiddenErrorsUnread } = useSessions();
  const t = useT();
  // #131 — the sidebar collapses to an icon rail either manually (user toggle)
  // or automatically at narrow widths. Both feed the same `isCollapsed` state so
  // the collapsed rail's session popover trigger is available in both cases. A
  // manual toggle wins until the viewport crosses the breakpoint again.
  const [userCollapsed, setUserCollapsed] = useState<boolean | null>(null);
  const [isNarrow, setIsNarrow] = useState(false);
  const isSidebarCollapsed = userCollapsed ?? isNarrow;
  const [activePage, setActivePage] = useState<"workspace" | "demo" | "plugins">("workspace");
  // Bumped on every sidebar "Live Demo" click so DemoView returns to its
  // session-selection landing even when the demo page is already open (#111).
  const [demoResetSignal, setDemoResetSignal] = useState(0);
  const [sidebarWidth, setSidebarWidth] = useState(268);
  const [isSidebarResizing, setIsSidebarResizing] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  // Deep-link target for the next Settings open (e.g. the composer's
  // no-provider banner jumps straight to Providers). Undefined = default tab.
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab | undefined>(undefined);
  const openSettings = (tab?: SettingsTab) => {
    setSettingsInitialTab(tab);
    setIsSettingsOpen(true);
  };
  const [isFilesOpen, setIsFilesOpen] = useState(false);
  const [fileSidebarWidth, setFileSidebarWidth] = useState(420);
  const [isFileSidebarResizing, setIsFileSidebarResizing] = useState(false);
  const [sandboxOverlayDismissed, setSandboxOverlayDismissed] = useState(false);
  const [isWarningOpen, setIsWarningOpen] = useState(false);
  const hasWarnedRef = useRef(false);
  const sidebarResizeRef = useRef<{ pointerX: number; width: number } | null>(null);

  useEffect(() => {
    if (operation === "creating" || operation === "rebuilding") {
      setSandboxOverlayDismissed(false);
    }
  }, [operation]);

  // #131 — track the narrow breakpoint. Crossing it resets the manual override
  // so the layout follows the viewport again (a user who manually expanded on a
  // wide screen still gets the auto-rail when they shrink the window, and vice
  // versa). 860px matches the existing responsive rail breakpoint in global.css.
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 860px)");
    const apply = () => {
      setIsNarrow(mql.matches);
      setUserCollapsed(null);
    };
    setIsNarrow(mql.matches);
    mql.addEventListener("change", apply);
    return () => mql.removeEventListener("change", apply);
  }, []);

  // Show warning dialog once per page session when disk usage is >= 90% but < 100%
  useEffect(() => {
    const percent = stats?.disk.percentOfQuota ?? 0;
    if (percent >= 90 && percent < 100 && !hasWarnedRef.current) {
      hasWarnedRef.current = true;
      setIsWarningOpen(true);
    }
  }, [stats]);

  const isCriticalOpen = stats ? stats.disk.percentOfQuota >= 100 : false;

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!sidebarResizeRef.current) {
        return;
      }

      // #159 — drag the edge left past the collapse threshold and the rail snaps
      // to the icon rail; otherwise apply the clamped expanded width. resolveResize
      // owns the geometry (pure + unit-tested in sidebarResize.test.ts).
      const delta = event.clientX - sidebarResizeRef.current.pointerX;
      const outcome = resolveResize(sidebarResizeRef.current.width + delta);
      if (outcome.collapse) {
        setUserCollapsed(true);
        sidebarResizeRef.current = null;
        setIsSidebarResizing(false);
        // Restore a sensible width so expanding again (toggle / drag) isn't stuck
        // at the collapsed remnant.
        setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
        return;
      }
      setSidebarWidth(outcome.width);
    };

    const handlePointerUp = () => {
      if (!sidebarResizeRef.current) {
        return;
      }

      sidebarResizeRef.current = null;
      setIsSidebarResizing(false);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, []);

  // Trust-front: while the upstream identity is resolving (GET /api/auth/me),
  // show a lightweight splash. On failure AuthProvider redirects to the hosted
  // login, so we never render the app for an unauthenticated request.
  if (!isAuthReady) {
    return (
      <div className="app-bootstrapping" role="status" aria-live="polite">
        <span className="sandbox-status__eyebrow">BrainPilot</span>
        <p>{t("shell.bootstrapping")}</p>
      </div>
    );
  }

  return (
    <div
      className={`desktop-shell ${isSidebarCollapsed ? "desktop-shell--sidebar-collapsed" : ""} ${
        isSidebarResizing ? "desktop-shell--resizing-sidebar" : ""
      }`}
      style={{ "--active-sidebar-width": `${sidebarWidth}px` } as React.CSSProperties}
    >
      <Sidebar
        isCollapsed={isSidebarCollapsed}
        activePage={activePage}
        onOpenDemo={() => {
          setActivePage("demo");
          setDemoResetSignal((n) => n + 1);
        }}
        onGoWorkspace={() => setActivePage("workspace")}
        onOpenPlugins={() => setActivePage("plugins")}
        onOpenSettings={() => openSettings()}
        onOpenSearch={() => setIsSearchOpen(true)}
        onResizeStart={(pointerX) => {
          if (isSidebarCollapsed) {
            return;
          }

          sidebarResizeRef.current = { pointerX, width: sidebarWidth };
          setIsSidebarResizing(true);
        }}
        onToggle={() => setUserCollapsed(!isSidebarCollapsed)}
      />

      {activePage === "demo" ? (
        <DemoView resetSignal={demoResetSignal} />
      ) : activePage === "plugins" ? (
        <Suspense fallback={<main className="plugin-market"><div className="plugin-market__empty"><strong>{t("marketplace.loading")}</strong></div></main>}>
          <PluginMarketplace />
        </Suspense>
      ) : (
      <main
        className={`workspace ${isFilesOpen ? "workspace--files-open" : ""} ${
          isFileSidebarResizing ? "workspace--resizing-files" : ""
        }`}
        style={{ "--active-file-sidebar-width": `${fileSidebarWidth}px` } as React.CSSProperties}
        aria-label={t("shell.aria.workspace")}
      >
        <header className="workspace-toolbar" aria-label={t("shell.aria.toolbarActions")}>
          <div className="session-title" aria-label={t("shell.aria.activeSession")}>
            {/* #105: foreground the human-readable session title (same source as
                the sidebar). The id is debug-only metadata now — surfaced as a
                hover tooltip + muted short id, never the primary label. Falls
                back to `Session <id8>` when the title is missing. */}
            <span
              className="session-title__name"
              title={currentSession?.id ?? undefined}
            >
              {currentSession?.title ||
                (currentSession?.id
                  ? `${t("shell.sessionLabel")} ${currentSession.id.slice(0, 8)}`
                  : t("shell.defaultWorkspace"))}
            </span>
            {currentSession?.id ? (
              <span className="session-title__id">{currentSession.id.slice(0, 8)}</span>
            ) : null}
          </div>
          <div className="workspace-toolbar__actions">
            {/* #104: icon-only nav. The label stays in the DOM (visually
                hidden) so it remains the button's accessible name, and `title`
                gives a hover/focus tooltip — no separate aria-label needed. */}
            <WorkspaceViewTabs
              currentView={currentView}
              onSelect={setCurrentView}
              hiddenErrorsUnread={hiddenErrorsUnread}
              traceUnread={traceUnread}
              t={t}
            />
            {currentView === "chat" ? (
              <IconButton
                className={isRefreshingMessages ? "is-active" : ""}
                label={t("shell.aria.refreshMessages")}
                onClick={() => void refreshMessages()}
              >
                <RefreshCw size={14} />
              </IconButton>
            ) : null}
            {/* #100: in local single-user mode there is no Docker sandbox to
                inspect — the runtime IS the workspace, so the Sandbox status
                popover would only show empty container metrics and read like a
                fault. Hide it here; downstream multi-user Docker builds set
                VITE_LOCAL_MODE=0 and keep the real container UI. */}
            {runtimeConfig.localMode ? null : <SandboxStatus />}
            <IconButton
              aria-pressed={isFilesOpen}
              className={isFilesOpen ? "is-active" : ""}
              label={isFilesOpen ? t("shell.files.close") : t("shell.files.open")}
              onClick={() => setIsFilesOpen((current) => !current)}
            >
              <FolderOpen size={16} />
            </IconButton>
          </div>
        </header>

        {currentView === "chat" ? (
          <PromptComposer onOpenProviderSettings={() => openSettings("providers")} />
        ) : null}
        {currentView === "agents" ? <AgentsPanel /> : null}
        {currentView === "trace" ? <TracePanel /> : null}
        <FileSidebar
          isOpen={isFilesOpen}
          onClose={() => setIsFilesOpen(false)}
          onResize={setFileSidebarWidth}
          onResizeEnd={() => setIsFileSidebarResizing(false)}
          onResizeStart={() => setIsFileSidebarResizing(true)}
          width={fileSidebarWidth}
        />
      </main>
      )}

      <SearchDialog isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
      <SettingsDialog
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        initialTab={settingsInitialTab}
      />
      {!sandboxOverlayDismissed && (operation === "creating" || operation === "rebuilding") ? (
        <SandboxBuildingOverlay operation={operation} error={error} onDismiss={() => setSandboxOverlayDismissed(true)} />
      ) : null}
      <DiskQuotaWarningDialog
        isOpen={isWarningOpen}
        onClose={() => setIsWarningOpen(false)}
        percentOfQuota={stats?.disk.percentOfQuota ?? 0}
      />
      <DiskQuotaCriticalDialog
        isOpen={isCriticalOpen}
        sandboxId={currentSandbox?.id ?? null}
        workspaceUsedBytes={stats?.disk.workspaceUsedBytes ?? 0}
        quotaBytes={stats?.disk.quotaBytes ?? 0}
        percentOfQuota={stats?.disk.percentOfQuota ?? 0}
      />
    </div>
  );
}

/**
 * Extracted so its badge behavior (#134 trace-updated dot, #278 hidden-errors
 * dot) is unit-testable without pulling the full DesktopShell surface + its
 * SSE/Auth/Sandbox context tree. Pure props in, JSX out.
 */
export function WorkspaceViewTabs({
  currentView,
  onSelect,
  hiddenErrorsUnread,
  traceUnread,
  t,
}: {
  currentView: "chat" | "agents" | "trace";
  onSelect: (view: "chat" | "agents" | "trace") => void;
  hiddenErrorsUnread: boolean;
  traceUnread: boolean;
  t: (key: string) => string;
}) {
  return (
    <div className="workspace-view-tabs workspace-view-tabs--icon-only" role="tablist" aria-label={t("shell.aria.viewTabs")}>
      <button
        aria-selected={currentView === "chat"}
        className={currentView === "chat" ? "is-active" : ""}
        onClick={() => onSelect("chat")}
        role="tab"
        title={t("shell.view.chat")}
        type="button"
      >
        <MessageSquare size={14} />
        <span className="sr-only">{t("shell.view.chat")}</span>
      </button>
      <button
        aria-selected={currentView === "agents"}
        className={`workspace-view-tab--badged ${currentView === "agents" ? "is-active" : ""}`}
        onClick={() => onSelect("agents")}
        role="tab"
        title={t("shell.view.agents")}
        type="button"
      >
        <Bot size={14} />
        <span className="sr-only">{t("shell.view.agents")}</span>
        {/* Issue #278 — quiet red dot: non-fatal errors were folded out
            of the chat stream for this session and the user hasn't
            opened the Agents view since. Cleared on open. */}
        {hiddenErrorsUnread && currentView !== "agents" ? (
          <span
            className="workspace-view-tab__badge"
            aria-label={t("shell.view.agentsHasErrors")}
            role="status"
          />
        ) : null}
      </button>
      <button
        aria-selected={currentView === "trace"}
        className={`workspace-view-tab--badged ${currentView === "trace" ? "is-active" : ""}`}
        onClick={() => onSelect("trace")}
        role="tab"
        title={t("shell.view.trace")}
        type="button"
      >
        <GitBranch size={14} />
        <span className="sr-only">{t("shell.view.trace")}</span>
        {/* #134 — quiet unread dot: trace changed for this session and
            the user hasn't opened the Trace view since. Cleared on open. */}
        {traceUnread && currentView !== "trace" ? (
          <span
            className="workspace-view-tab__badge"
            aria-label={t("shell.view.traceUpdated")}
            role="status"
          />
        ) : null}
      </button>
    </div>
  );
}
