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
import { api } from "../../utils/api";
import { CustomSelect } from "../primitives/CustomSelect";
import { IconButton } from "../primitives/IconButton";
import { ComposerInput } from "./ComposerInput";
import { ComposerSendButton } from "./ComposerSendButton";
import { ComposerSendTools } from "./ComposerSendTools";
import { MessageStream } from "./MessageStream";
import { RunningScriptsPanel } from "./RunningScriptsPanel";
import { selectActiveScripts } from "./runningScripts";

export function PromptComposer() {
  const t = useT();
  const [suggestedTasks, setSuggestedTasks] = useState<string[]>([]);
  const [activeProvider, setActiveProvider] = useState<ProviderProfile | null>(null);
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
  const [attachments, setAttachments] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const { status: sandboxStatus, currentSandbox, reloadConfig } = useSandbox();
  const [composerError, setComposerError] = useState<string | null>(null);
  const { currentSession, messages, isSending, error, sendPrompt, isConnected, isDraft, agents, runActive, agentFilters, interruptCurrent, respondToInput, messageFilters } = useSessions();
  // In draft mode there's no session/connection yet — allow composing so the
  // first send can create + connect the session.
  const canSend = sandboxStatus === "running" && !isSending && (isConnected || isDraft);

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
  const isAgentRunning = agents.some((a) => a.status === "running");
  const lastAssistantStreaming = visibleMessages[visibleMessages.length - 1]?.role === "assistant" && visibleMessages[visibleMessages.length - 1]?.streaming;
  // A bash tool is in flight iff selectActiveScripts finds anything; when it
  // does, the RunningScriptsPanel below the toast owns the Stop button so
  // we don't render a duplicate. When no scripts are running (e.g. the agent
  // is thinking or streaming text), the toast keeps its own Stop.
  const hasActiveScripts = useMemo(
    () => selectActiveScripts(visibleMessages).length > 0,
    [visibleMessages],
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

  const sessionId = currentSession?.id ?? (isDraft ? DRAFT_SESSION_ID : null);

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
    if (attachments.length > 0) setAttachments([]);
    // Carry the chosen provider/model so a freshly-created session records its
    // per-session selection (no-op for an already-running session).
    const ok = await sendPrompt(`${notice}${content}`, {
      providerId: activeProvider?.id,
      modelId: selectedModel || undefined,
    });
    // #106: a failed/timed-out send must not silently eat the user's input.
    // Restore the draft (and attachment chips) so they can retry without
    // retyping. Only restore if they haven't already started typing again.
    if (!ok) {
      if (draftStore.get(sessionId).trim().length === 0) {
        draftStore.set(sessionId, content);
      }
      if (sentAttachments.length > 0) {
        setAttachments((prev) => (prev.length === 0 ? sentAttachments : prev));
      }
    }
  };

  // #47: upload the chosen files into the session workspace, then track their
  // names as chips. In single-user mode the sandbox id and session id are the
  // same; a draft has no real session yet, so uploads land in the `"local"`
  // staging area and the runtime drains them into the real workspace on send
  // (#60 drainLocalUploads). Files are uploaded to the workspace root by name.
  const handleFilesChosen = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const uploadId = currentSession?.id ?? currentSandbox?.id;
    if (!uploadId) return;
    setUploading(true);
    setComposerError(null);
    try {
      for (const file of Array.from(files)) {
        await api.sandbox.uploadFile(uploadId, file.name, file);
        setAttachments((prev) => (prev.includes(file.name) ? prev : [...prev, file.name]));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setComposerError(t("chat.upload.failed", { msg }));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = ""; // allow re-selecting the same file
    }
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
            onAskUserSubmit={(requestId, answer) => void respondToInput(requestId, answer)}
            onRetryCancel={() => void interruptCurrent()}
          />
        ) : null}

        {isAgentRunning || lastAssistantStreaming ? (
          <div className="agent-running-toast" role="status" aria-live="polite">
            <span className="agent-running-toast__dot" />
            <span className="agent-running-toast__label">
              {(() => {
                const label = runningToastLabel(workingAgentNames);
                return t(label.key, label.vars);
              })()}
            </span>
            {hasActiveScripts ? null : (
              <button
                className="agent-running-toast__stop"
                type="button"
                onClick={() => void interruptCurrent()}
                aria-label={t("chat.aria.stop")}
                title={t("chat.aria.stop")}
              >
                <Square size={10} fill="currentColor" />
                <span>{t("chat.stop")}</span>
              </button>
            )}
          </div>
        ) : null}

        <RunningScriptsPanel
          messages={visibleMessages}
          onStop={() => void interruptCurrent()}
        />

        <form className="composer" aria-label={t("chat.aria.newPrompt")} onSubmit={handleSubmit}>
          <ComposerInput
            sessionId={sessionId}
            placeholder={t("chat.placeholder")}
            ariaLabel={t("chat.srAsk")}
          />

          {attachments.length > 0 || uploading ? (
            <div className="composer__attachments" aria-label={t("chat.aria.attachFile")}>
              {attachments.map((name) => (
                <span className="composer__chip" key={name}>
                  <Paperclip size={12} />
                  <span className="composer__chip-name">{name}</span>
                  <button
                    type="button"
                    className="composer__chip-remove"
                    aria-label={t("chat.aria.removeAttachment")}
                    onClick={() => setAttachments((prev) => prev.filter((n) => n !== name))}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
              {uploading ? <span className="composer__chip composer__chip--pending">{t("chat.upload.uploading")}</span> : null}
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
                    setComposerError(null);
                    try {
                      await api.settings.update({ model });
                    } catch (e) {
                      const msg = e instanceof Error ? e.message : String(e);
                      console.error("Failed to save model selection", e);
                      setComposerError(t("chat.error.saveModel", { msg }));
                      return;
                    }
                    try {
                      await reloadConfig();
                    } catch (e) {
                      const msg = e instanceof Error ? e.message : String(e);
                      console.error("Failed to reload config after model change", e);
                      setComposerError(t("chat.error.reloadConfig", { msg }));
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
