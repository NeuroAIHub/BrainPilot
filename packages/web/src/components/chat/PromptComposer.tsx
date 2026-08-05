import { Bot, Paperclip, Square, X } from "lucide-react";
import { FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ProviderProfile } from "../../contracts/backend";
import { useSandbox } from "../../contexts/SandboxContext";
import { DRAFT_SESSION_ID, useSessions } from "../../contexts/SessionContext";
import { useTurnTimer } from "../../contexts/useTurnTimer";
import { draftStore } from "../../contexts/draftStore";
import { applyMessageFilters } from "../../contexts/messageFilters";
import { runningToastLabel } from "../../contexts/runningToast";
import { useT } from "../../i18n/useT";
import { api, isUploadAbortError, type UploadProgress } from "../../utils/api";
import { CustomSelect } from "../primitives/CustomSelect";
import { IconButton } from "../primitives/IconButton";
import { UploadProgressBar } from "../primitives/UploadProgressBar";
import { AskUserComposer } from "./AskUserComposer";
import {
  attachmentStore,
  useAttachments,
} from "./attachmentScopes";
import { ComposerInput, type MentionSources } from "./ComposerInput";
import { ComposerSendButton } from "./ComposerSendButton";
import { ComposerSendTools } from "./ComposerSendTools";
import { MessageStream } from "./MessageStream";
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

type QueuedPrompt = { id: string; content: string };

type PromptComposerProps = {
  /** Open Settings deep-linked to the Providers tab — wired to the
   *  no-provider banner's CTA. Optional so the composer still renders standalone
   *  (e.g. in tests). */
  onOpenProviderSettings?: () => void;
};

