import { AlertTriangle } from "lucide-react";
import { QuotaFileManager } from "./QuotaFileManager";
import { formatBytes } from "../../utils/format";
import { useT } from "../../i18n/useT";

type DiskQuotaCriticalDialogProps = {
  isOpen: boolean;
  sandboxId: string | null;
  workspaceUsedBytes: number;
  quotaBytes: number;
  percentOfQuota: number;
};

export function DiskQuotaCriticalDialog({
  isOpen,
  sandboxId,
  workspaceUsedBytes,
  quotaBytes,
  percentOfQuota,
}: DiskQuotaCriticalDialogProps) {
  const t = useT();
  if (!isOpen) return null;

  return (
    <div className="quota-critical-modal" role="presentation">
      <section
        className="quota-critical-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quota-critical-title"
      >
        <div className="quota-critical-dialog__header">
          <h2 id="quota-critical-title">
            <AlertTriangle size={16} style={{ marginRight: 8, verticalAlign: "-2px" }} />
            {t("quota.critical.title")}
          </h2>
        </div>
        <div className="quota-critical-dialog__body">
          {sandboxId ? (
            <QuotaFileManager sandboxId={sandboxId} />
          ) : (
            <p className="file-sidebar__empty">{t("quota.critical.unavailable")}</p>
          )}
        </div>
        <div className="quota-critical-dialog__footer">
          <span>
            {t("quota.critical.used", { used: formatBytes(workspaceUsedBytes), limit: formatBytes(quotaBytes) })}
          </span>
          <span style={{ color: "var(--color-danger)", fontWeight: 600 }}>
            {percentOfQuota.toFixed(0)}%
          </span>
        </div>
      </section>
    </div>
  );
}
