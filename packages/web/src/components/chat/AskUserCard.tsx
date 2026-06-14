import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, HelpCircle } from "lucide-react";
import type { AskUserView } from "../../contracts/backend";
import { resolveAskUserSubmission } from "../../contexts/newUiEvents";
import { useT } from "../../i18n/useT";

interface AskUserCardProps {
  view: AskUserView;
  /** Submit the chosen/typed answer back through the send path. */
  onSubmit: (requestId: string, answer: string) => void;
}

/**
 * 修正6 — ask_user interaction card. Renders a `user_input_request` as an
 * interactive card: option buttons and/or a free-text input. On submit it
 * fires `onSubmit(requestId, answer)` so the host can post a
 * user_input_response. Supports an optional countdown when `timeoutSec` is set.
 */
export function AskUserCard({ view, onSubmit }: AskUserCardProps) {
  const t = useT();
  const [freeText, setFreeText] = useState("");
  const answered = view.answer !== undefined;

  // Optional countdown. Only ticks while unanswered and a timeout is given.
  const initialSec = useMemo(
    () => (typeof view.timeoutSec === "number" && view.timeoutSec > 0 ? Math.floor(view.timeoutSec) : null),
    [view.timeoutSec],
  );
  const [secondsLeft, setSecondsLeft] = useState<number | null>(initialSec);

  useEffect(() => {
    if (answered || initialSec === null) return;
    setSecondsLeft(initialSec);
    const id = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev === null) return prev;
        if (prev <= 1) {
          window.clearInterval(id);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [answered, initialSec]);

  const timedOut = secondsLeft === 0;
  const disabled = answered || timedOut;

  const submit = (answer: string) => {
    const resolved = resolveAskUserSubmission(view, answer, { answered, timedOut });
    if (!resolved) return;
    onSubmit(resolved.requestId, resolved.answer);
  };

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
        {secondsLeft !== null ? (
          <span className="ask-user__timer">
            {timedOut ? t("chat.ask.timedOut") : t("chat.ask.timeoutLeft", { sec: secondsLeft })}
          </span>
        ) : null}
      </div>
      <p className="ask-user__question">{view.question}</p>

      {view.options && view.options.length > 0 ? (
        <div className="ask-user__options">
          {view.options.map((option) => (
            <button
              key={option}
              type="button"
              className="ask-user__option"
              disabled={disabled}
              onClick={() => submit(option)}
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}

      {view.allowFreeText || !view.options || view.options.length === 0 ? (
        <form
          className="ask-user__free"
          onSubmit={(e) => {
            e.preventDefault();
            submit(freeText);
          }}
        >
          <input
            className="ask-user__input"
            type="text"
            value={freeText}
            disabled={disabled}
            placeholder={t("chat.ask.freeTextPlaceholder")}
            onChange={(e) => setFreeText(e.target.value)}
            aria-label={view.question}
          />
          <button type="submit" className="ask-user__submit" disabled={disabled || freeText.trim() === ""}>
            {t("chat.ask.submit")}
          </button>
        </form>
      ) : null}
    </div>
  );
}
