import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Bot, CloudOff, FolderOpen, GitBranch, MessageSquare, RefreshCw } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { useSandbox } from "../../contexts/SandboxContext";
import { DRAFT_SESSION_ID, useSessions } from "../../contexts/SessionContext";
import { draftStore } from "../../contexts/draftStore";
import { useT } from "../../i18n/useT";
import { runtimeConfig } from "../../config";
import { appendFileReference } from "../chat/mentionLogic";
import { PromptComposer } from "../chat/PromptComposer";
import { FileSidebar } from "../files/FileSidebar";
import { fileRequestForScope, fileSidebarScopeKey } from "../files/fileSidebarScope";
import { IconButton } from "../primitives/IconButton";
import { pluginMarketplaceSurface } from "../plugins/pluginMarketplaceAvailability";
import { SearchDialog } from "../search/SearchDialog";
import { SettingsDialog, type SettingsTab } from "../settings/SettingsDialog";
import { AgentsPanel, TracePanel } from "../session/AgentTraceViews";
import { SandboxBuildingOverlay } from "./SandboxBuildingOverlay";
import { SandboxStatus } from "./SandboxStatus";
import { Sidebar } from "../sidebar/Sidebar";
import { DiskQuotaWarningDialog } from "../quota/DiskQuotaWarningDialog";
import { DiskQuotaCriticalDialog } from "../quota/DiskQuotaCriticalDialog";
import { DEFAULT_SIDEBAR_WIDTH, resolveResize } from "./sidebarResize";
import { navigateWorkspace, useWorkspaceLocation, workspacePage, writeWorkspaceLocation } from "./workspaceNavigation";
import {
  buildWorkspaceFileDeepLink,
  parseWorkspaceFileLocation,
  parseWorkspaceFileHref,
  resolveWorkspaceFileSession,
  shouldResetWorkspaceFileLocation,
  type WorkspaceFileTarget,
} from "../chat/workspaceFileLink";

const DemoView = lazy(() => import("../demo/DemoView").then((module) => ({ default: module.DemoView })));
const PluginMarketplace = lazy(() => import("../plugins/PluginMarketplace").then((module) => ({ default: module.PluginMarketplace })));