export function PromptComposer({ onOpenProviderSettings }: PromptComposerProps = {}) {
  const t = useT();
  const [suggestedTasks, setSuggestedTasks] = useState<string[]>([]);
  const [activeProvider, setActiveProvider] = useState<ProviderProfile | null>(null);
  // Distinguishes "provider load hasn't resolved yet" from "loaded, none
  // active" so the no-provider banner doesn't flash during initial load.
  const [providersLoaded, setProvidersLoaded] = useState(false);
  const [selectedModel, setSelectedModel] = useState("");
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
  const [queuedPromptsBySession, setQueuedPromptsBySession] = useState<Record<string, QueuedPrompt[]>>({});
  // #305/#404: progress and cancellation belong to the session that started
  // the upload, so navigating away never paints its result into another chat.
  const [uploadStateBySession, setUploadStateBySession] = useState<Record<string, ComposerUploadState | null>>({});
  const uploadAbortBySessionRef = useRef(new Map<string, AbortController>());
  const { status: sandboxStatus, currentSandbox, reloadConfig } = useSandbox();
  const [composerErrorBySession, setComposerErrorBySession] = useState<Record<string, string | null>>({});
  const { currentSession, messages, isSending, error, sendPrompt, isConnected, isDraft, agents, subagents, runActive, agentFilters, interruptCurrent, interruptTool, isInterrupting, interruptingToolIds, respondToInput, messageFilters } = useSessions();
  const sessionId = currentSession?.id ?? (isDraft ? DRAFT_SESSION_ID : null);
  const attachments = useAttachments(sessionId);
  const uploadState = sessionId ? (uploadStateBySession[sessionId] ?? null) : null;
  const composerError = sessionId ? (composerErrorBySession[sessionId] ?? null) : null;
  const uploading = uploadState != null;
  const setCurrentComposerError = (next: string | null) => {
    if (!sessionId) return;
    setComposerErrorBySession((current) => ({ ...current, [sessionId]: next }));
  };
  useEffect(() => () => {
    for (const controller of uploadAbortBySessionRef.current.values()) controller.abort();
    uploadAbortBySessionRef.current.clear();
  }, []);
  const activeTools = useMemo(
    () => agents.some((agent) => agent.activeTools !== undefined)
      ? agents.flatMap((agent) => agent.activeTools ?? [])
      : undefined,
    [agents],
  );
  // In draft mode there's no session/connection yet — allow composing so the
  // first send can create + connect the session.
  const canSend = sandboxStatus === "running" && !isSending && !uploading && (isConnected || isDraft);

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

  // Names of every actively working persistent agent and isolated subagent.
  // This is intentionally broader than runState.active: background experts
  // remain visible without occupying the Principal's foreground turn (#405).
  const workingAgentNames = useMemo(
    () => [
      ...agents.filter((agent) => agent.status === "running").map((agent) => agent.name),
      ...subagents
        .filter((child) => child.status === "queued" || child.status === "running")
        .map((child) => child.label || child.profile),
    ],
    [agents, subagents],
  );
  // Prefer the principal when multiple provider calls are backing off: this is
  // the existing user-facing "principal is working" bubble requested by #365.
  const retryingAgent = useMemo(() => {
    const working = agents.filter((a) => a.status === "running" && a.retry);
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

  // #316: load MCP servers for `@` mention candidates (global, works in draft).
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setPluginSource((prev) => (prev.state === "ready" ? prev : { state: "loading" }));
      try {
        const servers = await api.mcpServers.list();
        if (cancelled) return;
        setPluginSource({
          state: "ready",
          items: servers.map((s) => ({ name: s.name })),
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
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  // #316: shallow `/workspace` listing when a sandbox id is available.
  // Prefer the real session id; fall back to currentSandbox.id (`"local"` in
  // single-user mode) so draft conversations can still surface files.
  const sandboxIdForFiles = currentSession?.id ?? currentSandbox?.id ?? null;
  useEffect(() => {
    let cancelled = false;
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
      setFileSource({ state: "loading" });
      try {
        const entries = await api.sandbox.listFiles(sandboxIdForFiles, "/workspace");
        if (cancelled) return;
        setFileSource({
          state: "ready",
          items: entries.map((entry) => ({
            name: entry.name,
            path: `/workspace/${entry.name}`,
            type: entry.type,
          })),
        });
      } catch (err) {
        if (cancelled) return;
        // Draft + local staging may not expose a listable workspace yet —
        // surface a prerequisite rather than a hard error.
        if (isDraft && !currentSession) {
          setFileSource({ state: "unavailable", reason: "no-session" });
        } else {
          setFileSource({
            state: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
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
        const [providerRes, settings, healthProfiles] = await Promise.all([
          api.providers.getActive(),
          api.settings.get(),
          api.providers.health().catch(() => [] as ProviderProfile[]),
        ]);
        if (cancelled) {
          return;
        }
        let provider = providerRes;
        if (provider && healthProfiles.length > 0) {
          const activeId = provider.id;
          const hp = healthProfiles.find((p) => p.id === activeId);
          if (hp) {
            provider = { ...provider, healthStatus: hp.healthStatus, healthCheckedAt: hp.healthCheckedAt, modelHealth: hp.modelHealth };
          }
        }
        setActiveProvider(provider);
        setProvidersLoaded(true);
        setSelectedModel((current) => {
          if (current && provider?.models.includes(current)) {
            return current;
          }
          if (settings.model && provider?.models.includes(settings.model)) {
            return settings.model;
          }
          return provider?.models[0] ?? "";
        });
      } catch {
        if (!cancelled) {
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
  }, []);

  useEffect(() => {
    const refreshProvider = async () => {
      try {
        const [providerRes, healthProfiles] = await Promise.all([
          api.providers.getActive(),
          api.providers.health().catch(() => [] as ProviderProfile[]),
        ]);
        let provider = providerRes;
        if (provider && healthProfiles.length > 0) {
          const providerId = provider.id;
          const hp = healthProfiles.find((p) => p.id === providerId);
          if (hp) {
            provider = { ...provider, healthStatus: hp.healthStatus, healthCheckedAt: hp.healthCheckedAt, modelHealth: hp.modelHealth };
          }
        }
        setActiveProvider(provider);
        setSelectedModel((current) => {
          if (current && provider?.models.includes(current)) {
            return current;
          }
          return provider?.models[0] ?? "";
        });
      } catch {
        // ignore silent refresh errors
      }
    };
    const id = window.setInterval(() => void refreshProvider(), 30000);
    return () => window.clearInterval(id);
  }, []);

  const queuedPrompts = sessionId ? (queuedPromptsBySession[sessionId] ?? []) : [];

  // A queued prompt moves into the transcript only when Runtime emits its
  // stable user-message id after Pi actually consumes the follow-up.
  useEffect(() => {
    if (!sessionId) return;
    const visibleIds = new Set(messages.filter((message) => message.role === "user").map((message) => message.id));
    setQueuedPromptsBySession((current) => {
      const existing = current[sessionId] ?? [];
      const next = existing.filter((prompt) => !visibleIds.has(prompt.id));
      if (next.length === existing.length) return current;
      return { ...current, [sessionId]: next };
    });
  }, [messages, sessionId, queuedPrompts.length]);

  // Pi consumes every accepted follow-up before the foreground run ends. If a
  // run terminates with a queued chip still visible, it was cancelled/rejected.
  useEffect(() => {
    if (!sessionId || runActive) return;
    setQueuedPromptsBySession((current) => {
      if ((current[sessionId] ?? []).length === 0) return current;
      return { ...current, [sessionId]: [] };
    });
  }, [runActive, sessionId, queuedPrompts.length]);

  // #99: whole-turn timer — spans user input → every agent finished (runState
  // settles false), debounced against hook/system re-wakes.
  const turnTiming = useTurnTimer({ runActive, resetKey: currentSession?.id ?? null });

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!sessionId) return;
    const content = draftStore.get(sessionId).trim();
    if (!content || !canSend) {
      return;
    }
    draftStore.set(sessionId, "");
    // #47: if files were uploaded this turn, prepend a notice so the agent knows
    // they exist in its workspace and can `read` them. Cleared after send.
    const notice =
      attachments.length > 0 ? `${t("chat.upload.notice", { names: attachments.join(", ") })}\n\n` : "";
    const sentAttachments = attachments;
    if (attachments.length > 0) {
      attachmentStore.clear(sessionId);
    }
    // Carry the chosen provider/model so a freshly-created session records its
    // per-session selection (no-op for an already-running session).
    const result = await sendPrompt(`${notice}${content}`, {
      providerId: activeProvider?.id,
      modelId: selectedModel || undefined,
    });
    if (result.ok && result.queued && result.messageId && sessionId) {
      setQueuedPromptsBySession((current) => ({
        ...current,
        [sessionId]: [...(current[sessionId] ?? []), { id: result.messageId!, content }],
      }));
    }
    // #106: a failed/timed-out send must not silently eat the user's input.
    // Restore the draft (and attachment chips) so they can retry without
    // retyping. Only restore if they haven't already started typing again.
    if (!result.ok) {
      if (draftStore.get(sessionId).trim().length === 0) {
        draftStore.set(sessionId, content);
      }
      if (sentAttachments.length > 0) {
        attachmentStore.restoreIfEmpty(sessionId, sentAttachments);
      }
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
  // #305: sequential multi-file with progress + cancel (one AbortController for
  // the whole batch). Abort is not treated as a failure toast; successful chips
  // already added are kept.
  const handleFilesChosen = async (files: FileList | null) => {
    if (!files || files.length === 0 || !sessionId) return;
    const uploadSessionId = sessionId;
    const uploadId = currentSession?.id ?? currentSandbox?.id;
    if (!uploadId) return;
    const list = Array.from(files);
    const controller = new AbortController();
    uploadAbortBySessionRef.current.set(uploadSessionId, controller);
    setComposerErrorBySession((current) => ({ ...current, [uploadSessionId]: null }));
    try {
      for (let i = 0; i < list.length; i++) {
        if (controller.signal.aborted) break;
        const file = list[i]!;
        setUploadStateBySession((current) => ({
          ...current,
          [uploadSessionId]: {
            filename: file.name,
            fileIndex: i + 1,
            fileCount: list.length,
            fileSize: file.size,
            percent: null,
            phase: "uploading",
          },
        }));
        await api.sandbox.uploadFile(uploadId, `/attachments/${file.name}`, file, {
          signal: controller.signal,
          onProgress: (p) => {
            setUploadStateBySession((current) => {
              const previous = current[uploadSessionId];
              return previous && previous.filename === file.name
                ? { ...current, [uploadSessionId]: { ...previous, percent: p.percent, phase: p.phase } }
                : current;
            });
          },
        });
        attachmentStore.add(uploadSessionId, file.name);
      }
    } catch (e) {
      if (!isUploadAbortError(e)) {
        const msg = e instanceof Error ? e.message : String(e);
        setComposerErrorBySession((current) => ({
          ...current,
          [uploadSessionId]: t("chat.upload.failed", { msg }),
        }));
      }
    } finally {
      if (uploadAbortBySessionRef.current.get(uploadSessionId) === controller) {
        uploadAbortBySessionRef.current.delete(uploadSessionId);
        setUploadStateBySession((current) => ({ ...current, [uploadSessionId]: null }));
      }
      if (fileInputRef.current) fileInputRef.current.value = ""; // allow re-selecting the same file
    }
  };

  const cancelUpload = () => {
    if (sessionId) uploadAbortBySessionRef.current.get(sessionId)?.abort();
  };

  // Writes to the draft store from non-text controls (slash command picks,
  // suggestion cards). PromptComposer never reads the draft, so these don't
  // pull it onto the keystroke render path.
  const setDraftFor = (value: string) => {
    if (sessionId) draftStore.set(sessionId, value);
  };

  return (
    <section className={`prompt-home ${hasMessages ? "prompt-home--active" : ""}`} aria-labelledby="prompt-heading">
      <div className="prompt-home__inner">
        {showNoProviderBanner ? (
          <div className="composer-notice" role="alert" data-testid="no-provider-banner">
            <span className="composer-notice__text">{t("chat.noProvider.banner")}</span>
            <button
              type="button"
              className="composer-notice__cta"
              onClick={() => onOpenProviderSettings?.()}
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
          />

          {attachments.length > 0 || uploadState ? (
            <div className="composer__attachments" aria-label={t("chat.aria.attachFile")}>
              <span className="composer__attachments-label">
                <Paperclip size={11} />
                {t("chat.attachments.label")}
              </span>
              {attachments.map((name) => (
                <span className="composer__chip composer__chip--attachment" key={name}>
                  <Paperclip size={12} />
                  <span className="composer__chip-name">{name}</span>
                  <button
                    type="button"
                    className="composer__chip-remove"
                    aria-label={t("chat.aria.removeAttachment")}
                    onClick={() => {
                      if (!sessionId) return;
                      attachmentStore.remove(sessionId, name);
                    }}
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
                disabled={uploading || !currentSandbox}
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
              modelSelect={
                <CustomSelect
                  ariaLabel={t("chat.modelPlaceholder")}
                  className="model-select"
                  disabled={!currentSandbox || !activeProvider || activeProvider.models.length === 0}
                  onChange={async (model) => {
                    setSelectedModel(model);
                    setCurrentComposerError(null);
                    try {
                      await api.settings.update({ model });
                    } catch (e) {
                      const msg = e instanceof Error ? e.message : String(e);
                      console.error("Failed to save model selection", e);
                      setCurrentComposerError(t("chat.error.saveModel", { msg }));
                      return;
                    }
                    try {
                      await reloadConfig();
                    } catch (e) {
                      const msg = e instanceof Error ? e.message : String(e);
                      console.error("Failed to reload config after model change", e);
                      setCurrentComposerError(t("chat.error.reloadConfig", { msg }));
                    }
                  }}
                  options={activeProvider?.models.map((model) => {
                    const mh = activeProvider.modelHealth?.find((m) => m.model === model);
                    const status = mh?.status ?? "unknown";
                    return {
                      value: model,
                      label: model,
                      indicator: (
                        <span
                          className={`model-status-dot model-status-dot--${status}`}
                          title={mh?.error ?? status}
                        />
                      ),
                    };
                  }) ?? []}
                  placeholder={t("chat.modelPlaceholder")}
                  title={activeProvider ? t("chat.providerTitle", { name: activeProvider.name }) : t("chat.noActiveProvider")}
                  value={selectedModel}
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
        {composerError ? <p className="composer-status composer-status--error">{composerError}</p> : null}
        {!canSend ? (
          <p className="composer-status">
            {sandboxStatus !== "running"
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
