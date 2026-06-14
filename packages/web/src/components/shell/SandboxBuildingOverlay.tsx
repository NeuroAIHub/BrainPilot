import { useEffect, useState } from "react";
import type { SandboxOperation } from "../../contexts/SandboxContext";
import { useT } from "../../i18n/useT";

interface SandboxBuildingOverlayProps {
  operation: SandboxOperation;
  error: string | null;
  onDismiss: () => void;
}

function getStatusKey(operation: SandboxOperation, timedOut: boolean) {
  if (timedOut) {
    return "sandbox.overlay.timeout";
  }
  switch (operation) {
    case "creating":
      return "sandbox.overlay.creating";
    case "rebuilding":
      return "sandbox.overlay.rebuilding";
    default:
      return "sandbox.overlay.preparing";
  }
}

const TIMEOUT_MS = 30000;
const DISMISS_DELAY_MS = 2500;

export function SandboxBuildingOverlay({ operation, error, onDismiss }: SandboxBuildingOverlayProps) {
  const t = useT();
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    setTimedOut(false);
    const timeoutTimer = window.setTimeout(() => {
      setTimedOut(true);
    }, TIMEOUT_MS);
    return () => window.clearTimeout(timeoutTimer);
  }, [operation]);

  useEffect(() => {
    if (!timedOut) {
      return;
    }
    const dismissTimer = window.setTimeout(() => {
      onDismiss();
    }, DISMISS_DELAY_MS);
    return () => window.clearTimeout(dismissTimer);
  }, [timedOut, onDismiss]);

  return (
    <div
      className="sandbox-building-overlay"
      role="dialog"
      aria-live="polite"
      aria-label={t("sandbox.overlay.aria")}
    >
      <div className="sandbox-building-panel">
        {!timedOut ? (
          <div className="sandbox-building__spinner" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        ) : null}
        <h2 className="sandbox-building__title">{t("sandbox.overlay.title")}</h2>
        <p className={`sandbox-building__status ${timedOut ? "is-timeout" : ""}`}>
          {t(getStatusKey(operation, timedOut))}
        </p>
        {error ? <p className="sandbox-building__error">{error}</p> : null}
      </div>
    </div>
  );
}
