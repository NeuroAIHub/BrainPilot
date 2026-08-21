import { useEffect, useId, useMemo, useRef, useState } from "react";
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

export type AskUserInteractionAction =
  | { kind: "none" }
  | { kind: "select"; index: number }
  | { kind: "submit" };

/** Pure interaction model shared by pointer/keyboard handlers and tests. */
export function resolveAskUserOptionClick(index: number, optionCount: number): AskUserInteractionAction {
  return index >= 0 && index < optionCount
    ? { kind: "select", index }
    : { kind: "none" };
}

export function resolveAskUserKeyAction(input: {
  key: string;
  active: number;
  rowCount: number;
  optionCount: number;
  freeTextActive: boolean;
}): AskUserInteractionAction {
  if (input.key === "ArrowDown") {
    return input.rowCount > 0
      ? { kind: "select", index: (input.active + 1) % input.rowCount }
      : { kind: "none" };
  }
  if (input.key === "ArrowUp") {
    return input.rowCount > 0
      ? { kind: "select", index: (input.active - 1 + input.rowCount) % input.rowCount }
      : { kind: "none" };
  }
  if (/^[1-9]$/.test(input.key) && !input.freeTextActive) {
    const index = Number(input.key) - 1;
    return index < input.optionCount
      ? { kind: "select", index }
      : { kind: "none" };
  }
  return input.key === "Enter" ? { kind: "submit" } : { kind: "none" };
}

/**
 * #272 — ask_user composer takeover. While a `user_input_request` is pending,
 * this replaces the normal composer with a Codex-style option picker so a user
 * can't just type an ordinary message into the composer and hang the session.
 *
 * There is NO escape hatch: the user must pick an option or type a free-text
 * answer — the picker cannot be dismissed without answering. When the tool
 * allows free text, a "write your own" row is offered after the options.
 *
 * Keyboard: ↑/↓ and number keys (1..9) change the selection; Enter explicitly
 * confirms the selected option (or the free-text value when its row is active).
 */
export function AskUserComposer({ view, onSubmit }: AskUserComposerProps) {
  const t = useT();
  const options = useMemo(() => view.options ?? [], [view.options]);
  const allowFreeText = view.allowFreeText !== false;
  const freeTextIndex = allowFreeText ? options.length : -1;
  const rowCount = options.length + (allowFreeText ? 1 : 0);

  const [active, setActive] = useState(0);
  const [freeText, setFreeText] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listboxId = useId();
  const questionId = `${listboxId}-question`;
  const hintId = `${listboxId}-hint`;

  // A fresh request resets the picker state and grabs focus so keyboard nav
  // works immediately without a click.
  useEffect(() => {
    setActive(0);
    setFreeText("");
    if (options.length === 0 && allowFreeText) inputRef.current?.focus();
    else rootRef.current?.focus();
  }, [view.requestId, options.length, allowFreeText]);

  const submit = (answer: string) => {
    const resolved = resolveAskUserSubmission(view, answer);
    if (!resolved) return;
    onSubmit(resolved.requestId, resolved.answer);
  };

  const submitActive = () => {
    if (allowFreeText && active === freeTextIndex) {
      submit(freeText);
      return;
    }
    const option = options[active];
    if (option !== undefined) submit(option);
  };

  const focusRow = (index: number) => {
    setActive(index);
    if (allowFreeText && index === freeTextIndex) {
      inputRef.current?.focus();
    } else {
      rootRef.current?.focus();
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const action = resolveAskUserKeyAction({
      key: e.key,
      active,
      rowCount,
      optionCount: options.length,
      freeTextActive: allowFreeText && active === freeTextIndex,
    });
    if (action.kind === "none") return;
    e.preventDefault();
    if (action.kind === "select") focusRow(action.index);
    else submitActive();
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
      aria-labelledby={questionId}
      aria-describedby={hintId}
      aria-activedescendant={rowCount > 0 ? `${listboxId}-option-${active}` : undefined}
    >
      <div className="ask-user-composer__head">
        <HelpCircle size={15} className="ask-user-composer__icon" aria-hidden="true" />
        <span className="ask-user-composer__question" id={questionId}>{view.question}</span>
      </div>

      <div className="ask-user-composer__options">
        {options.map((option, idx) => (
          <button
            key={`${view.requestId}-${idx}`}
            id={`${listboxId}-option-${idx}`}
            type="button"
            role="option"
            aria-selected={active === idx}
            className={`ask-user-composer__option ${active === idx ? "is-active" : ""}`}
            onFocus={() => setActive(idx)}
            onClick={() => {
              const action = resolveAskUserOptionClick(idx, options.length);
              if (action.kind === "select") setActive(action.index);
            }}
          >
            <span className="ask-user-composer__num">{idx + 1}</span>
            <span className="ask-user-composer__label">{option}</span>
          </button>
        ))}

        {allowFreeText ? (
          <div
            className={`ask-user-composer__option ask-user-composer__option--free ${
              active === freeTextIndex ? "is-active" : ""
            }`}
            id={`${listboxId}-option-${freeTextIndex}`}
            role="option"
            aria-selected={active === freeTextIndex}
          >
            <span className="ask-user-composer__num">✎</span>
            <input
              ref={inputRef}
              className="ask-user-composer__input"
              type="text"
              value={freeText}
              placeholder={options.length > 0 ? t("chat.ask.freeTextOption") : t("chat.ask.freeTextPlaceholder")}
              aria-label={view.question}
              aria-describedby={hintId}
              onFocus={() => setActive(freeTextIndex)}
              onChange={(e) => setFreeText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.stopPropagation();
                  submit(freeText);
                }
              }}
            />
          </div>
        ) : null}
      </div>

      <div className="ask-user-composer__foot">
        <span className="ask-user-composer__hint" id={hintId}>{t("chat.ask.pickHint")}</span>
        <button
          type="button"
          className="ask-user-composer__submit"
          aria-describedby={hintId}
          disabled={rowCount === 0 || (allowFreeText && active === freeTextIndex && !canSubmitFree)}
          onClick={submitActive}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <span>{t("chat.ask.submit")}</span>
          <CornerDownLeft size={13} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
