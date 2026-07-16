/**
 * Presentational listbox for composer `@` mentions (#316).
 *
 * Keyboard and open/close state live in ComposerInput; this component only
 * renders items + reports hover/click. Portaled to document.body so the
 * parent `.composer { overflow: hidden }` does not clip the menu.
 */
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent, RefObject } from "react";
import { createPortal } from "react-dom";
import type { MentionItem } from "./mentionLogic";

export type MentionPickerProps = {
  items: MentionItem[];
  activeIndex: number;
  listboxId: string;
  ariaLabel: string;
  /** Anchor element (textarea or wrapper) for fixed positioning. */
  anchorRef: RefObject<HTMLElement | null>;
  /** Translated group headers. */
  groupLabels: { mcp: string; files: string };
  onHover: (index: number) => void;
  onPick: (index: number) => void;
  /** Prevent textarea blur when interacting with the menu. */
  onMouseDown?: (event: MouseEvent) => void;
};

export function MentionPicker({
  items,
  activeIndex,
  listboxId,
  ariaLabel,
  anchorRef,
  groupLabels,
  onHover,
  onPick,
  onMouseDown,
}: MentionPickerProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<CSSProperties>({
    top: -9999,
    left: -9999,
    width: 280,
  });

  // useEffect (not useLayoutEffect) so node/SSR markup tests don't warn; a
  // one-frame position snap is fine for a floating menu.
  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor || typeof window === "undefined") return;

    const update = () => {
      const rect = anchor.getBoundingClientRect();
      const gap = 6;
      const maxHeight = Math.min(280, window.innerHeight * 0.45);
      const spaceAbove = rect.top - 12;
      const placeAbove = spaceAbove >= 120 || spaceAbove >= window.innerHeight - rect.bottom;
      const width = Math.min(Math.max(rect.width, 200), window.innerWidth - 24);

      if (placeAbove) {
        setStyle({
          left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
          width,
          bottom: window.innerHeight - rect.top + gap,
          maxHeight: Math.min(maxHeight, Math.max(100, spaceAbove - gap)),
          top: "auto",
        });
      } else {
        setStyle({
          left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
          width,
          top: rect.bottom + gap,
          maxHeight: Math.min(maxHeight, Math.max(100, window.innerHeight - rect.bottom - 12)),
          bottom: "auto",
        });
      }
    };

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchorRef, items.length]);

  let lastGroup: "mcp" | "files" | undefined;

  const menu = (
    <div
      className="mention-picker"
      id={listboxId}
      ref={menuRef}
      role="listbox"
      aria-label={ariaLabel}
      style={style}
      onMouseDown={onMouseDown}
    >
      {items.map((item, index) => {
        const showHeader = item.group && item.group !== lastGroup;
        if (item.group) lastGroup = item.group;

        return (
          <div key={item.id} className="mention-picker__block">
            {showHeader ? (
              <div className="mention-picker__group" aria-hidden="true">
                {item.group === "mcp" ? groupLabels.mcp : groupLabels.files}
              </div>
            ) : null}
            {item.selectable ? (
              <button
                type="button"
                id={`${listboxId}-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                className={`mention-picker__option ${index === activeIndex ? "is-active" : ""}`}
                onMouseEnter={() => onHover(index)}
                onClick={() => onPick(index)}
              >
                <span className="mention-picker__label">{item.label}</span>
                {item.detail ? (
                  <span className="mention-picker__detail">{item.detail}</span>
                ) : null}
              </button>
            ) : (
              <div
                id={`${listboxId}-${index}`}
                className="mention-picker__status"
                role="option"
                aria-selected={false}
                aria-disabled="true"
              >
                <span className="mention-picker__label">{item.label}</span>
                {item.detail ? (
                  <span className="mention-picker__detail">{item.detail}</span>
                ) : null}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  if (typeof document === "undefined") {
    // SSR / renderToStaticMarkup: render in place so markup tests still see it.
    return menu;
  }
  return createPortal(menu, document.body);
}
