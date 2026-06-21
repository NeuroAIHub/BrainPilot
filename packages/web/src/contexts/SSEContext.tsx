import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { runtimeConfig } from "../config";
import { WebSocketEvent, normalizeWebSocketEvent } from "../contracts/backend";
import { getSSEUrl } from "../utils/api";
import { tg } from "../i18n/translate";
import { useAuth } from "./AuthContext";
import { useSandbox } from "./SandboxContext";

type ConnectionStatus = "idle" | "connecting" | "open" | "error";

interface SSEContextValue {
  /** Open (or reuse) an SSE stream for a session. */
  connectSession: (sessionId: string) => void;
  /** Close the SSE stream for a session. */
  disconnectSession: (sessionId: string) => void;
  /** Pending event queue per session (drained by consumer). */
  queueRef: React.RefObject<Map<string, WebSocketEvent[]>>;
  /** Tick counter — increments when new events arrive. */
  tick: number;
  /** Connection status per session. */
  connections: Map<string, ConnectionStatus>;
}

const SSEContext = createContext<SSEContextValue | null>(null);

const RECONNECT_BASE_MS = 3000;
const RECONNECT_MAX_MS = 30000;
// #106: if an EventSource never fires `onopen` within this window we treat the
// connection as dead and force a rebuild. A frozen tab / bfcache restore can
// leave a stale source stuck in CONNECTING whose onopen/onerror never fire
// again — without this watchdog the UI sits on "正在连接实时通道" forever.
const OPEN_WATCHDOG_MS = 8000;

interface SessionConn {
  source: EventSource;
  reconnectAttempt: number;
  reconnectTimer: number | null;
  /** #106: fires if onopen doesn't arrive in time — forces a reconnect. */
  openWatchdog: number | null;
  /** Whether disconnectSession was called — disable auto-reconnect. */
  manuallyClosed: boolean;
}

