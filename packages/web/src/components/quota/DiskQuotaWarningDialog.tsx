import { useEffect } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useT } from "../../i18n/useT";
import { IconButton } from "../primitives/IconButton";

type DiskQuotaWarningDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  percentOfQuota: number;
};

export function DiskQuotaWarningDialog({ isOpen, onClose, percentOfQuota }: DiskQuotaWarningDialogProps) {
  const t = useT();
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="quota-warning-modal"
      onClick={onClose}
      role="presentation"
    >
      <section
        className="quota-warning-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="quota-warning-title"
      >
        <div className="quota-warning-dialog__header">
          <h2 id="quota-warning-title">
            <AlertTriangle size={16} style={{ marginRight: 8, verticalAlign: "-2px", color: "var(--color-warning)" }} />
            {t("quota.warning.title")}
          </h2>
          <IconButton label={t("quota.warning.close")} onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        <div className="quota-warning-dialog__body">
          <p>
            {t("quota.warning.bodyPrefix")}<strong>{percentOfQuota.toFixed(0)}%</strong>{t("quota.warning.bodySuffix")}
          </p>
          <p style={{ marginTop: 8 }}>
            {t("quota.warning.body2")}
          </p>
        </div>
        <div className="quota-warning-dialog__actions">
          <button onClick={onClose} type="button">
            {t("quota.warning.ack")}
          </button>
        </div>
      </section>
    </div>
  );
}
