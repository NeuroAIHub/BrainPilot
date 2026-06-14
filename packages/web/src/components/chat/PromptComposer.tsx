import { Bot, Mic, Paperclip, Plus, Square } from "lucide-react";
import { FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ProviderProfile } from "../../contracts/backend";
import { useSandbox } from "../../contexts/SandboxContext";
import { DRAFT_SESSION_ID, useSessions } from "../../contexts/SessionContext";
import { draftStore } from "../../contexts/draftStore";
import { applyMessageFilters } from "../../contexts/messageFilters";
import { useT } from "../../i18n/useT";
import { api } from "../../utils/api";
import { CustomSelect } from "../primitives/CustomSelect";
import { IconButton } from "../primitives/IconButton";
import { ComposerInput } from "./ComposerInput";
import { ComposerSendButton } from "./ComposerSendButton";
import { MessageStream } from "./MessageStream";

export function PromptComposer() {
  const t = useT();
  const [suggestedTasks, setSuggestedTasks] = useState<string[]>([]);
  const [activeProvider, setActiveProvider] = useState<ProviderProfile | null>(null);
  const [selectedModel, setSelectedModel] = useState("");
  // 可用命令（已通过真实 API 测试 /context ✅ /cost ✅；/compact 由 SDK 内置 ✅）
  // 不可用命令（已移除）：/usage ❌ /clear ❌ /init ❌
  const DEFAULT_SLASH_COMMANDS = ["/compact", "/context", "/cost"];
  const [slashCommands, setSlashCommands] = useState<string[]>(DEFAULT_SLASH_COMMANDS);

  const [showCommands, setShowCommands] = useState(false);
  const commandsRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const { status: sandboxStatus, currentSandbox, reloadConfig } = useSandbox();
  const [composerError, setComposerError] = useState<string | null>(null);
  const { currentSession, messages, isSending, error, sendPrompt, isConnected, isDraft, agents, agentFilters, interruptCurrent, respondToInput, messageFilters } = useSessions();
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

  useEffect(() => {
    let cancelled = false;
    if (!currentSession) {
      setSlashCommands(DEFAULT_SLASH_COMMANDS);
      return;
    }
    void api.sessions.commands(currentSession.id).then((res) => {
      if (!cancelled) {
        // Only override defaults when the backend actually returned commands
        if (res.commands.length > 0) {
          setSlashCommands(res.commands);
        }
      }
    }).catch(() => {
      if (!cancelled) {
        // Keep defaults on API failure so the button stays visible
        setSlashCommands(DEFAULT_SLASH_COMMANDS);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [currentSession?.id]);

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

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!sessionId) return;
    const content = draftStore.get(sessionId).trim();
    if (!content || !canSend) {
      return;
    }
    draftStore.set(sessionId, "");
    await sendPrompt(content);
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
            showTiming
            onAskUserSubmit={(requestId, answer) => void respondToInput(requestId, answer)}
            onRetryCancel={() => void interruptCurrent()}
          />
        ) : null}

        {isAgentRunning || lastAssistantStreaming ? (
          <div className="agent-running-toast" role="status" aria-live="polite">
            <span className="agent-running-toast__dot" />
            <span className="agent-running-toast__label">{t("chat.agentThinking")}</span>
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
          </div>
        ) : null}

        <form className="composer" aria-label={t("chat.aria.newPrompt")} onSubmit={handleSubmit}>
          <ComposerInput
            sessionId={sessionId}
            placeholder={t("chat.placeholder")}
            ariaLabel={t("chat.srAsk")}
          />

          <div className="composer__toolbar">
            <div className="composer__tools">
              <IconButton label={t("chat.aria.attachContext")}>
                <Plus size={18} />
              </IconButton>
              {slashCommands.length > 0 && (
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

            <div className="composer__send-tools">
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
              <IconButton label={t("chat.aria.voice")}>
                <Mic size={17} />
              </IconButton>
              <IconButton label={t("chat.aria.attachFile")}>
                <Paperclip size={17} />
              </IconButton>
              <ComposerSendButton
                sessionId={sessionId}
                canSend={canSend}
                label={t("chat.aria.send")}
              />
            </div>
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
