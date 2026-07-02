import { useEffect, useRef, useState } from "react";
import { Radio, Server } from "lucide-react";
import { useSandbox } from "../../contexts/SandboxContext";
import { useSessions } from "../../contexts/SessionContext";
import { useT } from "../../i18n/useT";
import { api } from "../../utils/api";
import { runtimeConfig } from "../../config";

type SandboxConnectionState = "disconnected" | "connected" | "connecting" | "creating";

const connectionLabelKey: Record<SandboxConnectionState, string> = {
  disconnected: "sandbox.conn.disconnected",
  connected: "sandbox.conn.connected",
  connecting: "sandbox.conn.connecting",
  creating: "sandbox.conn.creating",
};

function formatBytes(bytes?: number) {
  if (!bytes) {
    return "-";
  }
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

/** Clamp a percentage into [0, 100] and pick a severity band for the meter fill. */
function meterLevel(percent?: number): { pct: number; level: "ok" | "warning" | "critical" } {
  const pct = Math.max(0, Math.min(100, Math.round(percent ?? 0)));
  const level = pct >= 90 ? "critical" : pct >= 75 ? "warning" : "ok";
  return { pct, level };
}

function getConnectionState(status: string, isConnected: boolean): SandboxConnectionState {
  if (status === "running" && isConnected) {
    return "connected";
  }
  if (status === "running" && !isConnected) {
    return "connecting";
  }
  if (status === "creating" || status === "rebuilding") {
    return "creating";
  }
  if (status === "loading") {
    return "connecting";
  }
  return "disconnected";
}

function getStatusKey(status: string, isConnected: boolean) {
  switch (status) {
    case "creating":
      return { key: "sandbox.status.creating" };
    case "rebuilding":
      return { key: "sandbox.status.rebuilding" };
    case "destroying":
      return { key: "sandbox.status.destroying" };
    case "missing":
      return { key: "sandbox.status.missing" };
    case "quota_exceeded":
      return { key: "sandbox.status.quotaExceeded" };
    case "error":
      return { key: "sandbox.status.error" };
    case "running":
      return { key: isConnected ? "sandbox.status.running" : "sandbox.status.runningDisconnected" };
    default:
      return { key: "sandbox.status.fallback", vars: { status } };
  }
}

export function SandboxStatus() {
  const [isOpen, setIsOpen] = useState(false);
  const [logs, setLogs] = useState("");
  const [showLogs, setShowLogs] = useState(false);
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const {
    currentSandbox,
    stats,
    status,
    operation,
    error,
    createSandbox,
    rebuildSandbox,
    destroySandbox,
    refresh,
  } = useSandbox();
  const { isConnected } = useSessions();
  const t = useT();
  const effectiveStatus = operation === "idle" ? status : operation;
  const connection = getConnectionState(effectiveStatus, isConnected);
  const isLoading = operation !== "idle" && operation !== "loading";
  const hasSandbox = !!currentSandbox;

  const loadDetails = async () => {
    if (!currentSandbox) {
      return;
    }
    // Local single-user mode has no container logs/health endpoints — the
    // runtime IS the sandbox. Skip the detail fetch (would hit nonexistent
    // /api/sandbox/* routes and fall through to the SPA HTML fallback).
    if (runtimeConfig.localMode) {
      return;
    }
    setDetailsLoading(true);
    try {
      const [nextLogs, nextHealth] = await Promise.all([
        api.sandbox.logs(currentSandbox.id, 80),
        api.sandbox.health(currentSandbox.id),
      ]);
      setLogs(nextLogs);
      setHealth(nextHealth);
    } catch (detailError) {
      setLogs(detailError instanceof Error ? detailError.message : t("sandbox.logs.failed"));
      setHealth({ status: "error" });
    } finally {
      setDetailsLoading(false);
    }
  };

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current || rootRef.current.contains(event.target as Node)) {
        return;
      }
      setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!isOpen || !currentSandbox) {
      return;
    }
    void loadDetails();
  }, [currentSandbox?.id, isOpen]);

  return (
    <div className="sandbox-status" ref={rootRef}>
      <button
        aria-controls="sandbox-status-popover"
        aria-expanded={isOpen}
        className={`sandbox-status__trigger sandbox-status__trigger--${connection}`}
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        <span className="sandbox-status__dot" aria-hidden="true" />
        <span>Sandbox</span>
      </button>

      <div
        aria-label={t("sandbox.aria.status")}
        className={`sandbox-status__popover ${isOpen ? "is-open" : ""}`}
        id="sandbox-status-popover"
        role="dialog"
      >
        <div className={`sandbox-status__hero sandbox-status__hero--${connection}`}>
          <span className="sandbox-status__hero-dot" aria-hidden="true" />
          <div className="sandbox-status__hero-text">
            <strong>{t(connectionLabelKey[connection])}</strong>
            <span className={isLoading ? "is-loading" : ""}>
              {(() => {
                const notice = getStatusKey(effectiveStatus, isConnected);
                return t(notice.key, notice.vars);
              })()}
            </span>
          </div>
        </div>
        {error ? <p className="sandbox-status__empty">{error}</p> : null}

        {hasSandbox ? (
          <>
            <div className="sandbox-status__meters">
              {(() => {
                const rows: Array<{ label: string; percent?: number; detail: string }> = [
                  {
                    label: t("sandbox.label.memory"),
                    percent: stats?.memory.percent,
                    detail: `${formatBytes(stats?.memory.usedBytes)} / ${formatBytes(stats?.memory.limitBytes)}`,
                  },
                  {
                    label: t("sandbox.label.disk"),
                    percent: stats?.disk.percentOfQuota,
                    detail: `${formatBytes(stats?.disk.workspaceUsedBytes)} / ${formatBytes(stats?.disk.quotaBytes)}`,
                  },
                  {
                    label: t("sandbox.label.cpu"),
                    percent: stats?.cpu.usedPercent,
                    detail: t("sandbox.cpuQuota", { quota: stats?.cpu.quotaPercent ?? 0, cpus: stats?.cpu.onlineCpus ?? 0 }),
                  },
                ];
                return rows.map((row) => {
                  const { pct, level } = meterLevel(row.percent);
                  return (
                    <div className="sandbox-meter" key={row.label}>
                      <div className="sandbox-meter__head">
                        <span>{row.label}</span>
                        <strong>{pct}%</strong>
                      </div>
                      <div className="sandbox-meter__track" aria-hidden="true">
                        <span className={`sandbox-meter__fill sandbox-meter__fill--${level}`} style={{ width: `${pct}%` }} />
                      </div>
                      <small>{row.detail}</small>
                    </div>
                  );
                });
              })()}
            </div>

            <div className="sandbox-status__chips">
              {(() => {
                const runtimeOnline = health?.agent_runtime !== false && !!health?.agent_runtime;
                const runtimeKnown = health?.agent_runtime !== undefined;
                return (
                  <span className={`sandbox-chip sandbox-chip--${runtimeKnown ? (runtimeOnline ? "ok" : "off") : "unknown"}`}>
                    <Server size={13} />
                    {t("sandbox.label.runtime")}
                    <i className="sandbox-chip__dot" aria-hidden="true" />
                  </span>
                );
              })()}
              <span className={`sandbox-chip sandbox-chip--${isConnected ? "ok" : "off"}`}>
                <Radio size={13} />
                {t("sandbox.label.sse")}
                <i className="sandbox-chip__dot" aria-hidden="true" />
              </span>
            </div>

            <details className="sandbox-status__details">
              <summary>{t("sandbox.details.more")}</summary>
              <dl className="sandbox-status__grid">
                <div>
                  <dt>{t("sandbox.label.name")}</dt>
                  <dd>{currentSandbox.name}</dd>
                </div>
                <div>
                  <dt>{t("sandbox.label.id")}</dt>
                  <dd>{currentSandbox.id}</dd>
                </div>
                <div>
                  <dt>{t("sandbox.label.container")}</dt>
                  <dd>{currentSandbox.containerName || "-"}</dd>
                </div>
                <div>
                  <dt>{t("sandbox.label.hostApi")}</dt>
                  <dd>{currentSandbox.hostApiUrl || "-"}</dd>
                </div>
                <div>
                  <dt>{t("sandbox.label.port")}</dt>
                  <dd>{currentSandbox.port ?? "-"}</dd>
                </div>
                <div>
                  <dt>{t("sandbox.label.pids")}</dt>
                  <dd>{stats?.pids.current ?? 0} / {stats?.pids.limit ?? t("sandbox.unlimited")}</dd>
                </div>
                <div>
                  <dt>{t("sandbox.label.created")}</dt>
                  <dd>{new Date(currentSandbox.createdAt).toLocaleString()}</dd>
                </div>
                <div>
                  <dt>{t("sandbox.label.checked")}</dt>
                  <dd>{health?.checked_at ? new Date(String(health.checked_at)).toLocaleTimeString() : "-"}</dd>
                </div>
              </dl>
            </details>

            {showLogs ? (
              <pre className="sandbox-status__logs">{detailsLoading ? t("sandbox.logs.loading") : logs || t("sandbox.logs.empty")}</pre>
            ) : null}
          </>
        ) : (
          <p className="sandbox-status__empty">{t("sandbox.empty")}</p>
        )}

        <div className="sandbox-status__actions">
          {hasSandbox ? (
            <>
              <button disabled={isLoading} onClick={() => void rebuildSandbox()} type="button">
                {t("sandbox.action.rebuild")}
              </button>
              <button disabled={isLoading} onClick={() => void refresh()} type="button">
                {t("sandbox.action.refresh")}
              </button>
              <button
                aria-pressed={showLogs}
                className={showLogs ? "is-active" : ""}
                disabled={detailsLoading}
                onClick={() => {
                  setShowLogs((current) => {
                    const next = !current;
                    if (next) {
                      void loadDetails();
                    }
                    return next;
                  });
                }}
                type="button"
              >
                {t("sandbox.action.logs")}
              </button>
              <button
                className="sandbox-status__danger-action"
                disabled={isLoading}
                onClick={() => void destroySandbox()}
                type="button"
              >
                {t("sandbox.action.delete")}
              </button>
            </>
          ) : (
            <button disabled={isLoading} onClick={() => void createSandbox()} type="button">
              {t("sandbox.action.build")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
