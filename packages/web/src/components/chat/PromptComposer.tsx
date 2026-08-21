import { Bot, CircleAlert, Paperclip, Square, X } from "lucide-react";
import { FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ProviderProfile, ThinkingLevel } from "../../contracts/backend";
import { useSandbox } from "../../contexts/SandboxContext";
import { DRAFT_SESSION_ID, useSessions } from "../../contexts/SessionContext";
import { latestDurableUserTurn, useTurnTimer } from "../../contexts/useTurnTimer";
import { draftStore } from "../../contexts/draftStore";
import { writeRecoveryDraft } from "../../contexts/errorRecovery";
import { applyMessageFilters } from "../../contexts/messageFilters";
import { runningToastLabel } from "../../contexts/runningToast";
import { useT } from "../../i18n/useT";
import { api, isUploadAbortError, type UploadProgress } from "../../utils/api";
import { IconButton } from "../primitives/IconButton";
import { UploadProgressBar } from "../primitives/UploadProgressBar";
import { AskUserComposer } from "./AskUserComposer";
import {
  attachmentStore,
  deleteScopedAttachmentFile,
  reconcileAttachmentScope,
  reconcileVisibleAttachments,
  useAttachments,
} from "./attachmentScopes";
import { reservePastedImages } from "./clipboardImages";
import { ComposerInput, type MentionSources } from "./ComposerInput";
import { recoverFailedSubmission } from "./composerRecovery";
import { ComposerSendButton } from "./ComposerSendButton";
import { ComposerSendTools } from "./ComposerSendTools";
import {
  ProviderModelControl,
  selectedModelStatus,
  selectedModelSupportsReasoning,
} from "./ProviderModelControl";
import { MessageStream } from "./MessageStream";
import type { WorkspaceFileTarget } from "./workspaceFileLink";
import { RunningScriptsPanel } from "./RunningScriptsPanel";
import { selectActiveScripts } from "./runningScripts";
import { shouldShowNoProviderBanner } from "./noProviderBanner";
import {
  composerPlaceholderKey,
  placeholderAvailabilityFromSources,
  type MentionFile,
  type MentionPlugin,
  type SourceStatus,
} from "./mentionLogic";

/** #305: in-flight attachment upload state for the progress row. */
type ComposerUploadState = {
  filename: string;
  fileIndex: number;
  fileCount: number;
  fileSize: number;
  percent: number | null;
  phase: UploadProgress["phase"];
};

type ComposerAttachment = {
  name: string;
  type?: string;
  previewUrl?: string;
};

type QueuedUpload = {
  file: File;
  uploadId: string;
  scopeId: string;
};

type QueuedPrompt = { id: string; content: string };

function attachmentOperationKey(scopeId: string, filename: string): string {
  return `${scopeId}\0${filename}`;
}

export function shouldClearQueuedPrompts(runActive: { active: boolean } | null): boolean {
  return runActive?.active !== true;
}

export function resolveComposerReasoningSupport(input: {
  isDraft: boolean;
  sessionReasoningSupported?: boolean;
  selectedModel: string;
  activeProviderModels: readonly string[];
  activeProviderReasoningModels?: readonly string[];
}): boolean {
  if (!input.isDraft) return input.sessionReasoningSupported === true;
  return Boolean(
    input.selectedModel
    && (input.activeProviderReasoningModels ?? input.activeProviderModels).includes(input.selectedModel),
  );
}

export function mergeProviderHealth(
  profiles: ProviderProfile[],
  healthProfiles: ProviderProfile[],
): ProviderProfile[] {
  return profiles.map((profile) => {
    const health = healthProfiles.find((item) => item.id === profile.id);
    return health
      ? {
          ...profile,
          healthStatus: health.healthStatus,
          healthCheckedAt: health.healthCheckedAt,
          modelHealth: health.modelHealth,
        }
      : profile;
  });
}

export function selectAvailableDraftModel(
  provider: ProviderProfile | null,
  candidates: Array<string | undefined>,
): string {
  if (!provider) return "";
  const configuredCandidates = candidates.filter(
    (model): model is string => Boolean(model && provider.models.includes(model)),
  );
  return configuredCandidates.find((model) => selectedModelStatus(provider, model) !== "unavailable")
    ?? provider.models.find((model) => selectedModelStatus(provider, model) !== "unavailable")
    ?? configuredCandidates[0]
    ?? provider.models[0]
    ?? "";
}

export function resolveComposerCanSend(input: {
  sandboxRunning: boolean;
  isSending: boolean;
  uploading: boolean;
  connectedOrDraft: boolean;
  draftModelUnavailable: boolean;
}): boolean {
  return input.sandboxRunning &&
    !input.isSending &&
    !input.uploading &&
    input.connectedOrDraft &&
    !input.draftModelUnavailable;
}

function revokeAttachmentPreview(attachment: ComposerAttachment): void {
  if (attachment.previewUrl && typeof URL !== "undefined" && "revokeObjectURL" in URL) {
    URL.revokeObjectURL(attachment.previewUrl);
  }
}

type PromptComposerProps = {
  /** Open Settings deep-linked to the Providers tab — wired to the
   *  no-provider banner's CTA. Optional so the composer still renders standalone
   *  (e.g. in tests). */
  onOpenProviderSettings?: (trigger?: HTMLElement) => void;
  onOpenWorkspaceFile?: (target: WorkspaceFileTarget) => void;
};

