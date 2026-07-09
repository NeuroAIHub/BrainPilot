import { Check, ChevronDown, Copy, Users } from "lucide-react";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage } from "../../contracts/backend";
import { buildRenderItems } from "../../contexts/messageGroups";
import { useT } from "../../i18n/useT";
import { MarkdownMessage } from "./MarkdownMessage";
import { SystemMessageBubble } from "./SystemMessageBubble";
import { AskUserCard } from "./AskUserCard";
import { AutoRetryIndicator } from "./AutoRetryIndicator";
import { formatToolName, formatPayload } from "../../utils/toolDisplay";
import { formatElapsed } from "../../utils/format";
import { getChatScroll, setChatScroll, resolveScrollTop } from "./chatScrollMemory";

interface MessageStreamProps {
  /** Already filtered / time-sliced by the host. */
  messages: ChatMessage[];
  /** Pin to bottom as new messages arrive (live chat). Default false. */
  autoScroll?: boolean;
  /**
   * #89 — session id used to remember scroll position/pinned intent across
   * tab switches (Chat is unmounted when Agents/Trace is active). When set, the
   * stream restores its prior position on mount instead of replaying a visible
   * top-to-bottom scroll. Omit in read-only contexts (demo replay).
   */
  scrollKey?: string;
  /** Show the "N messages" toolbar row. Default true. */
  showToolbarCount?: boolean;
  /** Show per-agent elapsed timers + total conversation time. Live chat only. */
  showTiming?: boolean;
  /**
   * #99: whole-turn timing (user input → all agents finished). When provided,
   * the footer shows this authoritative turn duration instead of a per-message
   * span estimate. `running` drives a live ticking display.
   */
  turnTiming?: { running: boolean; elapsedMs: number | null; lastDurationMs: number | null };
  className?: string;
  ariaLabel?: string;
  /** 修正6 — cancel a pending auto-retry. Omitted in read-only contexts. */
  onRetryCancel?: () => void;
  /**
   * Names of agents whose run is currently active (RUN_STARTED..RUN_FINISHED).
   * Keeps a folded activity block "in progress" across ReAct rounds even when
   * no single step is momentarily streaming. Omitted in read-only contexts
   * (demo replay), where messages are already terminal.
   */
  runningAgents?: ReadonlySet<string>;
  /**
   * #219 — fold non-PI (specialist) agent activity into collapsible per-run
   * groups so the Principal narrative reads cleanly by default. Off by default
   * so demo replay keeps its flat, curated presentation.
   */
  groupExpertActivity?: boolean;
}

// Whether this message participates in same-agent avatar merging. User
// prompts, errors, hooks and status notes always stand on their own; only
// assistant/system text rows fold under a shared avatar.
function isMergeable(message: ChatMessage): boolean {
  if (message.role === "user") return false;
  if (message.kind === "error" || message.kind === "hook" || message.kind === "status") return false;
  return true;
}

function mergeName(message: ChatMessage): string {
  return message.agent || (message.role === "system" ? "system" : "principal");
}


/**
 * Presentational chat message stack — message bubbles, agent rows, hook notes,
 * and folded reasoning/tool "activity" blocks. Extracted from PromptComposer so
 * the live chat and the demo replay render identically. Owns its own copy state
 * so callers don't have to thread clipboard logic.
 */
