import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Sandbox, SandboxStats } from "../contracts/backend";
import { api } from "../utils/api";
import { tg } from "../i18n/translate";
import { useAuth } from "./AuthContext";
import { runtimeConfig } from "../config";

export type SandboxOperation = "idle" | "loading" | "creating" | "rebuilding" | "destroying";

interface SandboxContextValue {
  sandboxes: Sandbox[];
  currentSandbox: Sandbox | null;
  stats: SandboxStats | null;
  status: string;
  operation: SandboxOperation;
  error: string | null;
  logs: string;
  refresh: () => Promise<void>;
  refreshStats: () => Promise<void>;
  createSandbox: () => Promise<void>;
  rebuildSandbox: () => Promise<void>;
  destroySandbox: () => Promise<void>;
  reloadConfig: () => Promise<void>;
}

const SandboxContext = createContext<SandboxContextValue | null>(null);

function selectSandbox(sandboxes: Sandbox[]): Sandbox | null {
  // Skip "error" rows: they're stale corpses from a previous container that
  // the backend's _sync_running_status conservatively flipped to ERROR only
  // after confirming the container was not_found / exited / dead / removing.
  // Treating them as currentSandbox would block auto-create and leave the
  // user stuck on "沙盒状态异常" until they manually clicked Build.
  const live = sandboxes.filter((sandbox) => sandbox.status !== "error");
  return live.find((sandbox) => sandbox.status === "running") ?? live[0] ?? null;
}

export function SandboxProvider({ children }: { children: ReactNode }) {
  // Single-user local mode: there is no container lifecycle. The runtime
  // launched by `brainpilot up` is always the sandbox, addressed per-session by
  // the file routes. We expose a static "running" sandbox so the composer and
  // file panels work, and never call /api/sandbox/* lifecycle endpoints (which
  // the local backend does not implement). File operations resolve the real
  // workspace by the active session id inside the file components themselves.
  if (runtimeConfig.localMode) {
    return <LocalSandboxProvider>{children}</LocalSandboxProvider>;
  }
  return <RemoteSandboxProvider>{children}</RemoteSandboxProvider>;
}

const LOCAL_SANDBOX: Sandbox = {
  id: "local",
  name: "local",
  status: "running",
  port: null,
  userId: "local",
  createdAt: new Date(0).toISOString(),
};

function LocalSandboxProvider({ children }: { children: ReactNode }) {
  const noop = useCallback(async () => {}, []);
  const value = useMemo<SandboxContextValue>(
    () => ({
      sandboxes: [LOCAL_SANDBOX],
      currentSandbox: LOCAL_SANDBOX,
      stats: null,
      status: "running",
      operation: "idle",
      error: null,
      logs: "",
      refresh: noop,
      refreshStats: noop,
      createSandbox: noop,
      rebuildSandbox: noop,
      destroySandbox: noop,
      reloadConfig: noop,
    }),
    [noop],
  );
  return <SandboxContext.Provider value={value}>{children}</SandboxContext.Provider>;
}

