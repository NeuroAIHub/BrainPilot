import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
// TODO(dead-code): SessionEventEntry removed with pre-AG-UI polling protocol.
import { AgentStatus, ChatMessage, DomainResources, MessageFilterConfig, MessageFilterRule, Session, SessionTokenUsage, TraceGraph, normalizeWebSocketEvent, /* SessionEventEntry, */ SessionMessageEntry } from "../contracts/backend";
import { api } from "../utils/api";
import { tg } from "../i18n/translate";
import { useAuth } from "./AuthContext";
import { useSandbox } from "./SandboxContext";
import { useSSE } from "./SSEContext";
import { draftStore } from "./draftStore";
import { defaultFilterRules, isNonFatalAgentErrorMessage, HIDE_NON_FATAL_AGENT_ERRORS } from "./messageFilters";
import {
  eventSessionId,
  finalizeAssistant,
  generateUUID,
  reduceMessagesForEvent,
} from "./messageReducer";
import { reduceAgentsForEvent } from "./agentsReducer";
import { reduceTraceForEvent } from "./traceReducer";

export interface AgentMessageFilter {
  hideMessages: boolean;
  hideTools: boolean;
  hideHooks: boolean;
}

interface SessionContextValue {
  sessions: Session[];
  currentSession: Session | null;
  messages: ChatMessage[];
  isLoading: boolean;
  isSending: boolean;
  isRefreshingMessages: boolean;
  isConnected: boolean;
  /**
   * True when the user has opened a new conversation that has not yet been
   * persisted. No session file exists until the first message is sent.
   */
  isDraft: boolean;
  error: string | null;
  currentView: "chat" | "agents" | "trace";
  agents: AgentStatus[];
  /**
   * #99: authoritative whole-turn run-active signal from session_state.runState
   * (trace agent excluded, delivery loops included), with the backend timestamp
   * of the snapshot. null until the first session_state arrives. Drives the
   * whole-turn timer in the Chat footer.
   */
  runActive: { active: boolean; atMs: number } | null;
  /**
   * Cumulative real token usage for the current session (total + per-agent),
   * fed live from `session_state` frames. null until the first frame carrying
   * usage arrives.
   */
  tokenUsage: SessionTokenUsage | null;
  agentFilters: Record<string, AgentMessageFilter>;
  /** Live Graph of Trace for the current session (#79), or null if none/unloaded. */
  currentTrace: TraceGraph | null;
  /**
   * #134 — whether the current session has trace updates the user hasn't seen
   * since last opening the Trace view. Drives a quiet dot on the Trace tab so
   * trace stays a transparency layer instead of noisy chat output. Per-session:
   * switching sessions reflects that session's unread state. False on initial
   * hydration (only live post-open trace_node events set it).
   */
  traceUnread: boolean;
  /** Re-seed the trace graph from the HTTP route (manual refresh). */
  refreshTrace: (sessionId: string) => Promise<void>;
  selectSession: (sessionId: string) => void;
  createSession: (title?: string, opts?: { providerId?: string; modelId?: string; domainResources?: DomainResources }) => Promise<Session | null>;
  /**
   * Open a fresh draft conversation without persisting anything. Idempotent —
   * repeated calls collapse to the single draft state. The real session is
   * created lazily on the first sendPrompt.
   */
  startDraftSession: () => void;
  updateSessionTitle: (sessionId: string, title: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  /** Resolves true when the message was accepted, false on validation/timeout/
   *  error — the composer uses this to restore the draft so input isn't lost. */
  sendPrompt: (content: string, opts?: { providerId?: string; modelId?: string; domainResources?: DomainResources }) => Promise<boolean>;
  interruptCurrent: () => Promise<void>;
  /**
   * 修正6 — answer an ask_user (user_input_request) card. Optimistically
   * resolves the card locally and posts a user_input_response to the runtime.
   */
  respondToInput: (requestId: string, answer: string) => Promise<void>;
  refreshSessions: () => Promise<void>;
  refreshMessages: () => Promise<void>;
  setCurrentView: (view: "chat" | "agents" | "trace") => void;
  setAgentFilter: (agentName: string, hideMessages: boolean, hideTools: boolean, hideHooks?: boolean) => void;
  messageFilters: MessageFilterRule[];
  /**
   * Issue #278 — toggle a message-filter rule by id. Persists the `{id,
   * enabled}` map to localStorage under MESSAGE_FILTERS_STORAGE_KEY so the
   * user's preference survives reloads and new rule additions merge in by id
   * (see loadMessageFilterConfig).
   */
  setMessageFilterEnabled: (ruleId: string, enabled: boolean) => void;
  /**
   * Issue #278 — count of non-fatal agent errors that were hidden from the
   * main chat stream by the `hide-non-fatal-agent-errors` filter for the
   * current session. Drives the "hidden errors" red dot on the Agents tab.
   * Cleared when the user opens the Agents view or disables the rule.
   */
  hiddenErrorsCount: number;
  /** True iff hiddenErrorsCount > 0 AND the user hasn't seen it yet. */
  hiddenErrorsUnread: boolean;
}

// Stable key for the not-yet-persisted draft session. The composer keys its
// draft text by this id while `isDraft` is true; once the real session is
// created on first send, the composer switches to the real session id.
export const DRAFT_SESSION_ID = "__draft__";

/**
 * Issue #278 — localStorage key holding the user's message-filter overrides.
 * Persists a `MessageFilterConfig[]` (id + enabled only — the predicate
 * functions come from code). New rules added to `defaultFilterRules` in a
 * future release inherit their own defaults; only the ids the user has ever
 * touched are pinned by storage. See loadMessageFilterConfig().
 */
export const MESSAGE_FILTERS_STORAGE_KEY = "message-filters";

/**
 * Read the persisted `{id, enabled}` overrides and apply them by id to the
 * in-code defaults. Missing or corrupt storage → return defaults untouched.
 * New rules added in a future release (that were never in storage) keep
 * their default `enabled`, and old rules dropped from code just get ignored.
 */
function loadMessageFilters(): MessageFilterRule[] {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return defaultFilterRules;
  }
  const raw = window.localStorage.getItem(MESSAGE_FILTERS_STORAGE_KEY);
  if (!raw) return defaultFilterRules;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return defaultFilterRules;
    const overrides = new Map<string, boolean>();
    for (const entry of parsed as MessageFilterConfig[]) {
      if (entry && typeof entry.id === "string" && typeof entry.enabled === "boolean") {
        overrides.set(entry.id, entry.enabled);
      }
    }
    return defaultFilterRules.map((rule) =>
      overrides.has(rule.id) ? { ...rule, enabled: overrides.get(rule.id)! } : rule,
    );
  } catch {
    return defaultFilterRules;
  }
}