function MessageStreamImpl({
  messages,
  autoScroll = false,
  scrollKey,
  showToolbarCount = true,
  showTiming = false,
  turnTiming,
  className,
  ariaLabel,
  onRetryCancel,
  runningAgents,
  groupExpertActivity = false,
}: MessageStreamProps) {
  const t = useT();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // #219 — audit mode: force every specialist group open (reasoning/tool folds
  // inside stay independent, per issue).
  const [expandAll, setExpandAll] = useState(false);
  const stackRef = useRef<HTMLDivElement | null>(null);
  const isPinnedRef = useRef(true);

  const renderItems = useMemo(
    () => buildRenderItems(messages, runningAgents, groupExpertActivity),
    [messages, runningAgents, groupExpertActivity],
  );

  const hasExpertGroup = useMemo(
    () => renderItems.some((item) => item.type === "expertGroup"),
    [renderItems],
  );

  // Avatar merging: a mergeable assistant/system row whose immediately
  // preceding render item is a mergeable single from the same agent hides its
  // repeated avatar + name. Activity blocks, user prompts, errors and hooks
  // all break the run.
  const continuationIds = useMemo(() => {
    const set = new Set<string>();
    let prevName: string | null = null;
    const walk = (items: typeof renderItems) => {
      for (const item of items) {
        if (item.type === "single" && isMergeable(item.message)) {
          const name = mergeName(item.message);
          if (prevName === name) {
            set.add(item.message.id);
          }
          prevName = name;
        } else if (item.type === "expertGroup") {
          // A group is its own merge scope: the first row inside always shows
          // its avatar, and the group boundary breaks the outer run.
          prevName = null;
          walk(item.items);
          prevName = null;
        } else {
          prevName = null;
        }
      }
    };
    walk(renderItems);
    return set;
  }, [renderItems]);

  // Last assistant/system message that is still streaming — gets the live
  // left-to-right highlight sweep.
  const liveStreamingId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.streaming && m.role !== "user") return m.id;
    }
    return null;
  }, [messages]);

  // #99: per-message timer is shown ONLY on the live streaming message — it is a
  // live "this run has been going for Ns" indicator, never attached to a
  // completed message or a user bubble (which previously drifted with wall-clock
  // age). The authoritative whole-turn duration lives in the footer (turnTiming).
  const anyStreaming = liveStreamingId !== null;
  const [, setNow] = useState(0);
  useEffect(() => {
    if (!showTiming || !anyStreaming) return;
    const id = window.setInterval(() => setNow((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [showTiming, anyStreaming]);

  const elapsedLabel = (message: ChatMessage): string | null => {
    if (!showTiming) return null;
    // Only the currently-streaming message carries a live timer.
    if (message.id !== liveStreamingId) return null;
    const startMs = message.createdAt ? Date.parse(message.createdAt) : NaN;
    if (Number.isNaN(startMs)) return null;
    return formatElapsed(Date.now() - startMs);
  };

  // #89 — restore scroll position on (re)mount BEFORE the browser paints, so
  // returning to Chat from another tab lands at the right place with no visible
  // top-to-bottom replay. Reads the per-session memory: pinned/fresh → bottom,
  // otherwise the saved history position. A double rAF re-applies after async
  // layout (Markdown, images) settles, in case scrollHeight grew post-mount.
  useLayoutEffect(() => {
    const node = stackRef.current;
    if (!node) return;
    const mem = getChatScroll(scrollKey);
    isPinnedRef.current = mem ? mem.pinned : true;
    const apply = () => {
      const n = stackRef.current;
      if (!n) return;
      // #133 — force an instant jump for the restore. The container CSS no
      // longer sets `scroll-behavior: smooth`, but pin it locally too so a
      // future global rule (or an inherited one) can never turn this restore
      // into a visible top-to-bottom replay through the history.
      n.style.scrollBehavior = "auto";
      n.scrollTop = resolveScrollTop(mem, n.scrollHeight);
    };
    apply();
    let raf2 = 0;
    const raf1 = window.requestAnimationFrame(() => {
      apply();
      raf2 = window.requestAnimationFrame(apply);
    });
    return () => {
      window.cancelAnimationFrame(raf1);
      if (raf2) window.cancelAnimationFrame(raf2);
    };
    // Mount-only restore; live append is handled by the autoScroll effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollKey]);

  useEffect(() => {
    if (!autoScroll) {
      return;
    }
    const node = stackRef.current;
    if (!node || !isPinnedRef.current) {
      return;
    }
    // #133 — pinned-bottom live append also jumps instantly (no smooth replay).
    node.style.scrollBehavior = "auto";
    node.scrollTop = node.scrollHeight;
  }, [messages, autoScroll]);

  const handleScroll = () => {
    const node = stackRef.current;
    if (!node) {
      return;
    }
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    isPinnedRef.current = distanceFromBottom < 24;
    // #89 — persist intent so a tab switch (which unmounts Chat) can restore it.
    setChatScroll(scrollKey, { scrollTop: node.scrollTop, pinned: isPinnedRef.current });
  };

  const handleCopy = async (id: string, text: string) => {
    const markCopied = () => {
      setCopiedId(id);
      setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 2000);
    };

    // Modern Clipboard API only works in secure contexts (https / localhost).
    // When the app is served over plain http (e.g. deployed on an IP/domain),
    // navigator.clipboard is undefined, so we fall back to execCommand('copy').
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        markCopied();
        return;
      }
    } catch {
      // fall through to legacy fallback below
    }

    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.top = "0";
      textarea.style.left = "0";
      textarea.style.width = "1px";
      textarea.style.height = "1px";
      textarea.style.padding = "0";
      textarea.style.border = "none";
      textarea.style.outline = "none";
      textarea.style.boxShadow = "none";
      textarea.style.background = "transparent";
      textarea.setAttribute("readonly", "");
      document.body.appendChild(textarea);
      textarea.select();
      textarea.setSelectionRange(0, text.length);
      const succeeded = document.execCommand("copy");
      document.body.removeChild(textarea);
      if (succeeded) {
        markCopied();
      }
    } catch {
      // ignore — copy is best-effort
    }
  };

  const copyButtonFor = (message: ChatMessage) => {
    const isCopied = copiedId === message.id;
    return (
      <button
        className={`message-card__copy ${isCopied ? "is-copied" : ""}`}
        onClick={(event) => {
          event.stopPropagation();
          void handleCopy(message.id, message.content || "");
        }}
        title={isCopied ? t("chat.copied") : t("chat.copy")}
        aria-label={isCopied ? t("chat.copied") : t("chat.aria.copyMessage")}
        type="button"
      >
        {isCopied ? <Check size={12} /> : <Copy size={12} />}
      </button>
    );
  };

  // Circular monogram avatar for an agent. Scales to any agent name; principal
  // uses the info accent, expert agents the success/green accent. When
  // `ghost` is set (a continuation row) the avatar is rendered as an invisible
  // placeholder so the body stays aligned but the monogram isn't repeated.
  const renderAvatar = (agent: string | undefined, isExpert: boolean, ghost = false) => {
    const name = agent || "principal";
    const initial = name.charAt(0).toUpperCase() || "·";
    if (ghost) {
      return <div className="message-avatar message-avatar--ghost" aria-hidden="true" />;
    }
    return (
      <div
        className={`message-avatar ${isExpert ? "message-avatar--expert" : ""}`}
        aria-hidden="true"
        title={name}
      >
        {initial}
      </div>
    );
  };

  // A standalone message: user prompts (right-aligned bubble), every assistant
  // text reply from Principal or Expert agents (borderless row with avatar +
  // name), errors, and hook diagnostics. Only reasoning and tool calls/results
  // fold into activity blocks via buildRenderItems().
  const renderSingle = (message: ChatMessage, isContinuation = false) => {
    // 修正6 — new-UI kinds render via their dedicated components.
    if (message.kind === "system_message" && message.systemMessage) {
      return <SystemMessageBubble key={message.id} view={message.systemMessage} />;
    }
    if (message.kind === "ask_user" && message.askUser) {
      // #272: the stream card is a record only; answering happens in the
      // composer takeover (AskUserComposer). See AskUserCard.
      return <AskUserCard key={message.id} view={message.askUser} />;
    }
    if (message.kind === "auto_retry" && message.autoRetry) {
      return (
        <AutoRetryIndicator
          key={message.id}
          view={message.autoRetry}
          onCancel={() => onRetryCancel?.()}
        />
      );
    }

    if (message.kind === "hook") {
      const levelIcon =
        message.hookLevel === "error" ? "❌" :
        message.hookLevel === "warning" ? "⚠️" :
        message.hookLevel === "debug" ? "·" :
        "🪝";
      return (
        <div
          className={`message-hook message-hook--${message.hookLevel ?? "info"}`}
          key={message.id}
        >
          <details>
            <summary>
              <span className="message-hook__label">
                {levelIcon} hook · {message.hookFamily ?? "?"} · {message.hookPhase ?? "?"}
                {message.agent ? ` · ${message.agent}` : ""}
              </span>
              <span className="message-hook__text">{message.content}</span>
            </summary>
            {message.hookData && Object.keys(message.hookData).length > 0 ? (
              <pre>{JSON.stringify(message.hookData, null, 2)}</pre>
            ) : null}
          </details>
        </div>
      );
    }

    if (message.role === "user") {
      return (
        <div className="message-row message-row--user" key={message.id}>
          <div className="message-bubble">
            {message.content || (message.streaming ? t("chat.generating") : "")}
          </div>
          <div className="message-row__user-actions">{copyButtonFor(message)}</div>
        </div>
      );
    }

    const isExpert = message.role === "assistant" && !!message.agent && message.agent !== "principal";
    const displayName = message.agent || (message.role === "system" ? "system" : "principal");
    const isLive = message.id === liveStreamingId;
    const timing = elapsedLabel(message);
    const hasContent = !!message.content.trim();
    const displayContent = hasContent ? message.content : (message.streaming ? t("chat.streamingPending") : "");
    const content = (
      <div className={`message-row__content ${message.streaming && !hasContent ? "message-row__content--pending" : ""}`}>
        {message.kind === "error" ? (
          <p className="message-card__content--plain message-row__error">{displayContent}</p>
        ) : (
          <MarkdownMessage content={displayContent} />
        )}
        {message.streaming && message.kind !== "error" ? (
          <span className="message-row__streaming-cursor" aria-hidden="true" />
        ) : null}
      </div>
    );
    return (
      <div
        className={`message-row message-row--${message.role} ${isExpert ? "message-row--expert" : ""} ${isContinuation ? "message-row--continuation" : ""} ${isLive ? "message-row--live" : ""}`}
        key={message.id}
      >
        {renderAvatar(displayName, isExpert, isContinuation)}
        <div className="message-row__body">
          {isContinuation ? null : (
            <div className="message-row__head">
              <span className={`message-row__name ${isExpert ? "message-row__name--expert" : ""}`}>
                {displayName}
              </span>
              {timing ? <span className="message-row__timer">· {timing}</span> : null}
              {message.streaming ? <span className="message-row__streaming">{t("chat.streaming")}</span> : null}
              {copyButtonFor(message)}
            </div>
          )}
          {content}
        </div>
      </div>
    );
  };

  // One folded step inside an activity block (reasoning, tool call/result, or
  // intermediate assistant text).
  const renderActivityStep = (step: ChatMessage) => {
    const isExpert = !!step.agent && step.agent !== "principal";
    if (step.kind === "tool") {
      // #84: render a friendly tool name (mcp__server__tool → server · tool) and
      // un-escaped payloads. The raw name stays in `title` for debugging/copy.
      const friendly = t("chat.toolPrefix", { name: formatToolName(step.toolName) });
      const input = formatPayload(step.toolInput);
      const result = formatPayload(step.toolResult);
      return (
        <div className="activity-step" key={step.id}>
          <details>
            <summary title={step.toolName || undefined}>
              {isExpert ? <span className="message-card__agent-badge">{step.agent}</span> : null}
              {friendly}
            </summary>
            {input ? (
              <div className="activity-step__io">
                <span className="activity-step__io-label">{t("chat.toolArgs")}</span>
                <pre>{input}</pre>
              </div>
            ) : null}
            {result ? (
              <div className="activity-step__io">
                <span className="activity-step__io-label">{t("chat.toolResult")}</span>
                <pre>{result}</pre>
              </div>
            ) : null}
          </details>
        </div>
      );
    }
    if (step.kind === "thinking") {
      return (
        <div className="activity-step" key={step.id}>
          <p className="message-card__content--plain">{step.reasoning || step.content}</p>
        </div>
      );
    }
    return (
      <div className="activity-step" key={step.id}>
        {isExpert ? <span className="message-card__agent-badge">{step.agent}</span> : null}
        <MarkdownMessage content={step.content || (step.streaming ? t("chat.streamingPending") : "")} />
      </div>
    );
  };

  // Collapsed by default; while streaming the summary shows a live one-line
  // preview of the latest step instead of a step count.
  const activitySubtitle = (steps: ChatMessage[], streaming: boolean) => {
    if (!streaming) return t("chat.thinkingSteps", { count: steps.length });
    const last = steps[steps.length - 1];
    if (last?.kind === "tool") return t("chat.toolCall", { name: formatToolName(last.toolName) });
    const text = (last?.reasoning || last?.content || "").trim();
    if (text) return text.length > 80 ? `${text.slice(0, 80)}…` : text;
    return t("chat.thinking");
  };

  // A folded reasoning/tool activity block. Extracted so it renders identically
  // at the top level and nested inside an expert group (#219).
  const renderActivityBlock = (id: string, steps: ChatMessage[], streaming: boolean) => (
    <div className="activity-block" key={id}>
      <details>
        <summary className="activity-summary" aria-label={t("chat.aria.expandThinking")}>
          {streaming ? <span className="activity-summary__dot" /> : null}
          <ChevronDown size={14} className="activity-summary__chevron" aria-hidden="true" />
          <span className="activity-summary__subtitle">{activitySubtitle(steps, streaming)}</span>
        </summary>
        <div className="activity-steps">{steps.map(renderActivityStep)}</div>
      </details>
    </div>
  );

  // Render one top-level or nested render item (single row or activity block).
  // expertGroup is handled by renderExpertGroup, not here.
  const renderItem = (item: (typeof renderItems)[number]) => {
    if (item.type === "single") {
      return renderSingle(item.message, continuationIds.has(item.message.id));
    }
    if (item.type === "activity") {
      return renderActivityBlock(item.id, item.steps, item.streaming);
    }
    return null;
  };

  // #219 — a collapsed run of specialist-agent activity. Summary names the
  // agent(s) and item count; the body reuses the normal single/activity
  // renderers so reasoning/tool folds inside are preserved. `expandAll` (audit
  // mode) forces every group open.
  const renderExpertGroup = (item: Extract<(typeof renderItems)[number], { type: "expertGroup" }>) => {
    const count = item.items.length;
    const summary =
      item.agents.length === 1
        ? t("chat.expertGroup.summary", { agent: item.agents[0], count })
        : t("chat.expertGroup.summaryMulti", { n: item.agents.length, count });
    return (
      <div className="expert-group" key={item.id}>
        <details open={expandAll || undefined}>
          <summary className="expert-group__summary" aria-label={t("chat.aria.expandExpert")}>
            {item.streaming ? <span className="activity-summary__dot" /> : null}
            <ChevronDown size={14} className="activity-summary__chevron" aria-hidden="true" />
            <Users size={13} className="expert-group__icon" aria-hidden="true" />
            <span className="activity-summary__subtitle">{summary}</span>
          </summary>
          <div className="expert-group__body">{item.items.map(renderItem)}</div>
        </details>
      </div>
    );
  };

  return (
    <div
      className={`message-stack ${className ?? ""}`}
      aria-label={ariaLabel ?? t("chat.aria.messages")}
      onScroll={handleScroll}
      ref={stackRef}
    >
      {showToolbarCount || hasExpertGroup ? (
        <div className="message-stack__toolbar">
          {showToolbarCount ? <span>{t("chat.messageCount", { count: messages.length })}</span> : <span />}
          {hasExpertGroup ? (
            <button
              className={`message-stack__audit-toggle ${expandAll ? "is-active" : ""}`}
              onClick={() => setExpandAll((v) => !v)}
              type="button"
              aria-pressed={expandAll}
            >
              <Users size={12} aria-hidden="true" />
              {expandAll ? t("chat.expertGroup.collapseAll") : t("chat.expertGroup.expandAll")}
            </button>
          ) : null}
        </div>
      ) : null}
      {renderItems.map((item) =>
        item.type === "expertGroup" ? renderExpertGroup(item) : renderItem(item),
      )}
      {showTiming && turnTiming && turnTiming.elapsedMs !== null ? (
        <div className="message-stack__total" role="status">
          {t(turnTiming.running ? "chat.turnTimeRunning" : "chat.totalTime", {
            time: formatElapsed(turnTiming.elapsedMs),
          })}
        </div>
      ) : null}
    </div>
  );
}

// Memoized so unrelated parent re-renders (slash menu toggling, model select
// updates, agent-running toast state) don't traverse the whole message list.
// Callers pass a `messages` array that's stable across re-renders thanks to
// useMemo upstream, so default shallow compare is correct.
export const MessageStream = memo(MessageStreamImpl);