function RemoteSandboxProvider({ children }: { children: ReactNode }) {
  const { isAuthReady } = useAuth();
  const [sandboxes, setSandboxes] = useState<Sandbox[]>([]);
  const [currentSandbox, setCurrentSandbox] = useState<Sandbox | null>(null);
  const [stats, setStats] = useState<SandboxStats | null>(null);
  const [operation, setOperation] = useState<SandboxOperation>("idle");
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string>("");
  const [hasLoaded, setHasLoaded] = useState(false);
  const shouldAutoStartRef = useRef(true);

  const refresh = useCallback(async () => {
    if (!isAuthReady) {
      setSandboxes([]);
      setCurrentSandbox(null);
      setStats(null);
      return;
    }

    setOperation((current) => (current === "idle" ? "loading" : current));
    setError(null);
    try {
      const nextSandboxes = await api.sandbox.list();
      setSandboxes(nextSandboxes);
      setCurrentSandbox(selectSandbox(nextSandboxes));
      setHasLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : tg("ctx.sandbox.loadFailed"));
    } finally {
      setOperation((current) => (current === "loading" ? "idle" : current));
    }
  }, [isAuthReady]);

  const refreshStats = useCallback(async () => {
    if (!currentSandbox || (currentSandbox.status !== "running" && currentSandbox.status !== "quota_exceeded")) {
      setStats(null);
      return;
    }

    try {
      setStats(await api.sandbox.stats(currentSandbox.id));
    } catch {
      setStats(null);
      // 如果 stats 获取失败（容器可能已不存在），刷新列表以同步真实状态
      if (currentSandbox?.status === "running" || currentSandbox?.status === "quota_exceeded") {
        void refresh();
      }
    }
  }, [currentSandbox, refresh]);

  const fetchLogs = useCallback(async () => {
    if (!currentSandbox?.id) return;
    try {
      setLogs(await api.sandbox.logs(currentSandbox.id));
    } catch {
      // 日志获取失败也可能是容器已停止的信号，刷新列表同步状态
      if (currentSandbox?.status === "running") {
        void refresh();
      }
    }
  }, [currentSandbox?.id, refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Reset auto-start flag once auth becomes ready.
  useEffect(() => {
    shouldAutoStartRef.current = true;
    setHasLoaded(false);
  }, [isAuthReady]);

  useEffect(() => {
    void refreshStats();
    if (!currentSandbox || (currentSandbox.status !== "running" && currentSandbox.status !== "quota_exceeded")) {
      return;
    }
    const timer = window.setInterval(() => void refreshStats(), 8000);
    return () => window.clearInterval(timer);
  }, [currentSandbox, refreshStats]);

  // Poll logs every 3s when running or quota_exceeded
  useEffect(() => {
    void fetchLogs();
    if (!currentSandbox || (currentSandbox.status !== "running" && currentSandbox.status !== "quota_exceeded")) {
      return;
    }
    const timer = window.setInterval(() => void fetchLogs(), 3000);
    return () => window.clearInterval(timer);
  }, [currentSandbox, fetchLogs]);

  const createSandbox = useCallback(async () => {
    setOperation("creating");
    setError(null);
    try {
      const sandbox = await api.sandbox.create("default");
      setSandboxes((current) => [sandbox, ...current.filter((item) => item.id !== sandbox.id)]);
      setCurrentSandbox(sandbox);
    } catch (err) {
      setError(err instanceof Error ? err.message : tg("ctx.sandbox.createFailed"));
      throw err;
    } finally {
      setOperation("idle");
    }
  }, []);

  const rebuildSandbox = useCallback(async () => {
    if (!currentSandbox) {
      return;
    }
    setOperation("rebuilding");
    setError(null);
    try {
      const sandbox = await api.sandbox.rebuild(currentSandbox.id);
      setSandboxes((current) => current.map((item) => (item.id === sandbox.id ? sandbox : item)));
      setCurrentSandbox(sandbox);
    } catch (err) {
      setError(err instanceof Error ? err.message : tg("ctx.sandbox.rebuildFailed"));
      throw err;
    } finally {
      setOperation("idle");
    }
  }, [currentSandbox]);

  const destroySandbox = useCallback(async () => {
    if (!currentSandbox) {
      return;
    }
    setOperation("destroying");
    setError(null);
    try {
      await api.sandbox.destroy(currentSandbox.id);
      const remaining = sandboxes.filter((item) => item.id !== currentSandbox.id);
      setSandboxes(remaining);
      setCurrentSandbox(selectSandbox(remaining));
      setStats(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : tg("ctx.sandbox.deleteFailed"));
      throw err;
    } finally {
      setOperation("idle");
    }
  }, [currentSandbox, sandboxes]);

  // Reload sandbox config (hot-update) - from master
  const reloadConfig = useCallback(async () => {
    if (!currentSandbox) return;
    try {
      await api.sandbox.reloadConfig(currentSandbox.id);
    } catch (err: any) {
      setError(err instanceof Error ? err.message : tg("ctx.sandbox.reloadFailed"));
    }
  }, [currentSandbox]);

  // Auto-create only when the user truly has no sandbox. Never auto-rebuild on
  // page mount: an existing container is almost always still alive — the row
  // may merely have been flipped to error by a transient Docker hiccup during
  // a previous /api/sandbox/list. If it really did die, SandboxStatus shows
  // "沙盒状态异常" + a manual Rebuild button. Creating / rebuilding are
  // transient backend states and naturally need no action.
  //
  // hasLoaded gate: on initial mount the auto-start effect fires *before* the
  // first refresh() completes (refresh's setOperation('loading') is an async
  // state update, but the effect already runs in the same batch as the
  // auth-ready change). Without this gate currentSandbox is null on first render and we
  // mistakenly call createSandbox() → force-removes the same-named live
  // container. Wait until at least one /api/sandbox/list has returned before
  // making the call.
  useEffect(() => {
    if (!isAuthReady) return;
    if (!hasLoaded) return;
    if (operation !== "idle") return;
    if (!shouldAutoStartRef.current) return;

    shouldAutoStartRef.current = false;
    if (!currentSandbox) {
      void createSandbox();
    }
  }, [isAuthReady, hasLoaded, operation, currentSandbox, createSandbox]);

  const value = useMemo(
    () => ({
      sandboxes,
      currentSandbox,
      stats,
      status:
        currentSandbox?.status ??
        (operation === "creating"
          ? "creating"
          : operation === "loading"
          ? "loading"
          : "missing"),
      operation,
      error,
      logs,
      refresh,
      refreshStats,
      createSandbox,
      rebuildSandbox,
      destroySandbox,
      reloadConfig,
    }),
    [
      sandboxes,
      currentSandbox,
      stats,
      operation,
      error,
      logs,
      refresh,
      refreshStats,
      createSandbox,
      rebuildSandbox,
      destroySandbox,
      reloadConfig,
    ],
  );

  return <SandboxContext.Provider value={value}>{children}</SandboxContext.Provider>;
}

export function useSandbox() {
  const value = useContext(SandboxContext);
  if (!value) {
    throw new Error("useSandbox must be used within SandboxProvider");
  }
  return value;
}