export function DesktopShell() {
  const { isAuthReady } = useAuth();
  const { currentSandbox, operation, error, stats } = useSandbox();
  const {
    sessions,
    sessionsListStatus,
    currentSession,
    isDraft,
    currentView,
    isRefreshingMessages,
    refreshMessages,
    selectSession,
    startDraftSession,
    setCurrentView,
    traceUnread,
    hiddenErrorsUnread,
  } = useSessions();
  const t = useT();
  // #131 — the sidebar collapses to an icon rail either manually (user toggle)
  // or automatically at narrow widths. Both feed the same `isCollapsed` state so
  // the collapsed rail's session popover trigger is available in both cases. A
  // manual toggle wins until the viewport crosses the breakpoint again.
  const [userCollapsed, setUserCollapsed] = useState<boolean | null>(null);
  const [isNarrow, setIsNarrow] = useState(false);
  const isSidebarCollapsed = userCollapsed ?? isNarrow;
  const location = useWorkspaceLocation();
  const activePage = workspacePage(location);
  const setActivePage = navigateWorkspace;
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
  const [settingsReturnFocusTo, setSettingsReturnFocusTo] = useState<HTMLElement | null>(null);
  const openSettings = (tab?: SettingsTab, trigger?: HTMLElement) => {
    setSettingsInitialTab(tab);
    setSettingsReturnFocusTo(
      trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null),
    );
    setIsSettingsOpen(true);
  };
  const [isFilesOpen, setIsFilesOpen] = useState(false);
  const [hasUnsavedFileChanges, setHasUnsavedFileChanges] = useState(false);
  const [openFileRequest, setOpenFileRequest] = useState<(
    WorkspaceFileTarget & { requestId: number; scopeKey: string }
  ) | null>(null);
  const [fileSidebarWidth, setFileSidebarWidth] = useState(420);
  const [isFileSidebarResizing, setIsFileSidebarResizing] = useState(false);
  const [sandboxOverlayDismissed, setSandboxOverlayDismissed] = useState(false);
  const [isWarningOpen, setIsWarningOpen] = useState(false);
  const hasWarnedRef = useRef(false);
  const initialWorkspaceFileTargetRef = useRef(
    typeof window === "undefined" || activePage !== "workspace" ? null : parseWorkspaceFileLocation(window.location),
  );
  const deepLinkHandledRef = useRef(false);
  const previousSessionIdRef = useRef<string | null | undefined>(currentSession?.id);
  const openFileRequestIdRef = useRef(0);
  const sidebarResizeRef = useRef<{ pointerX: number; width: number } | null>(null);
  const confirmFileNavigation = useCallback(
    () => !hasUnsavedFileChanges || window.confirm(t("files.editor.confirmDiscard")),
    [hasUnsavedFileChanges, t],
  );
  const openWorkspaceFile = useCallback((target: WorkspaceFileTarget) => {
    if (!currentSession?.id && (!runtimeConfig.localMode || !target.path.startsWith("/data/"))) return;
    setIsFilesOpen(true);
    openFileRequestIdRef.current += 1;
    setOpenFileRequest({
      ...target,
      requestId: openFileRequestIdRef.current,
      scopeKey: fileSidebarScopeKey(currentSession?.id),
    });
    if (currentSession?.id) writeWorkspaceLocation(buildWorkspaceFileDeepLink(currentSession.id, target), true);
  }, [currentSession?.id]);

  /**
   * The single exit for every *explicit* close / hand-off of the Files pane
   * (pane close, preview close, "Use in conversation"). Each of those used to
   * drop the open request but leave `/sessions/:id/files?path=…` in the address
   * bar, so a reload — or just reading the URL — claimed a file the workspace
   * was no longer showing. Only called after the existing unsaved-changes
   * confirmation, and never from a state sync, so an initial deep link that has
   * not been applied yet is never wiped by the Files panel's transient empty
   * selection.
   */
  const clearWorkspaceFileLocation = useCallback(() => {
    setOpenFileRequest(null);
    // An explicit close also retires a deep link that is still pending: the user
    // has said what they want to look at, and it isn't that file.
    deepLinkHandledRef.current = true;
    if (typeof window === "undefined" || !parseWorkspaceFileLocation(window.location)) return;
    writeWorkspaceLocation(runtimeConfig.localMode ? "/" : "/app", true);
  }, []);

  /**
   * The Files tree reporting which file it is *showing*. Only updates the URL —
   * it must not feed `openFileRequest`, or the panel would be re-driven by its
   * own selection on every click.
   */
  const handleFileSelectionLocation = useCallback((target: WorkspaceFileTarget | null) => {
    if (!target) {
      clearWorkspaceFileLocation();
      return;
    }
    if (!currentSession?.id) return;
    // A user-selected tree file supersedes a still-loading link to another file.
    // Clearing the request cancels that effect; do not create a feedback request.
    setOpenFileRequest((current) => current?.path === target.path ? current : null);
    deepLinkHandledRef.current = true;
    writeWorkspaceLocation(buildWorkspaceFileDeepLink(currentSession.id, target), true);
  }, [clearWorkspaceFileLocation, currentSession?.id]);

  useEffect(() => {
    const previousSessionId = previousSessionIdRef.current;
    const nextSessionId = currentSession?.id;
    previousSessionIdRef.current = nextSessionId;
    if (!shouldResetWorkspaceFileLocation({
      location: window.location,
      previousSessionId,
      nextSessionId,
      hasInitialTarget: initialWorkspaceFileTargetRef.current !== null,
      initialTargetHandled: deepLinkHandledRef.current,
    })) return;
    setOpenFileRequest(null);
    writeWorkspaceLocation(runtimeConfig.localMode ? "/" : "/app", true);
  }, [currentSession?.id]);

  const useFileInConversation = useCallback((path: string) => {
    const composerScope = currentSession?.id ?? (isDraft ? DRAFT_SESSION_ID : null);
    if (!composerScope) return;
    draftStore.set(
      composerScope,
      appendFileReference(draftStore.get(composerScope), path),
    );
    setCurrentView("chat");
    clearWorkspaceFileLocation();
    setIsFilesOpen(false);
    requestAnimationFrame(() => {
      const input = document.getElementById("prompt-input") as HTMLTextAreaElement | null;
      if (!input) return;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
  }, [clearWorkspaceFileLocation, currentSession?.id, isDraft, setCurrentView]);

  const useDataset = (path: string) => {
    if (!confirmFileNavigation()) return;
    draftStore.set(DRAFT_SESSION_ID, appendFileReference(draftStore.get(DRAFT_SESSION_ID), path));
    startDraftSession();
    setIsFilesOpen(false);
    setOpenFileRequest(null);
    setActivePage("workspace");
    requestAnimationFrame(() => document.getElementById("prompt-input")?.focus());
  };

  useEffect(() => {
    const initialTarget = initialWorkspaceFileTargetRef.current;
    if (deepLinkHandledRef.current || !initialTarget || sessionsListStatus !== "ready") return;

    const resolved = resolveWorkspaceFileSession(
      initialTarget,
      sessions.map((session) => session.id),
      currentSession?.id,
    );
    if (!resolved) {
      deepLinkHandledRef.current = true;
      return;
    }

    if (currentSession?.id !== resolved.sessionId) {
      selectSession(resolved.sessionId);
      return;
    }

    deepLinkHandledRef.current = true;
    setActivePage("workspace");
    setCurrentView("chat");
    openWorkspaceFile(resolved);
  }, [
    currentSession?.id,
    openWorkspaceFile,
    selectSession,
    sessions,
    sessionsListStatus,
    setCurrentView,
  ]);

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
        onOpenSettings={(trigger) => openSettings(undefined, trigger)}
        onOpenSearch={() => setIsSearchOpen(true)}
        onResizeStart={(pointerX) => {
          if (isSidebarCollapsed) {
            return;
          }

          sidebarResizeRef.current = { pointerX, width: sidebarWidth };
          setIsSidebarResizing(true);
        }}
        onToggle={() => setUserCollapsed(!isSidebarCollapsed)}
        confirmNavigation={confirmFileNavigation}
      />

      {activePage === "demo" ? (
        <Suspense fallback={<main className="plugin-market__empty" role="status">{t("sidebar.loading")}</main>}>
          <DemoView resetSignal={demoResetSignal} />
        </Suspense>
      ) : activePage === "plugins" ? pluginMarketplaceSurface(runtimeConfig.pluginsSettingsEnabled) === "unavailable" ? (
        <ResourcesUnavailablePage onReturnToWorkspace={() => setActivePage("workspace")} t={t} />
      ) : (
        <Suspense fallback={<main className="plugin-market"><div className="plugin-market__empty"><strong>{t("marketplace.loading")}</strong></div></main>}>
          <PluginMarketplace
            onOpenKnowledgeBase={runtimeConfig.knowledgeBaseSettingsEnabled ? (trigger) => openSettings("knowledgeBase", trigger) : undefined}
            onUseDataset={useDataset}
            onOpenDataset={(path) => {
              if (!confirmFileNavigation()) return;
              setActivePage("workspace");
              openWorkspaceFile({ path });
            }}
          />
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
                the sidebar). The id is debug-only metadata — it stays available
                as the hover tooltip, but is no longer printed in the toolbar,
                where a truncated hash read as part of the conversation's name.
                Falls back to `Session <id8>` when the title is missing. */}
            <span
              className="session-title__name"
              title={currentSession?.id ?? undefined}
            >
              {currentSession?.title ||
                (currentSession?.id
                  ? `${t("shell.sessionLabel")} ${currentSession.id.slice(0, 8)}`
                  : t("shell.defaultWorkspace"))}
            </span>
          </div>
          <div className="workspace-toolbar__actions">
            {/* #104 kept the view switcher compact, but icon-only tabs left the
                three main surfaces unlabeled until hover. The short label now
                renders next to the icon (badges and tooltips unchanged). */}
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
              onClick={() => {
                if (isFilesOpen) {
                  if (!confirmFileNavigation()) return;
                  clearWorkspaceFileLocation();
                }
                setIsFilesOpen((current) => !current);
              }}
            >
              <FolderOpen size={16} />
            </IconButton>
          </div>
        </header>

        {currentView === "chat" ? (
          <PromptComposer
            onOpenProviderSettings={(trigger) => openSettings("providers", trigger)}
            onOpenWorkspaceFile={openWorkspaceFile}
          />
        ) : null}
        {currentView === "agents" ? <AgentsPanel /> : null}
        {currentView === "trace" ? <TracePanel onSelectArtifact={(path) => {
          const target = parseWorkspaceFileHref(path);
          if (target && confirmFileNavigation()) openWorkspaceFile(target);
        }} /> : null}
        <FileSidebar
          // #403: session-owned tree/selection/preview state must never cross
          // chat boundaries. Remounting invalidates late async state writes
          // while preserving the shell-owned open preference and width.
          key={fileSidebarScopeKey(currentSession?.id)}
          isOpen={isFilesOpen}
          openFileRequest={fileRequestForScope(openFileRequest, currentSession?.id)}
          onClose={() => {
            if (!confirmFileNavigation()) return;
            clearWorkspaceFileLocation();
            setIsFilesOpen(false);
          }}
          onDirtyChange={setHasUnsavedFileChanges}
          onSelectionLocationChange={handleFileSelectionLocation}
          onUseInConversation={useFileInConversation}
          onResize={setFileSidebarWidth}
          onResizeEnd={() => setIsFileSidebarResizing(false)}
          onResizeStart={() => setIsFileSidebarResizing(true)}
          width={fileSidebarWidth}
        />
      </main>
      )}

      <SearchDialog
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onOpenWorkspace={() => setActivePage("workspace")}
        confirmNavigation={confirmFileNavigation}
      />
      <SettingsDialog
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        initialTab={settingsInitialTab}
        returnFocusTo={settingsReturnFocusTo}
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
 * The `?page=plugins` route for a deployment where the Resources capability is
 * switched off. A direct/bookmarked link has to land somewhere truthful: it says
 * the page is unavailable in *this* deployment (it no longer promises a launch
 * that this build knows nothing about) and offers the one action that works.
 */