export function PromptComposer({ onOpenProviderSettings, onOpenWorkspaceFile }: PromptComposerProps = {}) {
  const t = useT();
  const [suggestedTasks, setSuggestedTasks] = useState<string[]>([]);
  const [providerProfiles, setProviderProfiles] = useState<ProviderProfile[]>([]);
  const [activeProvider, setActiveProvider] = useState<ProviderProfile | null>(null);
  // Distinguishes "provider load hasn't resolved yet" from "loaded, none
  // active" so the no-provider banner doesn't flash during initial load.
  const [providersLoaded, setProvidersLoaded] = useState(false);
  const [selectedModel, setSelectedModel] = useState("");
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>("medium");
  // 可用命令（已通过真实 API 测试 /context ✅ /cost ✅；/compact 由 SDK 内置 ✅）
  // 不可用命令（已移除）：/usage ❌ /clear ❌ /init ❌
  const DEFAULT_SLASH_COMMANDS = ["/compact", "/context", "/cost"];
  // issue #43: temporarily hide the whole slash-command button until the
  // dynamic command list (GET /sessions/:id/commands) is implemented backend
  // side. Flip to true to restore. Code below is kept intact for that.
  const SHOW_SLASH_COMMANDS = false;
  const [slashCommands, setSlashCommands] = useState<string[]>(DEFAULT_SLASH_COMMANDS);

  const [showCommands, setShowCommands] = useState(false);
  const commandsRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  // #47: file upload — names of files uploaded into the workspace this turn,
  // shown as removable chips and announced to the agent on send. (Restored: the
  // backend upload chain — writeFile route + #60 staging/drain — was always
  // present; only this composer UI was removed in #160. It now lives in the
  // left tool cluster, not the send cluster guarded by composerSendTools.test.)
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [queuedPromptsBySession, setQueuedPromptsBySession] = useState<Record<string, QueuedPrompt[]>>({});
  const attachmentsRef = useRef<ComposerAttachment[]>([]);
  // #305: replace boolean busy with full progress UI state; null = idle.
  const [uploadState, setUploadState] = useState<ComposerUploadState | null>(null);
  const [queuedUploadCount, setQueuedUploadCount] = useState(0);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const uploadQueueRef = useRef<QueuedUpload[]>([]);
  const uploadWorkerRef = useRef<Promise<void> | null>(null);
  const pendingUploadKeysRef = useRef(new Set<string>());
  const reservedUploadNamesRef = useRef(new Set<string>());
  const { status: sandboxStatus, currentSandbox, reloadConfig } = useSandbox();
  const [composerError, setComposerError] = useState<string | null>(null);
  const [stagingError, setStagingError] = useState<string | null>(null);
  const [draftStagingReady, setDraftStagingReady] = useState(false);
  const [removingAttachmentKeys, setRemovingAttachmentKeys] = useState<ReadonlySet<string>>(new Set());
  const uploading = uploadState != null || queuedUploadCount > 0;
  const { currentSession, messages, isSending, error, sendPrompt, updateSessionThinking, isConnected, isDraft, startDraftSession, agents, runActive, workActive, agentFilters, interruptCurrent, interruptTool, isInterrupting, interruptingToolIds, respondToInput, messageFilters } = useSessions();
  const sessionId = currentSession?.id ?? (isDraft ? DRAFT_SESSION_ID : null);
  const persistedAttachmentNames = useAttachments(sessionId);
  const attachmentScopeRef = useRef<string | null>(sessionId);
  const activeTools = useMemo(
    () => agents.some((agent) => agent.activeTools !== undefined)
      ? agents.flatMap((agent) => agent.activeTools ?? [])
      : undefined,
    [agents],
  );
  const draftModelUnavailable = isDraft &&
    Boolean(activeProvider && selectedModel) &&
    selectedModelStatus(activeProvider, selectedModel) === "unavailable";
  // In draft mode there's no session/connection yet. Allow the first send only
  // after recovered attachments have finished staging and unless health already
  // says the selected model cannot run.
  const canSend = resolveComposerCanSend({
    sandboxRunning: sandboxStatus === "running",
    isSending,
    uploading,
    connectedOrDraft: isConnected || isDraft,
    draftModelUnavailable,
  }) && (!isDraft || draftStagingReady);
  const reasoningSupported = resolveComposerReasoningSupport({
    isDraft,
    sessionReasoningSupported: currentSession?.reasoningSupported,
    selectedModel,
    activeProviderModels: activeProvider?.models ?? [],
    activeProviderReasoningModels: activeProvider?.reasoningModels,
  });

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => {
    const reconciled = reconcileVisibleAttachments(
      attachmentsRef.current,
      persistedAttachmentNames,
      attachmentScopeRef.current === sessionId,
    );
    attachmentScopeRef.current = sessionId;
    attachmentsRef.current = reconciled.attachments;
    reconciled.revoked.forEach(revokeAttachmentPreview);
    setAttachments(reconciled.attachments);
    for (const name of persistedAttachmentNames) reservedUploadNamesRef.current.add(name);
  }, [persistedAttachmentNames, sessionId]);

  useEffect(() => {
    if (!currentSandbox?.id || currentSandbox.status !== "running") {
      setDraftStagingReady(false);
      return;
    }
    let cancelled = false;
    setDraftStagingReady(false);
    setStagingError(null);
    void reconcileAttachmentScope({
      store: attachmentStore,
      scopeId: DRAFT_SESSION_ID,
      listFiles: async () => (await api.sandbox.listFiles(currentSandbox.id, "/attachments"))
        .filter((entry) => entry.type === "file")
        .map((entry) => entry.name),
      deleteFile: (name) => api.sandbox.deleteFile(currentSandbox.id, `/attachments/${name}`),
      deleteUntracked: true,
      isUploadPending: (name) => pendingUploadKeysRef.current.has(attachmentOperationKey(DRAFT_SESSION_ID, name)),
    }).then(({ failedDeletes }) => {
      if (cancelled) return;
      if (failedDeletes.length > 0) {
        setStagingError(t("chat.upload.cleanupFailed", { msg: failedDeletes.join(", ") }));
        return;
      }
      setDraftStagingReady(true);
    }).catch((error: unknown) => {
      if (cancelled) return;
      const msg = error instanceof Error ? error.message : String(error);
      setStagingError(t("chat.upload.cleanupFailed", { msg }));
    });
    return () => {
      cancelled = true;
    };
  }, [currentSandbox?.id, currentSandbox?.status, isDraft, t]);

  useEffect(() => {
    if (!currentSession?.id || currentSandbox?.status !== "running") return;
    const scopeId = currentSession.id;
    let cancelled = false;
    setStagingError(null);
    void reconcileAttachmentScope({
      store: attachmentStore,
      scopeId,
      listFiles: async () => (await api.sandbox.listFiles(scopeId, "/attachments"))
        .filter((entry) => entry.type === "file")
        .map((entry) => entry.name),
      deleteFile: (name) => api.sandbox.deleteFile(scopeId, `/attachments/${name}`),
      deleteUntracked: false,
      isUploadPending: (name) => pendingUploadKeysRef.current.has(attachmentOperationKey(scopeId, name)),
    }).catch((error: unknown) => {
      if (cancelled) return;
      const msg = error instanceof Error ? error.message : String(error);
      setStagingError(t("chat.upload.cleanupFailed", { msg }));
    });
    return () => {
      cancelled = true;
    };
  }, [currentSession?.id, currentSandbox?.status, t]);

  useEffect(() => {
    if (currentSession?.thinkingLevel) setThinkingLevel(currentSession.thinkingLevel);
    else if (isDraft) setThinkingLevel("medium");
  }, [currentSession?.id, currentSession?.thinkingLevel, isDraft]);

  useEffect(() => () => {
    uploadAbortRef.current?.abort();
    uploadQueueRef.current = [];
    attachmentsRef.current.forEach(revokeAttachmentPreview);
  }, []);

  // #316: sources for the `@` mention picker. Loaded here (not in ComposerInput)
  // so keystroke state stays off this render path; only status flips re-render.
  const [pluginSource, setPluginSource] = useState<SourceStatus<MentionPlugin>>({ state: "loading" });
  const [fileSource, setFileSource] = useState<SourceStatus<MentionFile>>({ state: "idle" });
  // No provider configured: after the first load resolves, there's no active
  // provider. Surface a persistent banner + CTA so a first-run user isn't left
  // to discover it only by sending a message and hitting an opaque error. The CTA
  // deep-links to Settings → Providers (wired by the parent shell).
  const showNoProviderBanner = shouldShowNoProviderBanner({
    providersLoaded,
    hasActiveProvider: Boolean(activeProvider),
    hasCta: Boolean(onOpenProviderSettings),
  });

  const visibleMessages = useMemo(() => {
    const agentFiltered = messages.filter((msg) => {
      if (msg.role === "user") return true;
      const agent = msg.agent || "principal";
      const filters = agentFilters[agent];
      if (!filters) return true;
      // "隐藏消息" 只隐藏普通消息，不碰 tool / hook
      if (filters.hideMessages && msg.kind !== "tool" && msg.kind !== "hook") return false;
      // "隐藏工具调用" 只隐藏 tool
      if (filters.hideTools && msg.kind === "tool") return false;
      // "隐藏 Hooks" 只隐藏 hook
      if (filters.hideHooks && msg.kind === "hook") return false;
      return true;
    });
    return applyMessageFilters(agentFiltered, messageFilters);
  }, [messages, agentFilters, messageFilters]);

  const hasMessages = visibleMessages.length > 0;

  // #272: the latest unanswered ask_user request, if any. While one is pending
  // the composer is replaced by AskUserComposer (a takeover picker) so a user
  // can't type an ordinary message and hang the session. There is no escape
  // hatch — the user must pick an option or type a free-text answer.
  const askTakeover = useMemo(() => {
    for (let i = visibleMessages.length - 1; i >= 0; i--) {
      const m = visibleMessages[i];
      if (
        m.kind === "ask_user"
        && m.askUser
        && (m.askUser.status ?? (m.askUser.answer === undefined ? "pending" : "answered")) === "pending"
      ) {
        return m.askUser;
      }
    }
    return null;
  }, [visibleMessages]);

  const isAgentRunning = agents.some((a) => a.status === "running");
  const lastAssistantStreaming = visibleMessages[visibleMessages.length - 1]?.role === "assistant" && visibleMessages[visibleMessages.length - 1]?.streaming;
  // A bash tool is in flight iff selectActiveScripts finds anything; when it
  // does, the RunningScriptsPanel below the toast owns the Stop button so
  // we don't render a duplicate. When no scripts are running (e.g. the agent
  // is thinking or streaming text), the toast keeps its own Stop.
  const hasActiveScripts = useMemo(
    () => selectActiveScripts(visibleMessages, activeTools).length > 0,
    [visibleMessages, activeTools],
  );

  // Agents whose run is still active. Threaded to MessageStream so a folded
  // activity block stays "in progress" across ReAct rounds — without this, the
  // per-message streaming flags all clear between rounds and the block flashes
  // "完成思考" in the gap. Memoized so its identity is stable for MessageStream's
  // memo() (a fresh Set each render would defeat the memoization).
  const runningAgents = useMemo(
    () => new Set(agents.filter((a) => a.status === "running").map((a) => a.name)),
    [agents],
  );

  // Names of agents actively working, for the "X 正在工作" toast. Excludes the
  // trace agent (it self-records continuously and isn't "the user's task"),
  // matching the runtime's run-active aggregation (#76).
  const workingAgentNames = useMemo(
    () => agents.filter((a) => a.status === "running" && a.name !== "trace").map((a) => a.name),
    [agents],
  );
  // Prefer the principal when multiple provider calls are backing off: this is
  // the existing user-facing "principal is working" bubble requested by #365.
  const retryingAgent = useMemo(() => {
    const working = agents.filter((a) => a.status === "running" && a.name !== "trace" && a.retry);
    const agent = working.find((a) => a.name === "principal") ?? working[0];
    return agent?.retry ? { name: agent.name, ...agent.retry } : undefined;
  }, [agents]);

  useEffect(() => {
    let cancelled = false;
    void api.ui.promptSuggestions().then((suggestions) => {
      if (!cancelled) {
        setSuggestedTasks(suggestions);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load runtime-confirmed MCP servers for `@` mention candidates, including
  // servers contributed by enabled marketplace plugins.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setPluginSource((prev) => (prev.state === "ready" ? prev : { state: "loading" }));
      try {
        const status = await api.mcpRuntime.status();
        if (cancelled) return;
        const ready = status.servers.filter((server) => server.state === "ready");
        const failures = status.servers.filter((server) => server.state === "failed");
        if (ready.length === 0 && failures.length > 0) {
          setPluginSource({
            state: "error",
            message: failures.map((server) => `${server.name}: ${server.error ?? "failed to start"}`).join("; "),
          });
          return;
        }
        setPluginSource({
          state: "ready",
          items: ready.map((server) => ({ name: server.name })),
        });
      } catch (err) {
        if (cancelled) return;
        setPluginSource({
          state: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    };
    void load();
    // Refresh when provider profiles update is a weak proxy; also re-fetch on
    // focus so Settings → Tools changes show up after the dialog closes.
    const onFocus = () => void load();
    const onRuntimeRestarted = () => void load();
    window.addEventListener("focus", onFocus);
    window.addEventListener("brainpilot:runtime-restarted", onRuntimeRestarted);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("brainpilot:runtime-restarted", onRuntimeRestarted);
    };
  }, []);

  // #316/#483: shallow listings for both the current session workspace and the
  // persistent cross-session library. Prefer the real session id; fall back to
  // currentSandbox.id (`"local"` in single-user mode) so draft conversations
  // can still surface persistent files.
  const sandboxIdForFiles = currentSession?.id ?? currentSandbox?.id ?? null;
  useEffect(() => {
    let cancelled = false;
    let loadGeneration = 0;
    if (!sandboxIdForFiles || currentSandbox?.status !== "running") {
      setFileSource({
        state: "unavailable",
        reason: !sandboxIdForFiles ? "no-sandbox" : "not-running",
      });
      return () => {
        cancelled = true;
      };
    }
    const load = async () => {
      const generation = ++loadGeneration;
      setFileSource({ state: "loading" });
      const [workspace, persistent] = await Promise.allSettled([
        api.sandbox.listFiles(sandboxIdForFiles, "/workspace"),
        api.sandbox.listFiles(sandboxIdForFiles, "/data"),
      ]);
      if (cancelled || generation !== loadGeneration) return;

      const items: MentionFile[] = [];
      if (workspace.status === "fulfilled") {
        items.push(...workspace.value.map((entry) => ({
          name: entry.name,
          path: `/workspace/${entry.name}`,
          type: entry.type,
          scope: "session" as const,
        })));
      }
      if (persistent.status === "fulfilled") {
        items.push(...persistent.value.map((entry) => ({
          name: entry.name,
          path: `/data/${entry.name}`,
          type: entry.type,
          scope: "persistent" as const,
        })));
      }

      if (workspace.status === "fulfilled" || persistent.status === "fulfilled") {
        setFileSource({
          state: "ready",
          items,
        });
      } else {
        // Draft + local staging may not expose a listable workspace yet —
        // surface a prerequisite rather than a hard error if neither root is
        // addressable. A working `/data` listing above still counts as ready.
        if (isDraft && !currentSession) {
          setFileSource({ state: "unavailable", reason: "no-session" });
        } else {
          const reasons = [workspace.reason, persistent.reason]
            .map((reason) => reason instanceof Error ? reason.message : String(reason))
            .filter((reason, index, all) => all.indexOf(reason) === index)
            .join("; ");
          setFileSource({
            state: "error",
            message: reasons,
          });
        }
      }
    };
    void load();
    window.addEventListener("brainpilot:files-changed", load);
    window.addEventListener("focus", load);
    return () => {
      cancelled = true;
      window.removeEventListener("brainpilot:files-changed", load);
      window.removeEventListener("focus", load);
    };
  }, [sandboxIdForFiles, currentSandbox?.status, isDraft, currentSession]);

  const mentionSources = useMemo<MentionSources>(
    () => ({ plugins: pluginSource, files: fileSource }),
    [pluginSource, fileSource],
  );

  const composerPlaceholder = t(
    composerPlaceholderKey(placeholderAvailabilityFromSources(pluginSource, fileSource)),
  );

  // issue #43: the dynamic slash-command list (GET /sessions/:id/commands) is
  // not implemented on the backend yet — fetching it 404'd on every selected
  // session. The whole slash-command button is hidden below until that lands,
  // so we no longer fetch and just keep the local DEFAULT_SLASH_COMMANDS.

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (commandsRef.current && !commandsRef.current.contains(event.target as Node)) {
        setShowCommands(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useLayoutEffect(() => {
    if (!showCommands || !commandsRef.current || !menuRef.current) return;
    const buttonRect = commandsRef.current.getBoundingClientRect();
    const menuRect = menuRef.current.getBoundingClientRect();
    setMenuPos({
      top: buttonRect.top - menuRect.height - 6,
      left: buttonRect.left,
    });
  }, [showCommands]);

  useEffect(() => {
    if (!showCommands) return;
    const handleClose = () => setShowCommands(false);
    window.addEventListener("resize", handleClose);
    return () => {
      window.removeEventListener("resize", handleClose);
    };
  }, [showCommands]);

  // Textarea autoresize, key handling, and draft state moved to ComposerInput,
  // which owns the textarea ref and subscribes to draftStore directly.
  // PromptComposer no longer re-renders on keystrokes — that's the whole point
  // of the split.

  useEffect(() => {
    let cancelled = false;
    const loadProviderAndSettings = async () => {
      try {
        const [profiles, settings, healthProfiles] = await Promise.all([
          api.providers.list(),
          api.settings.get(),
          api.providers.health().catch(() => [] as ProviderProfile[]),
        ]);
        if (cancelled) {
          return;
        }
        const enrichedProfiles = mergeProviderHealth(profiles, healthProfiles);
        const provider = (
          !isDraft && currentSession?.providerId
            ? enrichedProfiles.find((item) => item.id === currentSession.providerId)
            : enrichedProfiles.find((item) => item.isActive)
        ) ?? null;
        setProviderProfiles(enrichedProfiles);
        setActiveProvider(provider);
        setProvidersLoaded(true);
        setSelectedModel((current) => {
          if (!isDraft && currentSession?.modelId) return currentSession.modelId;
          return selectAvailableDraftModel(provider, [current, settings.model]);
        });
      } catch {
        if (!cancelled) {
          setProviderProfiles([]);
          setActiveProvider(null);
          setProvidersLoaded(true);
          setSelectedModel("");
        }
      }
    };
    void loadProviderAndSettings();
    window.addEventListener("provider-profiles-updated", loadProviderAndSettings);
    return () => {
      cancelled = true;
      window.removeEventListener("provider-profiles-updated", loadProviderAndSettings);
    };
  }, [currentSession?.id, currentSession?.modelId, currentSession?.providerId, isDraft]);

  useEffect(() => {
    const refreshProvider = async () => {
      try {
        const [profiles, healthProfiles] = await Promise.all([
          api.providers.list(),
          api.providers.health().catch(() => [] as ProviderProfile[]),
        ]);
        const enrichedProfiles = mergeProviderHealth(profiles, healthProfiles);
        const provider = (
          !isDraft && currentSession?.providerId
            ? enrichedProfiles.find((item) => item.id === currentSession.providerId)
            : enrichedProfiles.find((item) => item.isActive)
        ) ?? null;
        setProviderProfiles(enrichedProfiles);
        setActiveProvider(provider);
        setSelectedModel((current) => {
          if (!isDraft && currentSession?.modelId) return currentSession.modelId;
          return selectAvailableDraftModel(provider, [current]);
        });
      } catch {
        // ignore silent refresh errors
      }
    };
    const id = window.setInterval(() => void refreshProvider(), 30000);
    return () => window.clearInterval(id);
  }, [currentSession?.modelId, currentSession?.providerId, isDraft]);

  const queuedPrompts = sessionId ? (queuedPromptsBySession[sessionId] ?? []) : [];

  useEffect(() => {
    if (!sessionId) return;
    const visibleIds = new Set(messages.filter((message) => message.role === "user").map((message) => message.id));
    setQueuedPromptsBySession((current) => {
      const existing = current[sessionId] ?? [];
      const next = existing.filter((prompt) => !visibleIds.has(prompt.id));
      return next.length === existing.length ? current : { ...current, [sessionId]: next };
    });
  }, [messages, sessionId]);

  useEffect(() => {
    if (!sessionId || !shouldClearQueuedPrompts(runActive)) return;
    setQueuedPromptsBySession((current) => (current[sessionId]?.length
      ? { ...current, [sessionId]: [] }
      : current));
  }, [runActive, sessionId]);

  const latestTimedTurn = useMemo(() => latestDurableUserTurn(messages), [messages]);

  const latestInterruption = useMemo(() => {
    if (!latestTimedTurn) return null;
    const prefix = currentSession?.id ? `interrupt:${currentSession.id}:` : "interrupt:";
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.kind !== "system_message" || !message.id.startsWith(prefix)) continue;
      const atMs = Date.parse(message.createdAt);
      if (!Number.isFinite(atMs) || atMs < latestTimedTurn.atMs) return null;
      return {
        id: message.id,
        turnId: message.runId ?? message.id.slice(prefix.length),
        atMs,
      };
    }
    return null;
  }, [currentSession?.id, latestTimedTurn, messages]);

  // #99: whole-turn timer — spans user input → every agent finished (workState
  // settles false), debounced against hook/system re-wakes.
  const turnTiming = useTurnTimer({
    runActive: workActive,
    turn: latestTimedTurn,
    interruption: latestInterruption,
    resetKey: currentSession?.id ?? null,
  });

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!sessionId) return;
    const content = draftStore.get(sessionId).trim();
    if (!content || !canSend || uploadWorkerRef.current) {
      return;
    }
    draftStore.set(sessionId, "");
    // #47: if files were uploaded this turn, prepend a notice so the agent knows
    // they exist in its workspace and can `read` them. Cleared after send.
    const notice =
      attachments.length > 0
        ? `${t("chat.upload.notice", { names: attachments.map((item) => item.name).join(", ") })}\n\n`
        : "";
    const sentAttachments = attachments;
    if (attachments.length > 0) {
      attachmentStore.clear(sessionId);
      setAttachments([]);
    }
    // Carry the chosen provider/model so a freshly-created session records its
    // per-session selection (no-op for an already-running session).
    const result = await sendPrompt(`${notice}${content}`, {
      providerId: activeProvider?.id,
      modelId: selectedModel || undefined,
      thinkingLevel: reasoningSupported ? thinkingLevel : "off",
    });
    if (result.ok && result.queued && result.messageId) {
      setQueuedPromptsBySession((current) => ({
        ...current,
        [sessionId]: [...(current[sessionId] ?? []), { id: result.messageId!, content }],
      }));
    }
    // #106: a failed/timed-out send must not silently eat the user's input.
    // Restore the draft (and attachment chips) so they can retry without
    // retyping. Only restore if they haven't already started typing again.
    if (!result.ok) {
      const recoveryScope = recoverFailedSubmission({
        submittedScopeId: sessionId,
        resultSessionId: result.sessionId,
        content,
        attachmentNames: sentAttachments.map((attachment) => attachment.name),
        drafts: draftStore,
        attachments: attachmentStore,
      });
      if (sentAttachments.length > 0 && attachmentScopeRef.current === recoveryScope) {
        setAttachments((prev) => (prev.length === 0 ? sentAttachments : prev));
      }
    } else {
      attachmentStore.delete(sessionId);
      sentAttachments.forEach(revokeAttachmentPreview);
      for (const attachment of sentAttachments) reservedUploadNamesRef.current.delete(attachment.name);
    }
  };

  // #47: upload the chosen files as CONVERSATION ATTACHMENTS, then track their
  // names as chips. Attachments go to the session's `.attachments/` subdir (via
  // the `/attachments` path prefix) — scoped to the session but kept apart from
  // agent-produced workspace files, and hidden from the file panel. In
  // single-user mode the sandbox id and session id are the same; a draft has no
  // real session yet, so uploads land in the `"local"` staging area and the
  // runtime drains them (incl. `.attachments/`) into the real session on send
  // (#60 drainLocalUploads).
  // One worker drains a queue sequentially. New picker selections and paste
  // batches may append while it is running without replacing progress/cancel
  // state or racing writes to the same attachment path.
  const startUploadWorker = () => {
    if (uploadWorkerRef.current) return;
    const controller = new AbortController();
    uploadAbortRef.current = controller;
    setComposerError(null);
    let processed = 0;
    const worker = (async () => {
      while (!controller.signal.aborted) {
        const entry = uploadQueueRef.current.shift();
        setQueuedUploadCount(uploadQueueRef.current.length);
        if (!entry) break;
        const { file, uploadId, scopeId } = entry;
        setUploadState({
          filename: file.name,
          fileIndex: processed + 1,
          fileCount: processed + 1 + uploadQueueRef.current.length,
          fileSize: file.size,
          percent: null,
          phase: "uploading",
        });
        const wasTracked = attachmentStore.get(scopeId).includes(file.name);
        attachmentStore.add(scopeId, file.name);
        try {
          await api.sandbox.uploadFile(uploadId, `/attachments/${file.name}`, file, {
            signal: controller.signal,
            onProgress: (p) => {
              setUploadState((prev) =>
                prev && prev.filename === file.name
                  ? { ...prev, percent: p.percent, phase: p.phase }
                  : prev,
              );
            },
          });
          const previewUrl = file.type.startsWith("image/")
            && typeof URL !== "undefined"
            && typeof URL.createObjectURL === "function"
            ? URL.createObjectURL(file)
            : undefined;
          const attachment: ComposerAttachment = {
            name: file.name,
            type: file.type || undefined,
            previewUrl,
          };
          if (attachmentScopeRef.current === scopeId) {
            setAttachments((prev) => {
              const existing = prev.find((item) => item.name === attachment.name);
              if (!existing) return [...prev, attachment];
              if (existing.previewUrl !== attachment.previewUrl) revokeAttachmentPreview(existing);
              return prev.map((item) => item.name === attachment.name ? attachment : item);
            });
          } else {
            revokeAttachmentPreview(attachment);
          }
        } catch (e) {
          if (!wasTracked) {
            attachmentStore.remove(scopeId, file.name);
            await api.sandbox.deleteFile(uploadId, `/attachments/${file.name}`).catch(() => undefined);
          }
          reservedUploadNamesRef.current.delete(file.name);
          if (isUploadAbortError(e)) break;
          const msg = e instanceof Error ? e.message : String(e);
          setComposerError(t("chat.upload.failed", { msg }));
        } finally {
          pendingUploadKeysRef.current.delete(attachmentOperationKey(scopeId, file.name));
          processed += 1;
        }
      }
    })();
    uploadWorkerRef.current = worker;
    void worker.finally(() => {
      if (uploadWorkerRef.current !== worker) return;
      uploadWorkerRef.current = null;
      uploadAbortRef.current = null;
      setUploadState(null);
      setQueuedUploadCount(uploadQueueRef.current.length);
      if (fileInputRef.current) fileInputRef.current.value = "";
      // A file can be appended between the empty read and this finally block.
      if (uploadQueueRef.current.length > 0) startUploadWorker();
    });
  };

  const enqueueFiles = (files: FileList | readonly File[] | null): boolean => {
    if (!files || files.length === 0) return false;
    const uploadId = currentSession?.id ?? currentSandbox?.id;
    const scopeId = sessionId;
    if (!uploadId || !scopeId) return false;
    const list = Array.from(files);
    for (const file of list) {
      reservedUploadNamesRef.current.add(file.name);
      pendingUploadKeysRef.current.add(attachmentOperationKey(scopeId, file.name));
      uploadQueueRef.current.push({ file, uploadId, scopeId });
    }
    setQueuedUploadCount(uploadQueueRef.current.length);
    setUploadState((current) => current
      ? { ...current, fileCount: current.fileIndex + uploadQueueRef.current.length }
      : current);
    startUploadWorker();
    return true;
  };

  const handleFilesChosen = (files: FileList | readonly File[] | null) => {
    enqueueFiles(files);
  };

  const cancelUpload = () => {
    for (const entry of uploadQueueRef.current) {
      reservedUploadNamesRef.current.delete(entry.file.name);
      pendingUploadKeysRef.current.delete(attachmentOperationKey(entry.scopeId, entry.file.name));
    }
    uploadQueueRef.current = [];
    setQueuedUploadCount(0);
    uploadAbortRef.current?.abort();
  };

  const handlePastedImages = (images: File[]): boolean => {
    if (!(currentSession?.id ?? currentSandbox?.id)) return false;
    const renamed = reservePastedImages(images, reservedUploadNamesRef.current);
    return enqueueFiles(renamed);
  };

  const removeAttachment = async (name: string) => {
    if (!sessionId) return;
    const scopeId = sessionId;
    const uploadId = currentSession?.id ?? currentSandbox?.id;
    if (!uploadId) return;
    const operationKey = attachmentOperationKey(scopeId, name);
    if (removingAttachmentKeys.has(operationKey)) return;
    setRemovingAttachmentKeys((current) => new Set(current).add(operationKey));
    try {
      await deleteScopedAttachmentFile(
        attachmentStore,
        scopeId,
        name,
        () => api.sandbox.deleteFile(uploadId, `/attachments/${name}`),
      );
      reservedUploadNamesRef.current.delete(name);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setComposerError(t("chat.upload.removeFailed", { msg }));
    } finally {
      setRemovingAttachmentKeys((current) => {
        const next = new Set(current);
        next.delete(operationKey);
        return next;
      });
    }
  };

  // Writes to the draft store from non-text controls (slash command picks,
  // suggestion cards). PromptComposer never reads the draft, so these don't
  // pull it onto the keystroke render path.
  const setDraftFor = (value: string) => {
    if (sessionId) draftStore.set(sessionId, value);
  };

  const handleProviderModelSelection = async (providerId: string, modelId: string) => {
    if (!isDraft) return;
    const provider = providerProfiles.find((item) => item.id === providerId);
    if (
      !provider ||
      !provider.models.includes(modelId) ||
      selectedModelStatus(provider, modelId) === "unavailable"
    ) return;
    const previousProvider = activeProvider;
    const previousModel = selectedModel;
    const previousThinking = thinkingLevel;
    const supportsReasoning = selectedModelSupportsReasoning(provider, modelId);
    setActiveProvider(provider);
    setSelectedModel(modelId);
    setThinkingLevel((current) => supportsReasoning ? (current === "off" ? "medium" : current) : "off");
    setComposerError(null);
    let switchedProvider = false;
    try {
      if (!provider.isActive) {
        await api.providers.setActive(provider.id);
        switchedProvider = true;
        setProviderProfiles((current) => current.map((item) => ({
          ...item,
          isActive: item.id === provider.id,
        })));
      }
      await api.settings.update({ model: modelId });
      await reloadConfig();
    } catch (error) {
      setActiveProvider(previousProvider);
      setSelectedModel(previousModel);
      setThinkingLevel(previousThinking);
      if (switchedProvider && previousProvider) {
        void api.providers.setActive(previousProvider.id).catch(() => {});
        setProviderProfiles((current) => current.map((item) => ({
          ...item,
          isActive: item.id === previousProvider.id,
        })));
      }
      const message = error instanceof Error ? error.message : String(error);
      setComposerError(t("chat.error.saveModel", { msg: message }));
    }
  };

  const handleThinkingLevelChange = async (next: ThinkingLevel) => {
    if (!reasoningSupported) return;
    const previous = thinkingLevel;
    setThinkingLevel(next);
    setComposerError(null);
    if (!currentSession) return;
    try {
      await updateSessionThinking(currentSession.id, next);
    } catch (error) {
      setThinkingLevel(previous);
      setComposerError(error instanceof Error ? error.message : String(error));
    }
  };

  const focusComposerAtEnd = () => {
    requestAnimationFrame(() => {
      const input = document.getElementById("prompt-input") as HTMLTextAreaElement | null;
      if (!input) return;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
  };

  const editFailedPrompt = (prompt: string) => {
    if (!sessionId) return;
    if (!writeRecoveryDraft(
      draftStore,
      sessionId,
      prompt,
      () => window.confirm(t("chat.errorRecovery.replaceDraft")),
    )) return;
    focusComposerAtEnd();
  };

  const retryFailedPrompt = async (prompt: string) => {
    if (!canSend || workActive?.active === true) return;
    const result = await sendPrompt(prompt, {
      thinkingLevel: reasoningSupported ? thinkingLevel : "off",
    });
    if (!result.ok && sessionId && draftStore.get(sessionId).trim().length === 0) {
      draftStore.set(sessionId, prompt);
    }
  };

  const changeModelForFailedPrompt = (prompt?: string) => {
    if (prompt && !writeRecoveryDraft(
      draftStore,
      DRAFT_SESSION_ID,
      prompt,
      () => window.confirm(t("chat.errorRecovery.replaceDraft")),
    )) return;
    startDraftSession();
    // Existing sessions freeze provider/model. Move the failed prompt into a
    // new draft, then open whichever model control is present (main or #494).
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const trigger = document.querySelector<HTMLButtonElement>(
        ".provider-model-control__trigger, .model-select .custom-select__trigger",
      );
      trigger?.focus();
      trigger?.click();
    }));
  };

  const recoveryBusy = !canSend || workActive?.active === true;
  return (
    <section className={`prompt-home ${hasMessages ? "prompt-home--active" : ""}`} aria-labelledby="prompt-heading">
      <div className="prompt-home__inner">
        {showNoProviderBanner ? (
          <div className="composer-notice" role="alert" data-testid="no-provider-banner">
            <CircleAlert aria-hidden="true" className="composer-notice__icon" size={16} />
            <span className="composer-notice__text">{t("chat.noProvider.banner")}</span>
            <button
              type="button"
              className="composer-notice__cta"
              onClick={(event) => onOpenProviderSettings?.(event.currentTarget)}
            >
              {t("chat.noProvider.cta")}
            </button>
          </div>
        ) : null}

        {hasMessages ? null : <h1 id="prompt-heading">{currentSession?.title ?? t("chat.heading")}</h1>}

        {hasMessages ? (
          <MessageStream
            messages={visibleMessages}
            autoScroll
            scrollKey={sessionId ?? undefined}
            showTiming
            turnTiming={turnTiming}
            runningAgents={runningAgents}
            groupExpertActivity
            onRetryCancel={() => void interruptCurrent()}
            onRetryMessage={(prompt) => void retryFailedPrompt(prompt)}
            onEditMessage={editFailedPrompt}
            onChangeModel={changeModelForFailedPrompt}
            onOpenProviderSettings={onOpenProviderSettings}
            recoveryBusy={recoveryBusy}
            workspaceFileSessionId={currentSession?.id}
            onOpenWorkspaceFile={onOpenWorkspaceFile}
          />
        ) : null}

        {isAgentRunning || lastAssistantStreaming ? (
          <div className="agent-running-toast" role="status" aria-live="polite">
            <span className="agent-running-toast__dot" />
            <span className="agent-running-toast__label">
              {(() => {
                const label = runningToastLabel(workingAgentNames, "、", retryingAgent);
                return t(label.key, label.vars);
              })()}
            </span>
            {hasActiveScripts || runActive?.active !== true ? null : (
              <button
                className="agent-running-toast__stop"
                type="button"
                onClick={() => void interruptCurrent()}
                disabled={isInterrupting}
                aria-label={t("chat.aria.stop")}
                title={t("chat.aria.stop")}
              >
                <Square size={10} fill="currentColor" />
                <span>{isInterrupting ? t("chat.stoppingTask") : t("chat.stopTask")}</span>
              </button>
            )}
          </div>
        ) : null}

        <RunningScriptsPanel
          messages={visibleMessages}
          activeTools={activeTools}
          onStopScript={(id) => void interruptTool(id)}
          onStopTask={() => void interruptCurrent()}
          isStoppingTask={isInterrupting}
          stoppingToolIds={interruptingToolIds}
        />

        {queuedPrompts.length > 0 ? (
          <div className="composer-queue" role="status" aria-live="polite">
            <span className="composer-queue__label">{t("chat.queue.label")}</span>
            {queuedPrompts.map((prompt) => (
              <div className="composer-queue__item" key={prompt.id} title={prompt.content}>
                <span className="agent-running-toast__dot" />
                <span>{prompt.content}</span>
              </div>
            ))}
          </div>
        ) : null}

        {askTakeover ? (
          <AskUserComposer
            view={askTakeover}
            onSubmit={(requestId, answer) => void respondToInput(requestId, answer)}
          />
        ) : (
        <form className="composer" aria-label={t("chat.aria.newPrompt")} onSubmit={handleSubmit}>
          <ComposerInput
            sessionId={sessionId}
            placeholder={composerPlaceholder}
            ariaLabel={t("chat.srAsk")}
            mentionSources={mentionSources}
            onPasteImages={handlePastedImages}
          />

          {attachments.length > 0 || uploadState ? (
            <div className="composer__attachments" aria-label={t("chat.aria.attachFile")}>
              <span className="composer__attachments-label">
                <Paperclip size={11} />
                {t("chat.attachments.label")}
              </span>
              {attachments.map((attachment) => (
                <span className="composer__chip composer__chip--attachment" key={attachment.name}>
                  {attachment.previewUrl ? (
                    <img
                      className="composer__attachment-preview"
                      src={attachment.previewUrl}
                      alt=""
                    />
                  ) : (
                    <Paperclip size={12} />
                  )}
                  <span className="composer__chip-name">{attachment.name}</span>
                  <button
                    type="button"
                    className="composer__chip-remove"
                    aria-label={t("chat.aria.removeAttachment")}
                    onClick={() => void removeAttachment(attachment.name)}
                    disabled={sessionId
                      ? removingAttachmentKeys.has(attachmentOperationKey(sessionId, attachment.name))
                        || pendingUploadKeysRef.current.has(attachmentOperationKey(sessionId, attachment.name))
                      : true}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
              {uploadState ? (
                <div className="composer__upload-progress">
                  <UploadProgressBar
                    filename={uploadState.filename}
                    fileIndex={uploadState.fileIndex}
                    fileCount={uploadState.fileCount}
                    fileSize={uploadState.fileSize}
                    percent={uploadState.percent}
                    phase={uploadState.phase}
                    onCancel={cancelUpload}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="composer__toolbar">
            <div className="composer__tools">
              {/*
                issue #47: 添加上下文 (Plus) has no picker yet — hidden until the
                context-attachment flow exists. The chat.aria.attachContext i18n
                key is kept. Re-add the Plus lucide import when restoring this.
              <IconButton label={t("chat.aria.attachContext")}>
                <Plus size={18} />
              </IconButton>
              */}
              {/*
                #47: file upload. The button lives here in the left tool cluster
                (not the send cluster, which composerSendTools.test.tsx guards
                against an upload control under #160). The hidden <input> is
                clicked programmatically; chosen files upload to the workspace
                root and are announced to the agent on send.
              */}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                style={{ display: "none" }}
                onChange={(e) => void handleFilesChosen(e.target.files)}
              />
              <IconButton
                label={t("chat.aria.attachFile")}
                onClick={() => fileInputRef.current?.click()}
                disabled={!currentSandbox}
              >
                <Paperclip size={17} />
              </IconButton>
              {SHOW_SLASH_COMMANDS && slashCommands.length > 0 && (
                <div className="command-picker" ref={commandsRef}>
                  <IconButton
                    label={t("chat.command")}
                    onClick={() => setShowCommands((s) => !s)}
                    className={`command-trigger ${showCommands ? "is-active" : ""}`}
                  >
                    <span>{t("chat.command")}</span>
                  </IconButton>
                  {showCommands && (
                    <div
                      className="command-picker__menu"
                      ref={menuRef}
                      style={menuPos ? { top: menuPos.top, left: menuPos.left } : { top: -9999, left: -9999 }}
                    >
                      {slashCommands.map((cmd) => (
                        <button
                          key={cmd}
                          className="command-picker__option"
                          type="button"
                          onClick={() => {
                            setDraftFor(cmd);
                            setShowCommands(false);
                          }}
                        >
                          {cmd}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/*
              issue #47: 语音输入 (Mic) had no capture/permission flow and was
              never shipped; #160 removed the file-upload (Paperclip) button that
              also lived in this cluster (upload was never a supported feature).
              The send cluster is now just the model picker + send button.
            */}
            <ComposerSendTools
              modelControl={
                <ProviderModelControl
                  disabled={!providersLoaded}
                  isDraft={isDraft}
                  modelId={selectedModel}
                  onManageProviders={onOpenProviderSettings}
                  onSelectModel={handleProviderModelSelection}
                  onThinkingLevelChange={handleThinkingLevelChange}
                  providerId={activeProvider?.id}
                  providers={providerProfiles}
                  reasoningSupported={reasoningSupported}
                  thinkingLevel={reasoningSupported ? thinkingLevel : "off"}
                />
              }
              sendButton={
                <ComposerSendButton
                  sessionId={sessionId}
                  canSend={canSend}
                  label={t("chat.aria.send")}
                />
              }
            />
          </div>

        </form>
        )}

        {error ? <p className="composer-status composer-status--error">{error}</p> : null}
        {composerError || stagingError ? (
          <p className="composer-status composer-status--error">{composerError ?? stagingError}</p>
        ) : null}
        {!canSend ? (
          <p className="composer-status">
            {draftModelUnavailable
              ? t("chat.status.modelUnavailable")
              : sandboxStatus !== "running"
                ? t("chat.status.startSandbox")
                : isConnected
                  ? t("chat.status.preparing")
                  : t("chat.status.connecting")}
          </p>
        ) : null}

        {!hasMessages && suggestedTasks.length > 0 ? <div className="suggestions" aria-label={t("chat.aria.suggested")}>
          {suggestedTasks.map((task) => (
            <button className="suggestion-row" key={task} onClick={() => setDraftFor(task)} type="button">
              <Bot size={15} />
              <span>{task}</span>
            </button>
          ))}
        </div> : null}
      </div>
    </section>
  );
}
