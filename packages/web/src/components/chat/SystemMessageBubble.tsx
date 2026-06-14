import { AlertTriangle, Info, OctagonAlert, XCircle } from "lucide-react";
import type { SystemMessageView } from "../../contracts/backend";
import { useT } from "../../i18n/useT";

/**
 * 修正6 — system_message bubble. Renders a `system_message` event (level
 * info|warning|error|fatal) as a 4-level styled inline bubble in the
 * conversation stream. `fatal` gets the emphasized red treatment; `details`
 * (debug) is revealed on expand.
 */
export function SystemMessageBubble({ view }: { view: SystemMessageView }) {
  const t = useT();
  const level = view.level;
  const Icon =
    level === "fatal" ? OctagonAlert :
    level === "error" ? XCircle :
    level === "warning" ? AlertTriangle :
    Info;
  const labelKey =
    level === "fatal" ? "chat.system.fatal" :
    level === "error" ? "chat.system.error" :
    level === "warning" ? "chat.system.warning" :
    "chat.system.info";

  return (
    <div
      className={`system-message system-message--${level}${level === "fatal" ? " system-message--emphasis" : ""}`}
      role={level === "error" || level === "fatal" ? "alert" : "status"}
      data-testid="system-message"
      data-level={level}
    >
      <div className="system-message__head">
        <Icon size={15} className="system-message__icon" aria-hidden="true" />
        <span className="system-message__label">{t(labelKey)}</span>
        {view.agent ? <span className="system-message__agent">{view.agent}</span> : null}
      </div>
      <p className="system-message__text">{view.message}</p>
      {view.details ? (
        <details className="system-message__details">
          <summary>{t("chat.system.details")}</summary>
          <pre>{view.details}</pre>
        </details>
      ) : null}
    </div>
  );
}
