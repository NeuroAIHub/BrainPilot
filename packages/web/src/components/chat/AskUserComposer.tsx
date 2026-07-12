import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { HelpCircle, CornerDownLeft } from "lucide-react";
import type { AskUserView } from "../../contracts/backend";
import { resolveAskUserSubmission } from "../../contexts/newUiEvents";
import { useT } from "../../i18n/useT";

interface AskUserComposerProps {
  view: AskUserView;
  /** Submit the chosen/typed answer back through the send path. */
  onSubmit: (requestId: string, answer: string) => void;
}

/**
 * #272 — ask_user composer takeover. While a `user_input_request` is pending,
 * this replaces the normal composer with a Codex-style option picker so a user
 * can't just type an ordinary message into the composer and hang the session.
 *
 * There is NO escape hatch: the user must pick an option or type a free-text
 * answer — the picker cannot be dismissed without answering. A free-text row
 * ("write your own") is ALWAYS offered as the last row, so any answer is
 * expressible without leaving the picker.
 *
 * Keyboard: ↑/↓ move the highlight, number keys (1..9) jump to an option,
 * Enter submits the highlight (or the free-text value when the free-text row is
 * active).
 */
export function AskUserComposer({ view, onSubmit }: AskUserComposerProps) {
  const t = useT();
  const options = useMemo(() => view.options ?? [], [view.options]);
  // #272 (Codex-style): always offer an inline free-text row as the last row,
  // so "write your own answer" lives right under the options instead of forcing
  // the user to ESC back to the composer. It's the last selectable index.
  const freeTextIndex = options.length;
  const rowCount = options.length + 1;

  const [active, setActive] = useState(0);
  const [freeText, setFreeText] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // A fresh request resets the picker state and grabs focus so keyboard nav
  // works immediately without a click.
  useEffect(() => {
    setActive(0);
    setFreeText("");
    rootRef.current?.focus();
  }, [view.requestId]);

  const submit = (answer: string) => {
    const resolved = resolveAskUserSubmission(view, answer);
    if (!resolved) return;
    onSubmit(resolved.requestId, resolved.answer);
  };

  const submitActive = () => {
    if (active === freeTextIndex) {
      submit(freeText);
      return;
    }
    const option = options[active];
    if (option !== undefined) submit(option);
  };

  const focusRow = (index: number) => {
    setActive(index);
    if (index === freeTextIndex) {
      inputRef.current?.focus();
    } else {
      rootRef.current?.focus();
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusRow(rowCount === 0 ? 0 : (active + 1) % rowCount);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      focusRow(rowCount === 0 ? 0 : (active - 1 + rowCount) % rowCount);
      return;
    }
    // Number keys jump directly to an option (1-indexed). Ignored while typing
    // in the free-text input (handled by its own onKeyDown below).
    if (/^[1-9]$/.test(e.key) && active !== freeTextIndex) {
      const idx = Number(e.key) - 1;
      if (idx < options.length) {
        e.preventDefault();
        setActive(idx);
        submit(options[idx]);
      }
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      submitActive();
    }
  };

  const canSubmitFree = freeText.trim() !== "";

  return (
    <div
      className="ask-user-composer"
      data-testid="ask-user-composer"
      data-request-id={view.requestId}
      tabIndex={-1}
      ref={rootRef}
      onKeyDown={handleKeyDown}
      role="listbox"
      aria-label={view.question}
    >
      <div className="ask-user-composer__head">
        <HelpCircle size={15} className="ask-user-composer__icon" aria-hidden="true" />
        <span className="ask-user-composer__question">{view.question}</span>
      </div>

      <div className="ask-user-composer__options">
        {options.map((option, idx) => (
          <button
            key={option}
            type="button"
            role="option"
            aria-selected={active === idx}
            className={`ask-user-composer__option ${active === idx ? "is-active" : ""}`}
            onMouseEnter={() => setActive(idx)}
            onClick={() => submit(option)}
          >
            <span className="ask-user-composer__num">{idx + 1}</span>
            <span className="ask-user-composer__label">{option}</span>
          </button>
        ))}

        <div
          className={`ask-user-composer__option ask-user-composer__option--free ${
            active === freeTextIndex ? "is-active" : ""
          }`}
          role="option"
          aria-selected={active === freeTextIndex}
          onMouseEnter={() => setActive(freeTextIndex)}
        >
          <span className="ask-user-composer__num">✎</span>
          <input
            ref={inputRef}
            className="ask-user-composer__input"
            type="text"
            value={freeText}
            placeholder={options.length > 0 ? t("chat.ask.freeTextOption") : t("chat.ask.freeTextPlaceholder")}
            aria-label={view.question}
            onFocus={() => setActive(freeTextIndex)}
            onChange={(e) => setFreeText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit(freeText);
              }
            }}
          />
        </div>
      </div>

      <div className="ask-user-composer__foot">
        <span className="ask-user-composer__hint">{t("chat.ask.pickHint")}</span>
        <button
          type="button"
          className="ask-user-composer__submit"
          disabled={active === freeTextIndex && !canSubmitFree}
          onClick={submitActive}
        >
          <span>{t("chat.ask.submit")}</span>
          <CornerDownLeft size={13} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
