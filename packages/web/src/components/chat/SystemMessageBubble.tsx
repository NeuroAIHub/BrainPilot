import { AlertTriangle, Info, OctagonAlert, Pencil, RefreshCw, Settings2, SlidersHorizontal, XCircle } from "lucide-react";
import type { SystemMessageView } from "../../contracts/backend";
import { classifyProviderFailure, providerFailureMessageKey } from "../../contexts/errorRecovery";
import { useT } from "../../i18n/useT";
import { workspaceRestorePresentation } from "./workspaceRestorePresentation";

export interface SystemMessageRecoveryProps {
  failedPrompt?: string;
  busy?: boolean;
  onRetry?: (prompt: string) => void;
  onEdit?: (prompt: string) => void;
  onChangeModel?: (prompt?: string) => void;
  onOpenProviderSettings?: () => void;
}

/**
 * 修正6 — system_message bubble. Renders a `system_message` event (level
 * info|warning|error|fatal) as a 4-level styled inline bubble in the
 * conversation stream. `fatal` gets the emphasized red treatment; `details`
 * (debug) is revealed on expand.
 */
export function SystemMessageBubble({
  view,
  failedPrompt,
  busy = false,
  onRetry,
  onEdit,
  onChangeModel,
  onOpenProviderSettings,
}: { view: SystemMessageView } & SystemMessageRecoveryProps) {
  const t = useT();
  const level = view.level;
  const restorePresentation = workspaceRestorePresentation(view, t);
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
  const category = view.terminal ? classifyProviderFailure(view) : null;
  const message = category
    ? t(providerFailureMessageKey(category))
    : restorePresentation?.message ?? view.message;
  const details = view.details ?? (category ? view.message : undefined);
  const canRetry = Boolean(
    category
    && view.recoverable
    && category !== "auth"
    && category !== "model"
    && failedPrompt
    && onRetry,
  );
  const canEdit = Boolean(category && failedPrompt && onEdit);
  const canChangeModel = category === "model" && Boolean(onChangeModel);
  const canOpenSettings = category === "auth" && Boolean(onOpenProviderSettings);

  return (
    <div
      className={`system-message system-message--${level}${level === "fatal" ? " system-message--emphasis" : ""}`}
      role={level === "error" || level === "fatal" ? "alert" : "status"}
      data-testid="system-message"
      data-level={level}
    >
      <div className="system-message__head">
        <Icon size={15} className="system-message__icon" aria-hidden="true" />
        <span className="system-message__label">{restorePresentation?.title ?? t(labelKey)}</span>
        {view.agent ? <span className="system-message__agent">{view.agent}</span> : null}
      </div>
      <p className="system-message__text">{message}</p>
      {category ? (
        <div className="system-message__actions" aria-label={t("chat.errorRecovery.actions")}>
          {canRetry ? (
            <button disabled={busy} onClick={() => onRetry?.(failedPrompt!)} type="button">
              <RefreshCw aria-hidden="true" size={13} />
              <span>{t("chat.errorRecovery.retry")}</span>
            </button>
          ) : null}
          {canEdit ? (
            <button disabled={busy} onClick={() => onEdit?.(failedPrompt!)} type="button">
              <Pencil aria-hidden="true" size={13} />
              <span>{t("chat.errorRecovery.edit")}</span>
            </button>
          ) : null}
          {canChangeModel ? (
            <button disabled={busy} onClick={() => onChangeModel?.(failedPrompt)} type="button">
              <SlidersHorizontal aria-hidden="true" size={13} />
              <span>{t("chat.errorRecovery.changeModel")}</span>
            </button>
          ) : null}
          {canOpenSettings ? (
            <button disabled={busy} onClick={onOpenProviderSettings} type="button">
              <Settings2 aria-hidden="true" size={13} />
              <span>{t("chat.errorRecovery.providerSettings")}</span>
            </button>
          ) : null}
        </div>
      ) : null}
      {details ? (
        <details className="system-message__details">
          <summary>{t("chat.system.details")}</summary>
          <pre>{details}</pre>
        </details>
      ) : null}
    </div>
  );
}
