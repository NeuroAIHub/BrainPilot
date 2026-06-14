import { useEffect, useRef, useState } from "react";
import { useSandbox } from "../../contexts/SandboxContext";
import { useSessions } from "../../contexts/SessionContext";
import { useT } from "../../i18n/useT";
import { api } from "../../utils/api";

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
        <div className="sandbox-status__header">
          <span className="sandbox-status__eyebrow">Sandbox</span>
          <strong>{t(connectionLabelKey[connection])}</strong>
        </div>

        <p className={`sandbox-status__notice ${isLoading ? "is-loading" : ""}`}>
          {(() => {
            const notice = getStatusKey(effectiveStatus, isConnected);
            return t(notice.key, notice.vars);
          })()}
        </p>
        {error ? <p className="sandbox-status__empty">{error}</p> : null}

        {hasSandbox ? (
          <>
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
                <dt>{t("sandbox.label.created")}</dt>
                <dd>{new Date(currentSandbox.createdAt).toLocaleString()}</dd>
              </div>
            </dl>

            <div className="sandbox-status__metrics">
              <div>
                <span>{t("sandbox.label.memory")}</span>
                <strong>
                  {formatBytes(stats?.memory.usedBytes)} / {formatBytes(stats?.memory.limitBytes)}
                </strong>
                <small>{stats?.memory.percent ?? 0}%</small>
              </div>
              <div>
                <span>{t("sandbox.label.cpu")}</span>
                <strong>{t("sandbox.cpuUsed", { percent: stats?.cpu.usedPercent ?? 0 })}</strong>
                <small>
                  {t("sandbox.cpuQuota", { quota: stats?.cpu.quotaPercent ?? 0, cpus: stats?.cpu.onlineCpus ?? 0 })}
                </small>
              </div>
              <div>
                <span>{t("sandbox.label.pids")}</span>
                <strong>
                  {stats?.pids.current ?? 0} / {stats?.pids.limit ?? t("sandbox.unlimited")}
                </strong>
              </div>
              <div>
                <span>{t("sandbox.label.disk")}</span>
                <strong>
                  {formatBytes(stats?.disk.workspaceUsedBytes)} / {formatBytes(stats?.disk.quotaBytes)}
                </strong>
                <small>{stats?.disk.percentOfQuota ?? 0}%</small>
              </div>
            </div>

            <div className="sandbox-status__health">
              <div>
                <span>{t("sandbox.label.health")}</span>
                <strong>{String(health?.status ?? (detailsLoading ? t("sandbox.health.checking") : t("sandbox.health.unknown")))}</strong>
              </div>
              <div>
                <span>{t("sandbox.label.runtime")}</span>
                <strong>{health?.agent_runtime === false ? t("sandbox.health.offline") : health?.agent_runtime ? t("sandbox.health.online") : "-"}</strong>
              </div>
              <div>
                <span>{t("sandbox.label.sse")}</span>
                <strong>{isConnected ? t("sandbox.health.connected") : t("sandbox.health.offline")}</strong>
              </div>
              <div>
                <span>{t("sandbox.label.checked")}</span>
                <strong>{health?.checked_at ? new Date(String(health.checked_at)).toLocaleTimeString() : "-"}</strong>
              </div>
            </div>

            <pre className="sandbox-status__logs">{detailsLoading ? t("sandbox.logs.loading") : logs || t("sandbox.logs.empty")}</pre>
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
              <button disabled={detailsLoading} onClick={() => void loadDetails()} type="button">
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