export function SSEProvider({ children }: { children: ReactNode }) {
  const { isAuthReady } = useAuth();
  const { currentSandbox } = useSandbox();
  const connsRef = useRef<Map<string, SessionConn>>(new Map());
  const queueRef = useRef<Map<string, WebSocketEvent[]>>(new Map());
  const [tick, setTick] = useState(0);
  const [connections, setConnections] = useState<Map<string, ConnectionStatus>>(new Map());

  const setStatus = useCallback((sessionId: string, status: ConnectionStatus) => {
    setConnections((prev) => {
      const next = new Map(prev);
      next.set(sessionId, status);
      return next;
    });
  }, []);

  const openConnection = useCallback((sessionId: string) => {
    if (runtimeConfig.useMockBackend) {
      setStatus(sessionId, "open");
      return;
    }
    const conn = connsRef.current.get(sessionId);
    if (conn && !conn.manuallyClosed && conn.source.readyState !== EventSource.CLOSED) {
      // Already connecting/open — nothing to do.
      return;
    }

    // A stale entry may exist (e.g. watchdog-forced rebuild) — clear its timers
    // and close its source before replacing it.
    if (conn) {
      if (conn.reconnectTimer !== null) window.clearTimeout(conn.reconnectTimer);
      if (conn.openWatchdog !== null) window.clearTimeout(conn.openWatchdog);
      try {
        conn.source.close();
      } catch {
        /* already closed */
      }
    }

    console.log(`[SSE] openConnection: ${sessionId}`);
    setStatus(sessionId, "connecting");
    const source = new EventSource(getSSEUrl(sessionId));

    const entry: SessionConn = {
      source,
      reconnectAttempt: conn?.reconnectAttempt ?? 0,
      reconnectTimer: null,
      openWatchdog: null,
      manuallyClosed: false,
    };
    connsRef.current.set(sessionId, entry);

    // #106: if onopen never lands, the connection is wedged. Tear it down and
    // reconnect through the normal backoff path so the composer doesn't stay
    // disabled on a dead "connecting" state.
    entry.openWatchdog = window.setTimeout(() => {
      entry.openWatchdog = null;
      if (entry.manuallyClosed) return;
      if (entry.source.readyState === EventSource.OPEN) return;
      console.warn(`[SSE] open watchdog fired for ${sessionId} — forcing reconnect`);
      try {
        entry.source.close();
      } catch {
        /* already closed */
      }
      setStatus(sessionId, "error");
      entry.reconnectAttempt += 1;
      const delay = Math.min(
        RECONNECT_BASE_MS * Math.pow(2, entry.reconnectAttempt - 1),
        RECONNECT_MAX_MS,
      );
      entry.reconnectTimer = window.setTimeout(() => {
        entry.reconnectTimer = null;
        openConnection(sessionId);
      }, delay);
    }, OPEN_WATCHDOG_MS);

    source.onopen = () => {
      entry.reconnectAttempt = 0;
      if (entry.openWatchdog !== null) {
        window.clearTimeout(entry.openWatchdog);
        entry.openWatchdog = null;
      }
      console.log(`[SSE] onopen: ${sessionId}`);
      setStatus(sessionId, "open");
    };

    source.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(ev.data);
        const normalized = normalizeWebSocketEvent(parsed);
        // Drop heartbeats — they exist only to keep the connection alive.
        if (normalized.type === "PING" || normalized.type === "ping") return;
        console.log(`[SSE] onmessage: ${sessionId} type=${normalized.type}`, normalized);
        const queue = queueRef.current.get(sessionId) || [];
        queue.push(normalized);
        queueRef.current.set(sessionId, queue);
        setTick((t) => t + 1);
      } catch {
        console.error(`[SSE] onmessage: ${sessionId} 解析失败`, ev.data);
        // Malformed payload — surface as a synthetic error event for the UI.
        const queue = queueRef.current.get(sessionId) || [];
        queue.push({
          type: "error",
          sessionId,
          data: { error: { message: tg("ctx.sse.parseError") } },
        });
        queueRef.current.set(sessionId, queue);
        setTick((t) => t + 1);
      }
    };

    source.onerror = () => {
      console.error(`[SSE] onerror: ${sessionId}, reconnectAttempt=${entry.reconnectAttempt + 1}`);
      if (entry.openWatchdog !== null) {
        window.clearTimeout(entry.openWatchdog);
        entry.openWatchdog = null;
      }
      setStatus(sessionId, "error");
      source.close();
      if (entry.manuallyClosed) return;
      // Exponential backoff for auto-reconnect.
      entry.reconnectAttempt += 1;
      const delay = Math.min(
        RECONNECT_BASE_MS * Math.pow(2, entry.reconnectAttempt - 1),
        RECONNECT_MAX_MS,
      );
      console.log(`[SSE] reconnect: ${sessionId} in ${delay}ms`);
      entry.reconnectTimer = window.setTimeout(() => {
        entry.reconnectTimer = null;
        openConnection(sessionId);
      }, delay);
    };
  }, [setStatus]);

  const connectSession = useCallback((sessionId: string) => {
    console.log(`[SSE] connectSession: ${sessionId}, authReady=${isAuthReady}, sandbox=${currentSandbox?.status}`);
    if (!isAuthReady) return;
    if (!runtimeConfig.useMockBackend && currentSandbox?.status !== "running") return;
    openConnection(sessionId);
  }, [isAuthReady, currentSandbox?.status, openConnection]);

  const disconnectSession = useCallback((sessionId: string) => {
    console.log(`[SSE] disconnectSession: ${sessionId}`);
    const entry = connsRef.current.get(sessionId);
    if (!entry) return;
    entry.manuallyClosed = true;
    if (entry.reconnectTimer !== null) {
      window.clearTimeout(entry.reconnectTimer);
      entry.reconnectTimer = null;
    }
    if (entry.openWatchdog !== null) {
      window.clearTimeout(entry.openWatchdog);
      entry.openWatchdog = null;
    }
    entry.source.close();
    connsRef.current.delete(sessionId);
    setStatus(sessionId, "idle");
  }, [setStatus]);

  // On unmount or auth/sandbox change, tear down every connection.
  useEffect(() => {
    return () => {
      for (const [, entry] of connsRef.current) {
        entry.manuallyClosed = true;
        if (entry.reconnectTimer !== null) {
          window.clearTimeout(entry.reconnectTimer);
        }
        if (entry.openWatchdog !== null) {
          window.clearTimeout(entry.openWatchdog);
        }
        entry.source.close();
      }
      connsRef.current.clear();
    };
  }, [isAuthReady, currentSandbox?.status]);

  // #106: bfcache / frozen-tab restore can leave an EventSource that looks
  // alive (readyState !== CLOSED) but whose onopen/onerror never fire again, so
  // the composer stays stuck on "connecting". On page restore or tab
  // re-focus, force any non-open connection to rebuild. The browser-native
  // `pageshow` (persisted) covers bfcache; `visibilitychange` covers the more
  // common "switched away and back" case.
  useEffect(() => {
    const revive = () => {
      for (const [sessionId, entry] of connsRef.current) {
        if (entry.manuallyClosed) continue;
        if (entry.source.readyState === EventSource.OPEN) continue;
        console.log(`[SSE] revive stale connection on restore: ${sessionId}`);
        openConnection(sessionId);
      }
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) revive();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") revive();
    };
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [openConnection]);

  const value = useMemo<SSEContextValue>(
    () => ({ connectSession, disconnectSession, queueRef, tick, connections }),
    [connectSession, disconnectSession, tick, connections],
  );

  return <SSEContext.Provider value={value}>{children}</SSEContext.Provider>;
}

export function useSSE() {
  const value = useContext(SSEContext);
  if (!value) {
    throw new Error("useSSE must be used within SSEProvider");
  }
  return value;
}
