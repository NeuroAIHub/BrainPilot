import { CheckCircle2, HelpCircle, XCircle } from "lucide-react";
import type { AskUserView } from "../../contracts/backend";
import { useT } from "../../i18n/useT";

interface AskUserCardProps {
  view: AskUserView;
}

/**
 * 修正6 / #272 — ask_user transcript record. This renders the `user_input_request`
 * in the message stream as a *record only*: the pending question (with its
 * options listed for context) while unanswered, and the resolved answer once
 * given. The interactive picker now lives in the composer takeover
 * (AskUserComposer) so there is a single place to answer — the stream card no
 * longer accepts input, which is what prevented users from ignoring it and
 * typing into the composer (hanging the session).
 */
export function AskUserCard({ view }: AskUserCardProps) {
  const t = useT();
  const status = view.status ?? (view.answer === undefined ? "pending" : "answered");
  const cancelled = status === "cancelled";
  const answered = !cancelled && view.answer !== undefined;

  if (status === "submitting") {
    return (
      <div className="ask-user ask-user--submitting" data-testid="ask-user" data-request-id={view.requestId}>
        <div className="ask-user__head">
          <HelpCircle size={15} className="ask-user__icon" aria-hidden="true" />
          <span className="ask-user__title">{view.agent}</span>
        </div>
        <p className="ask-user__question">{view.question}</p>
        <p className="ask-user__submitting">{t("chat.ask.submitting", { answer: view.answer ?? "" })}</p>
      </div>
    );
  }

  if (cancelled) {
    return (
      <div className="ask-user ask-user--cancelled" data-testid="ask-user" data-request-id={view.requestId}>
        <div className="ask-user__head">
          <XCircle size={15} className="ask-user__icon" aria-hidden="true" />
          <span className="ask-user__title">{view.agent}</span>
        </div>
        <p className="ask-user__question">{view.question}</p>
        <p className="ask-user__cancelled">
          {t(
            view.cancellationReason === "expired" || view.cancellationReason === "stale"
              ? "chat.ask.expired"
              : "chat.ask.cancelled",
          )}
        </p>
      </div>
    );
  }

  if (answered) {
    return (
      <div className="ask-user ask-user--answered" data-testid="ask-user" data-request-id={view.requestId}>
        <div className="ask-user__head">
          <CheckCircle2 size={15} className="ask-user__icon" aria-hidden="true" />
          <span className="ask-user__title">{view.agent}</span>
        </div>
        <p className="ask-user__question">{view.question}</p>
        <p className="ask-user__answer">{t("chat.ask.answered", { answer: view.answer ?? "" })}</p>
      </div>
    );
  }

  return (
    <div className="ask-user" data-testid="ask-user" data-request-id={view.requestId}>
      <div className="ask-user__head">
        <HelpCircle size={15} className="ask-user__icon" aria-hidden="true" />
        <span className="ask-user__title">{t("chat.ask.title")}</span>
        <span className="ask-user__agent">{view.agent}</span>
      </div>
      <p className="ask-user__question">{view.question}</p>

      {view.options && view.options.length > 0 ? (
        <ul className="ask-user__options ask-user__options--record">
          {view.options.map((option, index) => (
            <li key={`${view.requestId}-${index}`} className="ask-user__option-record">
              {option}
            </li>
          ))}
        </ul>
      ) : null}

      <p className="ask-user__pending">{t("chat.ask.pending")}</p>
    </div>
  );
}