/** Serialize the enabled bits of every rule so a future load merges by id. */
function persistMessageFilters(rules: MessageFilterRule[]): void {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return;
  const config: MessageFilterConfig[] = rules.map((r) => ({ id: r.id, enabled: r.enabled }));
  try {
    window.localStorage.setItem(MESSAGE_FILTERS_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Quota / access errors are non-fatal — the toggle still works in-memory
    // for this session; we just lose persistence.
  }
}

const SessionContext = createContext<SessionContextValue | null>(null);
// Runtime treats `limit=0` as "return the full persisted event log". Rehydrate
// must not use a fixed tail size because slicing through TEXT_MESSAGE_START /
// CONTENT / END leaves old long sessions looking empty.
const HISTORY_REHYDRATE_LIMIT = 0;

/**
 * #194-B1: merge the full rehydrated history under whatever the live message
 * list already holds. On refresh the SSE ring-buffer tail seeds a few recent
 * messages before history arrives; we must NOT discard the (complete) history
 * just because the list is non-empty. The persisted history is the base; we
 * append only the messages already shown that history doesn't contain (by id) —
 * in-flight optimistic sends, or events newer than the persisted file. Ordering
 * matters: history first (chronological), then the live-only tail.
 */
export function mergeRehydratedMessages(
  existing: ChatMessage[],
  history: ChatMessage[],
): ChatMessage[] {
  if (existing.length === 0) return history;
  const historyIds = new Set(history.map((m) => m.id));
  const extra = existing.filter((m) => !historyIds.has(m.id));
  return [...history, ...extra];
}

function foldSessionHistory(events: unknown[], sessionId: string): {
  messages: ChatMessage[];
  trace: TraceGraph | null;
  agents: AgentStatus[] | null;
  tokenUsage: SessionTokenUsage | null;
} {
  let messages: ChatMessage[] = [];
  let trace: TraceGraph | null = null;
  let lastAgents: AgentStatus[] | null = null;
  let lastUsage: SessionTokenUsage | null = null;

  for (const raw of events) {
    const ev = normalizeWebSocketEvent(raw);
    if (!ev) continue;
    messages = reduceMessagesForEvent(messages, ev);
    trace = reduceTraceForEvent(trace, ev, sessionId);
    if (ev.type === "CUSTOM" && ev.name === "session_state") {
      const v = (ev.value ?? {}) as Record<string, unknown>;
      if (Array.isArray(v.agents)) {
        lastAgents = (v.agents as Array<Record<string, unknown>>).map((agent) => ({
          name: String(agent.name ?? ""),
          status: String(agent.status ?? "idle"),
          task: String(agent.task ?? ""),
          updatedAt:
            typeof agent.updatedAt === "string"
              ? agent.updatedAt
              : new Date().toISOString(),
          alive: typeof agent.alive === "boolean" ? agent.alive : undefined,
        }));
      }
      const usage = parseTokenUsageValue(v.tokenUsage);
      if (usage) lastUsage = usage;
    }
  }

  return { messages, trace, agents: lastAgents, tokenUsage: lastUsage };
}

/**
 * Coerce a wire `session_state.tokenUsage` value into SessionTokenUsage, or
 * null when absent/malformed. Mirrors `normalizeSessionTokenUsage` in the
 * backend contract but works off the already-shaped CUSTOM event value.
 */
function parseTokenUsageValue(rawValue: unknown): SessionTokenUsage | null {
  if (rawValue == null || typeof rawValue !== "object") return null;
  const raw = rawValue as Record<string, unknown>;
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const one = (x: unknown) => {
    const u = (x ?? {}) as Record<string, unknown>;
    return {
      input: num(u.input),
      output: num(u.output),
      cacheRead: num(u.cacheRead),
      cacheWrite: num(u.cacheWrite),
      total: num(u.total),
    };
  };
  const byAgentRaw = (raw.byAgent ?? {}) as Record<string, unknown>;
  const byAgent: SessionTokenUsage["byAgent"] = {};
  for (const [name, value] of Object.entries(byAgentRaw)) byAgent[name] = one(value);
  return { total: one(raw.total), byAgent };
}

function defaultAgentFilter(agentName: string): AgentMessageFilter {
  const isTrace = agentName === "trace";
  return {
    hideMessages: isTrace,
    hideTools: isTrace,
    hideHooks: true,
  };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const { isAuthReady } = useAuth();
  const { currentSandbox } = useSandbox();
  const { connectSession, disconnectSession, queueRef, tick, connections } = useSSE();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [isDraft, setIsDraft] = useState(false);
  // Mirror of isDraft for reading inside callbacks that must not re-create when
  // the draft flag flips (e.g. refreshSessions, keyed only on isAuthReady).
  const isDraftRef = useRef(false);
  useEffect(() => {
    isDraftRef.current = isDraft;
  }, [isDraft]);
  const [messagesBySession, setMessagesBySession] = useState<Record<string, ChatMessage[]>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isRefreshingMessages, setIsRefreshingMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentView, setCurrentView] = useState<"chat" | "agents" | "trace">("chat");
  // #134 — read currentView inside the SSE queue-drain effect (keyed on
  // session/tick, not view) to decide whether an incoming trace update should
  // raise the unread dot. A live trace_node that arrives while the user is
  // already on the Trace view is "seen", so it must not flag unread.
  const currentViewRef = useRef<"chat" | "agents" | "trace">("chat");
  useEffect(() => {
    currentViewRef.current = currentView;
  }, [currentView]);
  // Unsent textarea drafts live in a module-level store (see contexts/draftStore.ts)
  // so keystrokes don't re-render the whole chat subtree. Drafts are keyed by
  // session id and survive PromptComposer unmount (tab switches).
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  // #99: authoritative whole-turn run-active flag from session_state.runState
  // (derived by the runtime: trace agent excluded, delivery loops included),
  // paired with the backend ISO timestamp of the snapshot that carried it. The
  // turn timer keys off transitions of this flag, not the per-agent list.
  const [runActive, setRunActive] = useState<{ active: boolean; atMs: number } | null>(null);
  // Cumulative real token usage for the current session, fed from session_state.
  const [tokenUsage, setTokenUsage] = useState<SessionTokenUsage | null>(null);
  const [agentFilters, setAgentFilters] = useState<Record<string, AgentMessageFilter>>({});
  // Issue #278 — messageFilters seed merges persisted `{id, enabled}` overrides
  // (localStorage) onto the in-code defaults. Persisted through the setter
  // wrapper below so a user's disable of "fold agent errors" survives reloads.
  const [messageFilters, setMessageFilters] = useState<MessageFilterRule[]>(() => loadMessageFilters());
  // Issue #278 — per-session count of non-fatal agent errors that the
  // `hide-non-fatal-agent-errors` rule folded out of the main chat stream,
  // plus whether the user has already looked at the Agents panel since the
  // last one arrived. The pair drives the Agents-tab red dot in DesktopShell.
  const [hiddenErrorsBySession, setHiddenErrorsBySession] = useState<
    Record<string, { count: number; seen: boolean }>
  >({});
  // Ref mirror of messageFilters so the SSE queue drain (keyed on
  // session/tick, not filters) can read the CURRENT rule state without
  // re-subscribing on every toggle.
  const messageFiltersRef = useRef<MessageFilterRule[]>(messageFilters);
  useEffect(() => {
    messageFiltersRef.current = messageFilters;
  }, [messageFilters]);
  // #79: live Graph of Trace per session. Seeded by a fetch on session change,
  // then kept live by CUSTOM:trace_node SSE events (see the queue drain below).
  const [traceBySession, setTraceBySession] = useState<Record<string, TraceGraph>>({});
  // #134 — per-session "trace changed since you last looked" flag. Set only by
  // live CUSTOM:trace_node events while the user is NOT on the Trace view;
  // cleared when they open Trace for that session. Hydration/seed paths never
  // set it, so a freshly-opened session with existing trace shows no false dot.
  const [traceUnreadBySession, setTraceUnreadBySession] = useState<Record<string, boolean>>({});


  const currentSession = useMemo(
    () => sessions.find((session) => session.id === currentSessionId) ?? null,
    [currentSessionId, sessions],
  );
  const messages = currentSessionId ? messagesBySession[currentSessionId] ?? [] : [];

  const isConnected = currentSessionId
    ? connections.get(currentSessionId) === "open"
    : false;

  const refreshSessions = useCallback(async () => {
    if (!isAuthReady) {
      setSessions([]);
      setCurrentSessionId(null);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const nextSessions = await api.sessions.list();
      const sorted = [...nextSessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      setSessions(sorted);
      // Don't auto-select an existing session while the user is composing a
      // draft — that would yank them out of the new conversation.
      setCurrentSessionId((current) => (isDraftRef.current ? current : current ?? sorted[0]?.id ?? null));
    } catch (err) {
      setError(err instanceof Error ? err.message : tg("ctx.session.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [isAuthReady]);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  // Sessions whose persisted history has already been pulled this page-load.
  // Guards against re-hydrating on every tab switch — once SSE is attached we
  // own the up-to-date state and don't want to refetch the .jsonl tail.
  const hydratedSessionsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!currentSessionId) {
      return;
    }
    const sessionId = currentSessionId;
    if (hydratedSessionsRef.current.has(sessionId)) {
      return;
    }
    let cancelled = false;

    async function loadHistory() {
      setIsRefreshingMessages(true);
      try {
        const { events } = await api.sessions.getHistory(sessionId, { limit: HISTORY_REHYDRATE_LIMIT });
        if (cancelled) return;

        // Replay the persisted event stream through the same reducers SSE uses
        // (messageReducer / traceReducer / agents seed via session_state). The
        // SSE ring buffer that arrives next is deduped by messageId/toolCallId
        // inside the reducer, so any overlap is a no-op.
        const { messages: nextMessages, trace: nextTrace, agents: lastAgents, tokenUsage: lastUsage } =
          foldSessionHistory(events, sessionId);

        if (cancelled) return;
        hydratedSessionsRef.current.add(sessionId);
        if (lastUsage) setTokenUsage(lastUsage);

        // Merge the full history under whatever SSE / optimistic messages have
        // already landed — do NOT bail just because the list is non-empty
        // (#194-B1). On refresh the SSE ring-buffer tail arrives first and seeds
        // a few recent messages; the old `length > 0 → skip` guard then dropped
        // the entire rehydrated history, leaving only those few. The persisted
        // history is the complete log, so use it as the base and append only the
        // messages SSE already showed that the history doesn't contain (by id) —
        // in-flight optimistic sends, or events newer than the persisted file.
        setMessagesBySession((current) => ({
          ...current,
          [sessionId]: mergeRehydratedMessages(current[sessionId] ?? [], nextMessages),
        }));
        if (nextTrace) {
          setTraceBySession((current) =>
            current[sessionId] ? current : { ...current, [sessionId]: nextTrace! },
          );
        }
        // Only seed agents when the current panel is empty — live SSE may have
        // already pushed an authoritative session_state since selection.
        if (lastAgents && lastAgents.length > 0) {
          setAgents((current) => (current.length === 0 ? lastAgents! : current));
          setAgentFilters((current) => {
            let changed = false;
            const next = { ...current };
            for (const agent of lastAgents) {
              if (!next[agent.name]) {
                changed = true;
                next[agent.name] = defaultAgentFilter(agent.name);
              }
            }
            return changed ? next : current;
          });
        }
      } catch (err) {
        // Best-effort. SSE will eventually drive the panel; we shouldn't surface
        // a banner just because the history file was unreachable for a moment.
        console.warn(`[SessionContext] history rehydrate failed for ${sessionId}:`, err);
      } finally {
        if (!cancelled) setIsRefreshingMessages(false);
      }
    }

    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, [currentSessionId]);

  const selectSession = useCallback((sessionId: string) => {
    console.log(`[SessionContext] selectSession: ${sessionId}`);
    setIsDraft(false);
    setCurrentSessionId(sessionId);
    setCurrentView("chat");
    setRunActive(null); // #99: drop the previous session's turn-active signal
    setTokenUsage(null); // drop the previous session's token totals
    connectSession(sessionId);
  }, [connectSession]);

  // Open a fresh, unpersisted conversation. Idempotent: if a draft is already
  // open, this just keeps it. The real session is created on first send.
  const startDraftSession = useCallback(() => {
    setIsDraft(true);
    setCurrentSessionId(null);
    setCurrentView("chat");
  }, []);

  const updateSessionTitle = useCallback(async (sessionId: string, title: string) => {
    setError(null);
    try {
      const updated = await api.sessions.update(sessionId, title);
      setSessions((current) =>
        [updated, ...current.filter((session) => session.id !== sessionId)].sort((a, b) =>
          b.updatedAt.localeCompare(a.updatedAt),
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : tg("ctx.session.updateFailed"));
      throw err;
    }
  }, []);

  const deleteSession = useCallback(async (sessionId: string) => {
    setError(null);
    try {
      await api.sessions.remove(sessionId);
      disconnectSession(sessionId);
      setSessions((current) => {
        const next = current.filter((session) => session.id !== sessionId);
        setCurrentSessionId((currentId) => (currentId === sessionId ? next[0]?.id ?? null : currentId));
        return next;
      });
      setMessagesBySession((current) => {
        const next = { ...current };
        delete next[sessionId];
        return next;
      });
      // Drop any unsent draft so re-creating a session with the same id (rare,
      // but possible) doesn't resurrect stale text.
      draftStore.delete(sessionId);
      hydratedSessionsRef.current.delete(sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : tg("ctx.session.deleteFailed"));
      throw err;
    }
  }, [disconnectSession]);

  const createSession = useCallback(
    async (title = "New research session", opts: { providerId?: string; modelId?: string; domainResources?: DomainResources } = {}) => {
      if (!currentSandbox || currentSandbox.status !== "running") {
        setError(tg("ctx.session.startSandbox"));
        return null;
      }

      setIsLoading(true);
      setError(null);
      try {
        const session = await api.sessions.create(title, opts);
        setSessions((current) => [session, ...current.filter((item) => item.id !== session.id)]);
        setIsDraft(false);
        setCurrentSessionId(session.id);
        setMessagesBySession((current) => ({ ...current, [session.id]: current[session.id] ?? [] }));
        return session;
      } catch (err) {
        setError(err instanceof Error ? err.message : tg("ctx.session.createFailed"));
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [currentSandbox],
  );

  useEffect(() => {
    if (sessions.length === 0 && !isLoading && currentSandbox?.status === "running" && !currentSessionId && !isDraft) {
      startDraftSession();
    }
  }, [sessions.length, isLoading, currentSandbox, currentSessionId, isDraft, startDraftSession]);

  const sendPrompt = useCallback(
    async (content: string, opts: { providerId?: string; modelId?: string; domainResources?: DomainResources } = {}) => {
      const trimmed = content.trim();
      console.log(`[SessionContext] sendPrompt: "${trimmed.slice(0, 40)}...", isConnected=${isConnected}, isDraft=${isDraft}`);
      if (!trimmed) {
        return false;
      }
      // A draft has no SSE connection yet — the session is created and
      // connected below. Only block on connection for an already-persisted
      // session.
      if (!currentSession && !isDraft) {
        setError(tg("ctx.session.noConnection"));
        return false;
      }
      if (currentSession && !isConnected) {
        setError(tg("ctx.session.noConnection"));
        return false;
      }

      setIsSending(true);
      setError(null);
      // Tracked so we can roll back the optimistic user message if the post
      // fails/times out (#106) — otherwise the bubble lingers and a retry
      // duplicates it.
      let optimistic: { sessionId: string; messageId: string } | null = null;
      try {
        const session = currentSession ?? (await createSession(trimmed.slice(0, 48), opts));
        if (!session) {
          return false;
        }
        // Freshly created (draft → persisted): open the SSE stream so the
        // assistant's streamed reply is received.
        if (!currentSession) {
          connectSession(session.id);
          // Migrate any draft text the composer stored under the sentinel id
          // so a tab switch mid-send doesn't lose it.
          draftStore.delete(DRAFT_SESSION_ID);
        }

        const timestamp = new Date().toISOString();
        const uuid = generateUUID();
        const userMessage: ChatMessage = {
          id: uuid,
          role: "user",
          content: trimmed,
          createdAt: timestamp,
          agent: "user",
        };
        optimistic = { sessionId: session.id, messageId: uuid };
        setMessagesBySession((current) => ({
          ...current,
          [session.id]: [...(current[session.id] ?? []), userMessage],
        }));
        console.log(`[SessionContext] posting message to ${session.id}`);
        await api.sessions.postMessage(session.id, { content: trimmed, uuid, timestamp });
        console.log(`[SessionContext] postMessage success`);
        return true;
      } catch (err) {
        console.error(`[SessionContext] sendPrompt error:`, err);
        // #106: roll back the optimistic bubble so the failed send doesn't
        // leave a ghost message (and a retry doesn't duplicate it).
        if (optimistic) {
          const { sessionId: sid, messageId } = optimistic;
          setMessagesBySession((current) => ({
            ...current,
            [sid]: (current[sid] ?? []).filter((m) => m.id !== messageId),
          }));
        }
        // AbortSignal.timeout() rejects with a TimeoutError (and a hard abort
        // with AbortError). Surface a clear, retryable message instead of the
        // raw DOMException text, and let `finally` release isSending so the
        // composer never stays stuck on "正在准备发送".
        const isTimeout =
          err instanceof DOMException &&
          (err.name === "TimeoutError" || err.name === "AbortError");
        setError(
          isTimeout
            ? tg("ctx.session.sendTimeout")
            : err instanceof Error
              ? err.message
              : tg("ctx.session.sendFailed"),
        );
        return false;
      } finally {
        setIsSending(false);
      }
    },
    [createSession, currentSession, isConnected, isDraft, connectSession],
  );

  const interruptCurrent = useCallback(
    async () => {
      if (!currentSession) return;
      const sid = currentSession.id;
      // #90: NOT optimistic. Wait for the interrupt to actually land before
      // touching the UI — the old code optimistically forced every agent idle
      // and inserted a "stopped" message even when the request hit the wrong
      // endpoint and failed, permanently masking the failure while the runtime
      // kept the agent running. We never speculatively mutate agent state now, so
      // a failed interrupt leaves the true (still-running) state visible via the
      // authoritative SSE session_state stream.
      try {
        const { interrupted } = await api.sessions.interrupt(sid);
        if (!interrupted) {
          // Nothing was running to interrupt (or the session is gone). Surface it
          // rather than pretending the task stopped.
          setError(tg("ctx.session.interruptFailed"));
          return;
        }
        // Confirmed stopped: insert the status line. Agent state (incl. the PI
        // interrupt-acknowledgement run the runtime now fires) flows in via SSE.
        setMessagesBySession((current) => {
          const msgs = current[sid] ?? [];
          const stoppedMsg: ChatMessage = {
            id: generateUUID(),
            role: "system",
            content: tg("chat.stoppedByUser"),
            createdAt: new Date().toISOString(),
            kind: "status",
          };
          return { ...current, [sid]: [...finalizeAssistant(msgs), stoppedMsg] };
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : tg("ctx.session.interruptFailed"));
      }
    },
    [currentSession],
  );

  const respondToInput = useCallback(
    async (requestId: string, answer: string) => {
      const sid = currentSession?.id;
      if (!sid || !requestId) return;
      // Optimistically resolve the matching ask_user card so the buttons
      // disable immediately, without waiting for the echoed user_input_response.
      setMessagesBySession((current) => {
        const msgs = current[sid] ?? [];
        return {
          ...current,
          [sid]: msgs.map((m) =>
            m.kind === "ask_user" && m.askUser?.requestId === requestId
              ? { ...m, askUser: { ...m.askUser, answer } }
              : m,
          ),
        };
      });
      try {
        await api.sessions.respondToInput(sid, { requestId, answer });
      } catch (err) {
        setError(err instanceof Error ? err.message : tg("ctx.session.sendFailed"));
      }
    },
    [currentSession],
  );

  const refreshMessages = useCallback(async () => {
    if (!currentSession) {
      return;
    }
      console.log(`[SessionContext] refreshMessages: ${currentSession.id}`);
    setIsRefreshingMessages(true);
    setError(null);
    try {
      const { events } = await api.sessions.getHistory(currentSession.id, {
        limit: HISTORY_REHYDRATE_LIMIT,
      });
      const { messages: nextMessages, trace: nextTrace, agents: nextAgents, tokenUsage: nextUsage } =
        foldSessionHistory(events, currentSession.id);

      if (nextUsage) setTokenUsage(nextUsage);
      setMessagesBySession((current) => ({ ...current, [currentSession.id]: nextMessages }));
      if (nextTrace) {
        setTraceBySession((current) => ({ ...current, [currentSession.id]: nextTrace }));
      }
      if (nextAgents && nextAgents.length > 0) {
        setAgents(nextAgents);
        setAgentFilters((current) => {
          let changed = false;
          const next = { ...current };
          for (const agent of nextAgents) {
            if (!next[agent.name]) {
              changed = true;
              next[agent.name] = defaultAgentFilter(agent.name);
            }
          }
          return changed ? next : current;
        });
      }
      hydratedSessionsRef.current.add(currentSession.id);

      // Re-connect the SSE stream so live updates continue after the disk
      // history has refreshed the local cache.
      disconnectSession(currentSession.id);
      connectSession(currentSession.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : tg("ctx.session.refreshFailed"));
    } finally {
      setIsRefreshingMessages(false);
    }
  }, [currentSession, disconnectSession, connectSession]);

  useEffect(() => {
    if (!currentSession?.id) {
      setAgents([]);
      return;
    }
    let cancelled = false;
    // Backstop fetch in case the SSE first-frame CUSTOM:session_state hasn't
    // arrived yet (e.g. tab restore while SSE is reconnecting). The same
    // payload arrives via SSE moments later and overwrites this wholesale.
    void api.sessions.state(currentSession.id).then((snap) => {
      if (!cancelled) {
        setAgents(snap.agents.map((agent) => ({
          ...agent,
          updatedAt: agent.updatedAt || new Date().toISOString(),
        })));
      }
    }).catch(() => {
      if (!cancelled) {
        setAgents([]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [currentSession?.id]);

  // #79: seed the Graph of Trace once per session. Live updates thereafter
  // arrive incrementally via CUSTOM:trace_node (queue drain below), so no poll.
  const refreshTrace = useCallback(async (sessionId: string) => {
    try {
      const graph = await api.sessions.getTrace(sessionId);
      setTraceBySession((current) => ({ ...current, [sessionId]: graph }));
    } catch {
      // Non-fatal — the panel shows an empty graph until events arrive.
    }
  }, []);

  useEffect(() => {
    const sid = currentSession?.id;
    if (!sid) return;
    void refreshTrace(sid);
  }, [currentSession?.id, refreshTrace]);

  // Auto-connect SSE whenever the current session changes. Other connections
  // are kept open so background sessions continue receiving events.
  useEffect(() => {
    if (currentSessionId) {
      connectSession(currentSessionId);
    }
  }, [currentSessionId, connectSession]);

  // Drain the SSE event queue for the current session on every tick.
  useEffect(() => {
    if (!currentSessionId || !queueRef.current) {
      return;
    }
    const sid = currentSessionId;
    const queue = queueRef.current.get(sid) || [];
    if (queue.length === 0) {
      return;
    }
    // Atomically clear the queue so events added during processing are handled
    // in the next effect run.
    queueRef.current.set(sid, []);

    console.log(`[SessionContext] draining queue: sid=${sid}, events=${queue.length}`);

    // Process session title updates
    for (const event of queue) {
      if (event.type === "CUSTOM" && event.name === "session_title") {
        const newTitle = (event.value as { title: string })?.title;
        if (newTitle) {
          setSessions((current) =>
            current.map((s) =>
              s.id === sid ? { ...s, title: newTitle } : s,
            ),
          );
        }
        continue;
      }
    }

    // Process session-state events first so agents state is up to date
    // before any UI tied to spinner / agent list re-renders.
    for (const event of queue) {
      if (event.type === "CUSTOM" && event.name === "session_state") {
        // Authoritative live state from the sandbox. Replaces the agents list
        // wholesale on every occurrence — same payload arrives via SSE first
        // frame on reconnect and on every semantic transition thereafter.
        const value = (event.value ?? {}) as Record<string, unknown>;
        const agentsRaw = Array.isArray(value.agents) ? (value.agents as Array<Record<string, unknown>>) : [];
        const nextAgents = agentsRaw.map((agent) => ({
          name: String(agent.name ?? ""),
          status: String(agent.status ?? "idle"),
          task: String(agent.task ?? ""),
          updatedAt: typeof agent.updatedAt === "string" ? agent.updatedAt : new Date().toISOString(),
          alive: typeof agent.alive === "boolean" ? agent.alive : undefined,
        }));
        setAgents(nextAgents);
        // #99: feed the whole-turn timer. runState.active is the authoritative
        // "the user's task is still running" flag; lastActivityTs is the backend
        // timestamp of this snapshot (fallback to now() if absent).
        const rs = (value.runState ?? {}) as Record<string, unknown>;
        const tsRaw = typeof value.lastActivityTs === "string" ? Date.parse(value.lastActivityTs) : NaN;
        setRunActive({
          active: rs.active === true,
          atMs: Number.isNaN(tsRaw) ? Date.now() : tsRaw,
        });
        // Cumulative real token usage rides on the same frame (optional).
        const usage = parseTokenUsageValue(value.tokenUsage);
        if (usage) setTokenUsage(usage);
        // Apply default filters for newly discovered agents:
        // - trace agent: hide messages and tools by default
        // - all agents: hide hooks by default
        setAgentFilters((current) => {
          let changed = false;
          const next = { ...current };
          for (const agent of nextAgents) {
            const existing = current[agent.name];
            if (!existing) {
              changed = true;
              next[agent.name] = defaultAgentFilter(agent.name);
            }
          }
          return changed ? next : current;
        });
        // 当 agent_runtime 进程重建（container restart / eviction）后，
        // 内存中的 SessionState 被 hydrate_from_fold 重置为 idle。
        // 向前端插入系统提示，避免用户误以为 agent 仍在运行。
        if (value.recovered === true) {
          setMessagesBySession((current) => {
            const msgs = current[sid] ?? [];
            const recoveredMsg: ChatMessage = {
              id: generateUUID(),
              role: "system",
              content: "⚠️ Session connection recovered. Agent states may have been reset due to a runtime restart.",
              createdAt: new Date().toISOString(),
              kind: "status",
            };
            return { ...current, [sid]: [...msgs, recoveredMsg] };
          });
        }
        continue;
      }
      // session_heartbeat carries only timestamps — no agents / run touch.
      // Currently no UI binds to last_activity_ts; placeholder for the future
      // "session has gone silent for N seconds" indicator.
      if (event.type === "CUSTOM" && event.name === "session_heartbeat") {
        continue;
      }
    }

    // #70: keep the Agents panel live between session_state snapshots by merging
    // standalone agent_status_update events. session_state (above) remains the
    // wholesale authority; this applies single-agent deltas on top so the panel
    // updates on the first run without a reload/reselect. The queue is already
    // scoped to the current session (queueRef.get(sid)), so background-session
    // events don't leak in here.
    setAgents((current) => {
      let nextAgents = current;
      const appended: AgentStatus[] = [];
      for (const event of queue) {
        if (event.type !== "agent_status_update") continue;
        const before = nextAgents;
        nextAgents = reduceAgentsForEvent(nextAgents, event);
        if (nextAgents.length > before.length) {
          appended.push(nextAgents[nextAgents.length - 1]!);
        }
      }
      if (appended.length > 0) {
        // Apply the same default filters session_state uses for newly seen
        // agents (trace: hide messages/tools; all: hide hooks).
        setAgentFilters((cur) => {
          let changed = false;
          const nf = { ...cur };
          for (const agent of appended) {
            if (!cur[agent.name]) {
              changed = true;
              nf[agent.name] = defaultAgentFilter(agent.name);
            }
          }
          return changed ? nf : cur;
        });
      }
      return nextAgents;
    });

    // #79: fold CUSTOM:trace_node events into the live Graph of Trace. The queue
    // is already scoped to the current session, so only this session's graph
    // updates. reduceTraceForEvent ignores non-trace events (same reference).
    setTraceBySession((current) => {
      const start = current[sid] ?? null;
      let graph: TraceGraph | null = start;
      for (const event of queue) {
        graph = reduceTraceForEvent(graph, event, sid);
      }
      if (graph && graph !== start) {
        // #134 — a live trace update landed. Raise the per-session unread dot
        // unless the user is already looking at this session's Trace view (then
        // it's seen). Hydration/seed go through other code paths, so this only
        // ever fires for genuine post-open SSE trace_node events.
        if (currentViewRef.current !== "trace") {
          setTraceUnreadBySession((u) => (u[sid] ? u : { ...u, [sid]: true }));
        }
        return { ...current, [sid]: graph };
      }
      return current;
    });

    // Process all events through the message reducer. While we're at it, count
    // any newly-appended non-fatal system_message per session so the Agents-tab
    // red dot (issue #278) reflects hidden errors even though the message
    // stream folded them out. We diff by id so coalesced updates to an
    // existing bubble don't double-count.
    const hiddenAdds = new Map<string, number>();
    const foldRuleEnabled = messageFiltersRef.current.some(
      (r) => r.id === HIDE_NON_FATAL_AGENT_ERRORS && r.enabled,
    );
    setMessagesBySession((current) => {
      let messages = current[sid] ?? [];
      const countHiddenAdds = (from: ChatMessage[], to: ChatMessage[], sessionId: string) => {
        if (!foldRuleEnabled) return;
        const beforeIds = new Set(
          from.filter(isNonFatalAgentErrorMessage).map((m) => m.id),
        );
        let added = 0;
        for (const m of to) {
          if (!isNonFatalAgentErrorMessage(m)) continue;
          if (!beforeIds.has(m.id)) added += 1;
        }
        if (added > 0) {
          hiddenAdds.set(sessionId, (hiddenAdds.get(sessionId) ?? 0) + added);
        }
      };
      for (const event of queue) {
        const eventSid = eventSessionId(event);
        if (eventSid && eventSid !== sid) {
          // Background session event — also update its message list.
          const before = current[eventSid] ?? [];
          const next = reduceMessagesForEvent(before, event);
          countHiddenAdds(before, next, eventSid);
          current = { ...current, [eventSid]: next };
          messages = current[sid] ?? [];
          continue;
        }
        const before = messages;
        messages = reduceMessagesForEvent(messages, event);
        countHiddenAdds(before, messages, sid);
      }
      return { ...current, [sid]: messages };
    });
    if (hiddenAdds.size > 0) {
      setHiddenErrorsBySession((cur) => {
        const next = { ...cur };
        for (const [sessionId, added] of hiddenAdds.entries()) {
          const prev = cur[sessionId] ?? { count: 0, seen: true };
          // Landing new hidden errors flips `seen` back to false so the dot
          // re-appears even if the user cleared it earlier this session.
          next[sessionId] = { count: prev.count + added, seen: false };
        }
        return next;
      });
    }
  }, [currentSessionId, tick]);

  const setAgentFilter = useCallback(
    (agentName: string, hideMessages: boolean, hideTools: boolean, hideHooks?: boolean) => {
      setAgentFilters((current) => {
        const prev = current[agentName] ?? { hideMessages: false, hideTools: false, hideHooks: true };
        return {
          ...current,
          [agentName]: { hideMessages, hideTools, hideHooks: hideHooks ?? prev.hideHooks },
        };
      });
    },
    [],
  );

  // Issue #278 — toggle a filter rule and persist. Also marks any pending
  // hidden-error badge for the current session as seen when the "fold agent
  // errors" rule is disabled — the user has explicitly opted to see errors
  // inline again, so the "you have hidden errors" hint is no longer useful.
  const setMessageFilterEnabled = useCallback(
    (ruleId: string, enabled: boolean) => {
      setMessageFilters((current) => {
        let changed = false;
        const next = current.map((rule) => {
          if (rule.id !== ruleId || rule.enabled === enabled) return rule;
          changed = true;
          return { ...rule, enabled };
        });
        if (!changed) return current;
        persistMessageFilters(next);
        return next;
      });
      if (ruleId === HIDE_NON_FATAL_AGENT_ERRORS && !enabled && currentSessionId) {
        setHiddenErrorsBySession((cur) => {
          const entry = cur[currentSessionId];
          if (!entry || entry.seen) return cur;
          return { ...cur, [currentSessionId]: { ...entry, seen: true } };
        });
      }
    },
    [currentSessionId],
  );

  const currentTrace = useMemo(
    () => (currentSessionId ? (traceBySession[currentSessionId] ?? null) : null),
    [currentSessionId, traceBySession],
  );

  // #134 — opening the Trace view for a session marks its trace as seen, so the
  // tab dot clears. Keyed on (session, view) so it also clears when a trace
  // update arrives while already on the view (the drain guards that case too).
  useEffect(() => {
    if (currentView !== "trace" || !currentSessionId) return;
    setTraceUnreadBySession((u) => (u[currentSessionId] ? { ...u, [currentSessionId]: false } : u));
  }, [currentView, currentSessionId]);

  // Issue #278 — opening the Agents view marks any hidden-error badge for the
  // current session as seen. Mirrors the traceUnread clear above.
  useEffect(() => {
    if (currentView !== "agents" || !currentSessionId) return;
    setHiddenErrorsBySession((cur) => {
      const entry = cur[currentSessionId];
      if (!entry || entry.seen) return cur;
      return { ...cur, [currentSessionId]: { ...entry, seen: true } };
    });
  }, [currentView, currentSessionId]);

  const traceUnread = currentSessionId ? (traceUnreadBySession[currentSessionId] ?? false) : false;
  const hiddenErrorsEntry = currentSessionId ? hiddenErrorsBySession[currentSessionId] : undefined;
  const hiddenErrorsCount = hiddenErrorsEntry?.count ?? 0;
  const hiddenErrorsUnread = !!(hiddenErrorsEntry && hiddenErrorsEntry.count > 0 && !hiddenErrorsEntry.seen);

  const value = useMemo(
    () => ({
      sessions,
      currentSession,
      messages,
      isLoading,
      isSending,
      isRefreshingMessages,
      isConnected,
      isDraft,
      error,
      currentView,
      agents,
      runActive,
      tokenUsage,
      agentFilters,
      currentTrace,
      traceUnread,
      refreshTrace,
      selectSession,
      createSession,
      startDraftSession,
      updateSessionTitle,
      deleteSession,
      sendPrompt,
      interruptCurrent,
      respondToInput,
      refreshSessions,
      refreshMessages,
      setCurrentView,
      setAgentFilter,
      messageFilters,
      setMessageFilterEnabled,
      hiddenErrorsCount,
      hiddenErrorsUnread,
    }),
    [
      sessions,
      currentSession,
      messages,
      isLoading,
      isSending,
      isRefreshingMessages,
      isConnected,
      isDraft,
      error,
      currentView,
      agents,
      runActive,
      tokenUsage,
      agentFilters,
      currentTrace,
      traceUnread,
      refreshTrace,
      selectSession,
      createSession,
      startDraftSession,
      updateSessionTitle,
      deleteSession,
      sendPrompt,
      interruptCurrent,
      respondToInput,
      refreshSessions,
      refreshMessages,
      setCurrentView,
      setAgentFilter,
      messageFilters,
      setMessageFilterEnabled,
      hiddenErrorsCount,
      hiddenErrorsUnread,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSessions() {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error("useSessions must be used within SessionProvider");
  }
  return value;
}
