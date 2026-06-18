import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
// TODO(dead-code): SessionEventEntry removed with pre-AG-UI polling protocol.
import { AgentStatus, ChatMessage, MessageFilterRule, Session, /* SessionEventEntry, */ SessionMessageEntry } from "../contracts/backend";
import { api } from "../utils/api";
import { tg } from "../i18n/translate";
import { useAuth } from "./AuthContext";
import { useSandbox } from "./SandboxContext";
import { useSSE } from "./SSEContext";
import { draftStore } from "./draftStore";
import { defaultFilterRules } from "./messageFilters";
import {
  eventSessionId,
  finalizeAssistant,
  generateUUID,
  reduceMessagesForEvent,
} from "./messageReducer";
import { reduceAgentsForEvent } from "./agentsReducer";

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
  agentFilters: Record<string, AgentMessageFilter>;
  selectSession: (sessionId: string) => void;
  createSession: (title?: string, opts?: { providerId?: string; modelId?: string }) => Promise<Session | null>;
  /**
   * Open a fresh draft conversation without persisting anything. Idempotent —
   * repeated calls collapse to the single draft state. The real session is
   * created lazily on the first sendPrompt.
   */
  startDraftSession: () => void;
  updateSessionTitle: (sessionId: string, title: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  sendPrompt: (content: string, opts?: { providerId?: string; modelId?: string }) => Promise<void>;
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
}

// Stable key for the not-yet-persisted draft session. The composer keys its
// draft text by this id while `isDraft` is true; once the real session is
// created on first send, the composer switches to the real session id.
export const DRAFT_SESSION_ID = "__draft__";

const SessionContext = createContext<SessionContextValue | null>(null);

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
  // Unsent textarea drafts live in a module-level store (see contexts/draftStore.ts)
  // so keystrokes don't re-render the whole chat subtree. Drafts are keyed by
  // session id and survive PromptComposer unmount (tab switches).
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [agentFilters, setAgentFilters] = useState<Record<string, AgentMessageFilter>>({});
  const [messageFilters, setMessageFilters] = useState<MessageFilterRule[]>(defaultFilterRules);


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

  useEffect(() => {
    if (!currentSessionId) {
      return;
    }
    const sessionId = currentSessionId;
    let cancelled = false;
    async function loadMessages() {
      setIsRefreshingMessages(true);
      if (!cancelled) {
        setMessagesBySession((current) => ({ ...current, [sessionId]: current[sessionId] ?? [] }));
      }
      setIsRefreshingMessages(false);
    }
    void loadMessages();
    return () => {
      cancelled = true;
    };
    return () => {
      cancelled = true;
    };
  }, [currentSessionId]);

  const selectSession = useCallback((sessionId: string) => {
    console.log(`[SessionContext] selectSession: ${sessionId}`);
    setIsDraft(false);
    setCurrentSessionId(sessionId);
    setCurrentView("chat");
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
    } catch (err) {
      setError(err instanceof Error ? err.message : tg("ctx.session.deleteFailed"));
      throw err;
    }
  }, [disconnectSession]);

  const createSession = useCallback(
    async (title = "New research session", opts: { providerId?: string; modelId?: string } = {}) => {
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
    async (content: string, opts: { providerId?: string; modelId?: string } = {}) => {
      const trimmed = content.trim();
      console.log(`[SessionContext] sendPrompt: "${trimmed.slice(0, 40)}...", isConnected=${isConnected}, isDraft=${isDraft}`);
      if (!trimmed) {
        return;
      }
      // A draft has no SSE connection yet — the session is created and
      // connected below. Only block on connection for an already-persisted
      // session.
      if (!currentSession && !isDraft) {
        setError(tg("ctx.session.noConnection"));
        return;
      }
      if (currentSession && !isConnected) {
        setError(tg("ctx.session.noConnection"));
        return;
      }

      setIsSending(true);
      setError(null);
      try {
        const session = currentSession ?? (await createSession(trimmed.slice(0, 48), opts));
        if (!session) {
          return;
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
        setMessagesBySession((current) => ({
          ...current,
          [session.id]: [...(current[session.id] ?? []), userMessage],
        }));
        console.log(`[SessionContext] posting message to ${session.id}`);
        await api.sessions.postMessage(session.id, { content: trimmed, uuid, timestamp });
        console.log(`[SessionContext] postMessage success`);
      } catch (err) {
        console.error(`[SessionContext] sendPrompt error:`, err);
        setError(err instanceof Error ? err.message : tg("ctx.session.sendFailed"));
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
      // Optimistic update: immediately stop the spinner so the user can type
      // the next message without waiting for the backend RUN_FINISHED round-trip.
      setMessagesBySession((current) => {
        const msgs = current[sid] ?? [];
        const stoppedMsg: ChatMessage = {
          id: generateUUID(),
          role: "system",
          content: "Task stopped by user",
          createdAt: new Date().toISOString(),
          kind: "status",
        };
        return { ...current, [sid]: [...finalizeAssistant(msgs), stoppedMsg] };
      });
      setAgents((current) =>
        current.map((a) => ({ ...a, status: "idle", task: "" })),
      );
      try {
        await api.sessions.interrupt(sid);
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
      // Re-connect the SSE stream — the server will emit a fresh
      // MESSAGES_SNAPSHOT as the first frame, replacing the local cache.
      disconnectSession(currentSession.id);
      // Clear local state so the snapshot becomes the authoritative source.
      setMessagesBySession((current) => ({ ...current, [currentSession.id]: [] }));
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
              const isTrace = agent.name === "trace";
              next[agent.name] = {
                hideMessages: isTrace,
                hideTools: isTrace,
                hideHooks: true,
              };
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
              const isTrace = agent.name === "trace";
              nf[agent.name] = {
                hideMessages: isTrace,
                hideTools: isTrace,
                hideHooks: true,
              };
            }
          }
          return changed ? nf : cur;
        });
      }
      return nextAgents;
    });

    // Process all events through the message reducer.
    setMessagesBySession((current) => {
      let messages = current[sid] ?? [];
      for (const event of queue) {
        const eventSid = eventSessionId(event);
        if (eventSid && eventSid !== sid) {
          // Background session event — also update its message list.
          messages = current[eventSid] ?? [];
          const next = reduceMessagesForEvent(messages, event);
          current = { ...current, [eventSid]: next };
          messages = current[sid] ?? [];
          continue;
        }
        messages = reduceMessagesForEvent(messages, event);
      }
      return { ...current, [sid]: messages };
    });
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
      agentFilters,
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
      agentFilters,
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
