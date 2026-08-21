import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ChangeEvent, ClipboardEvent, SyntheticEvent } from "react";
import { useDraft } from "../../contexts/draftStore";
import { useT } from "../../i18n/useT";
import { MentionPicker } from "./MentionPicker";
import { offerClipboardImages } from "./clipboardImages";
import {
  applyMention,
  buildMentionItems,
  detectMention,
  firstSelectableIndex,
  moveActiveIndex,
  type MentionFile,
  type MentionPlugin,
  type MentionQuery,
  type SourceStatus,
} from "./mentionLogic";

export type MentionSources = {
  plugins: SourceStatus<MentionPlugin>;
  files: SourceStatus<MentionFile>;
};

interface ComposerInputProps {
  /** Active session id; drafts are isolated per session. null disables editing. */
  sessionId: string | null;
  placeholder: string;
  /** Aria label for the textarea (sr-only label uses the same text). */
  ariaLabel: string;
  /** MCP + file sources for `@` mentions (#316). Optional for standalone use. */
  mentionSources?: MentionSources;
  /** Receives image files physically present in a paste event. */
  onPasteImages?: (files: File[]) => boolean;
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
 *
 * #316: also owns `@` mention detection, the candidate list, and keyboard nav
 * so PromptComposer never re-renders on each keystroke of an open menu.
 */
export function ComposerInput({
  sessionId,
  placeholder,
  ariaLabel,
  mentionSources,
  onPasteImages,
}: ComposerInputProps) {
  const t = useT();
  const [draft, setDraft] = useDraft(sessionId);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const listboxId = useId();

  const [mention, setMention] = useState<MentionQuery | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  // Keep menu open across blur only when the user is clicking a menu item.
  const suppressBlurCloseRef = useRef(false);

  const mentionLabels = useMemo(
    () => ({
      loading: t("chat.mention.loading"),
      empty: t("chat.mention.empty"),
      mcpEmpty: t("chat.mention.mcp.empty"),
      mcpError: t("chat.mention.mcp.error"),
      filesNeedSandbox: t("chat.mention.files.needSandbox"),
      filesError: t("chat.mention.files.error"),
      fileScopeSession: t("chat.mention.scope.session"),
      fileScopePersistent: t("chat.mention.scope.persistent"),
    }),
    [t],
  );

  const items = useMemo(() => {
    if (!mention || !mentionSources) return [];
    return buildMentionItems({
      plugins: mentionSources.plugins,
      files: mentionSources.files,
      query: mention.query,
      labels: mentionLabels,
    });
  }, [mention, mentionSources, mentionLabels]);

  const menuOpen = mention != null && mentionSources != null;

  // Reset highlight when the open menu's candidate set changes (open/close,
  // query filter, or source load). Keyed by item ids so equivalent lists do
  // not clobber arrow-key navigation.
  const itemsKey = items.map((i) => i.id).join("|");
  useEffect(() => {
    if (!menuOpen) {
      setActiveIndex(-1);
      return;
    }
    setActiveIndex(firstSelectableIndex(items));
    // items is derived from itemsKey; intentionally omit `items` from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- itemsKey stands in for items
  }, [menuOpen, itemsKey]);

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

  const syncMentionFromCaret = (text: string, caret: number) => {
    if (!mentionSources) {
      setMention(null);
      return;
    }
    const next = detectMention(text, caret);
    // Only update when the token range/query actually changes — keyup/select
    // fire continuously and a fresh object identity would rebuild `items` and
    // reset the keyboard highlight via the effect below.
    setMention((prev) => {
      if (prev === null && next === null) return prev;
      if (
        prev &&
        next &&
        prev.start === next.start &&
        prev.end === next.end &&
        prev.query === next.query
      ) {
        return prev;
      }
      return next;
    });
  };

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    setDraft(value);
    autoResize();
    syncMentionFromCaret(value, event.target.selectionStart ?? value.length);
  };

  const handleSelect = (event: SyntheticEvent<HTMLTextAreaElement>) => {
    const el = event.currentTarget;
    syncMentionFromCaret(el.value, el.selectionStart ?? 0);
  };

  const pickItem = (index: number) => {
    if (!mention || !sessionId) return;
    const item = items[index];
    if (!item || !item.selectable) return;
    const { text, caret } = applyMention(draft, mention, item.insertion);
    setDraft(text);
    setMention(null);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(caret, caret);
      autoResize();
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (menuOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((current) => moveActiveIndex(items, current, 1));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((current) => moveActiveIndex(items, current, -1));
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMention(null);
        return;
      }
      if (event.key === "Tab") {
        setMention(null);
        return;
      }
      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
        if (activeIndex >= 0 && items[activeIndex]?.selectable) {
          event.preventDefault();
          pickItem(activeIndex);
          return;
        }
        // No selectable highlight: close and do not submit on bare Enter while
        // the menu is open with only status rows.
        event.preventDefault();
        setMention(null);
        return;
      }
    }

    // Shift+Enter inserts a newline; bare Enter submits. Skip while IME is
    // composing so CJK candidate selection doesn't fire submit.
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  };

  const handleBlur = () => {
    if (suppressBlurCloseRef.current) return;
    setMention(null);
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!onPasteImages) return;
    // Preserve the browser's text/HTML fallback when the current composer
    // cannot accept uploads (for example before a Sandbox exists).
    if (offerClipboardImages(event.clipboardData, onPasteImages)) event.preventDefault();
  };

  const activeOptionId =
    menuOpen && activeIndex >= 0 && items[activeIndex]
      ? `${listboxId}-${activeIndex}`
      : undefined;

  return (
    <div className="composer-input">
      <label className="sr-only" htmlFor="prompt-input">
        {ariaLabel}
      </label>
      <textarea
        ref={textareaRef}
        id="prompt-input"
        rows={1}
        value={draft}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onSelect={handleSelect}
        onClick={handleSelect}
        onKeyUp={handleSelect}
        onBlur={handleBlur}
        onPaste={handlePaste}
        placeholder={placeholder}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? listboxId : undefined}
        aria-activedescendant={activeOptionId}
      />
      {menuOpen ? (
        <MentionPicker
          items={items}
          activeIndex={activeIndex}
          listboxId={listboxId}
          ariaLabel={t("chat.aria.mentionList")}
          anchorRef={textareaRef}
          groupLabels={{
            mcp: t("chat.mention.group.mcp"),
            files: t("chat.mention.group.files"),
          }}
          onHover={setActiveIndex}
          onPick={pickItem}
          onMouseDown={(event) => {
            // Keep focus in the textarea so picking doesn't race with blur-close.
            event.preventDefault();
            suppressBlurCloseRef.current = true;
            requestAnimationFrame(() => {
              suppressBlurCloseRef.current = false;
            });
          }}
        />
      ) : null}
    </div>
  );
}
