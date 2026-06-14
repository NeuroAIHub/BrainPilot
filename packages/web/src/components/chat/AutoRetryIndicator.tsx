import { useEffect, useMemo, useState } from "react";
import { RotateCw, X } from "lucide-react";
import type { AutoRetryView } from "../../contracts/backend";
import { autoRetryCountdownSeconds } from "../../contexts/newUiEvents";
import { useT } from "../../i18n/useT";

interface AutoRetryIndicatorProps {
  view: AutoRetryView;
  /** Abort the pending retry (wired to the interrupt / abort path). */
  onCancel: () => void;
}

/**
 * 修正6 — auto-retry countdown + cancel. Surfaces a Pi `auto_retry_start`
 * (attempt/maxAttempts/delayMs) as a countdown indicator with a Cancel button
 * that calls the interrupt/abort path.
 */
export function AutoRetryIndicator({ view, onCancel }: AutoRetryIndicatorProps) {
  const t = useT();
  const cancelled = view.cancelled === true;

  const initialSec = useMemo(() => autoRetryCountdownSeconds(view), [view]);
  const [secondsLeft, setSecondsLeft] = useState(initialSec);

  useEffect(() => {
    if (cancelled || initialSec <= 0) return;
    setSecondsLeft(initialSec);
    const id = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          window.clearInterval(id);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [cancelled, initialSec]);

  return (
    <div
      className={`auto-retry${cancelled ? " auto-retry--cancelled" : ""}`}
      role="status"
      data-testid="auto-retry"
    >
      <RotateCw size={14} className="auto-retry__icon" aria-hidden="true" />
      <div className="auto-retry__body">
        <span className="auto-retry__title">{t("chat.retry.title")}</span>
        <span className="auto-retry__attempt">
          {t("chat.retry.attempt", { attempt: view.attempt, max: view.maxAttempts })}
        </span>
        {cancelled ? (
          <span className="auto-retry__status">{t("chat.retry.cancelled")}</span>
        ) : secondsLeft > 0 ? (
          <span className="auto-retry__countdown">{t("chat.retry.countdown", { sec: secondsLeft })}</span>
        ) : null}
      </div>
      {!cancelled ? (
        <button
          type="button"
          className="auto-retry__cancel"
          onClick={onCancel}
          aria-label={t("chat.retry.cancel")}
        >
          <X size={13} aria-hidden="true" />
          {t("chat.retry.cancel")}
        </button>
      ) : null}
    </div>
  );
}
