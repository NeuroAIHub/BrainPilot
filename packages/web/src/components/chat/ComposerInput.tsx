import { useEffect, useRef } from "react";
import type { KeyboardEvent } from "react";
import { useDraft } from "../../contexts/draftStore";

interface ComposerInputProps {
  /** Active session id; drafts are isolated per session. null disables editing. */
  sessionId: string | null;
  placeholder: string;
  /** Aria label for the textarea (sr-only label uses the same text). */
  ariaLabel: string;
}

/**
 * Isolated textarea bound to draftStore[sessionId].
 *
 * Splitting this out of PromptComposer is the whole point of the input-lag
 * fix: keystrokes used to re-render the whole chat subtree because draft state
 * lived on SessionContext. Now keystrokes only re-render this component (and
 * its sibling ComposerSendButton, which also subscribes to the same store).
 *
 * Form submission is owned by the enclosing <form> in PromptComposer; this
 * component just handles Enter-to-submit by walking up to the form.
 */
export function ComposerInput({ sessionId, placeholder, ariaLabel }: ComposerInputProps) {
  const [draft, setDraft] = useDraft(sessionId);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Grow textarea to fit content. Reading scrollHeight forces a layout — fine
  // here because only this component re-renders on draft change.
  const autoResize = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  };

  // Resize on draft change (covers store-driven updates: slash menu /
  // suggestions / switching sessions) and initial mount with a pre-existing
  // draft (e.g. user typed, switched tabs, switched back).
  useEffect(() => {
    autoResize();
  }, [draft]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Shift+Enter inserts a newline; bare Enter submits. Skip while IME is
    // composing so CJK candidate selection doesn't fire submit.
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  };

  return (
    <>
      <label className="sr-only" htmlFor="prompt-input">
        {ariaLabel}
      </label>
      <textarea
        ref={textareaRef}
        id="prompt-input"
        rows={1}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          autoResize();
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
      />
    </>
  );
}