export function ResourcesUnavailablePage({
  onReturnToWorkspace,
  t,
}: {
  onReturnToWorkspace: () => void;
  t: (key: string) => string;
}) {
  return (
    <main className="plugin-market" aria-labelledby="plugin-market-title">
      <header className="plugin-market__hero">
        <div>
          <span className="plugin-market__eyebrow">{t("marketplace.eyebrow")}</span>
          <h1 id="plugin-market-title">{t("marketplace.title")}</h1>
        </div>
      </header>
      <section className="plugin-market__catalog">
        <div className="plugin-market__unavailable" role="status">
          <span className="plugin-market__unavailable-icon" aria-hidden="true"><CloudOff size={20} /></span>
          <div>
            <h2>{t("marketplace.unavailable.title")}</h2>
            <p>{t("marketplace.unavailable.description")}</p>
            <button
              className="plugin-market__unavailable-cta"
              data-testid="resources-unavailable-return"
              onClick={onReturnToWorkspace}
              type="button"
            >
              {t("marketplace.unavailable.returnToWorkspace")}
            </button>
          </div>
        </div>
      </section>
    </main>
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
    <div className="workspace-view-tabs" role="tablist" aria-label={t("shell.aria.viewTabs")}>
      <button
        aria-selected={currentView === "chat"}
        className={currentView === "chat" ? "is-active" : ""}
        onClick={() => onSelect("chat")}
        role="tab"
        title={t("shell.view.chat")}
        type="button"
      >
        <MessageSquare size={14} />
        <span className="workspace-view-tab__label">{t("shell.view.chat")}</span>
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
        <span className="workspace-view-tab__label">{t("shell.view.agents")}</span>
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
        <span className="workspace-view-tab__label">{t("shell.view.trace")}</span>
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
