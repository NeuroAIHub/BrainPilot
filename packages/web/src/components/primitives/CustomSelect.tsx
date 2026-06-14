import { Check, ChevronDown } from "lucide-react";
import { CSSProperties, KeyboardEvent, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { ReactNode } from "react";

export type CustomSelectOption = {
  value: string;
  label: string;
  indicator?: ReactNode;
};

type CustomSelectProps = {
  value: string;
  options: CustomSelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
  title?: string;
};

export function CustomSelect({
  value,
  options,
  onChange,
  ariaLabel,
  className = "",
  disabled = false,
  placeholder = "Select",
  title,
}: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const [placement, setPlacement] = useState<"top" | "bottom">("bottom");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : null;
  const activeIndex = selectedIndex >= 0 ? selectedIndex : 0;
  const activeOptionId = isOpen && options[activeIndex] ? `${listboxId}-${activeIndex}` : undefined;
  const rootClassName = `custom-select ${isOpen ? "is-open" : ""} custom-select--${placement} ${disabled ? "is-disabled" : ""} ${className}`.trim();
  const updateMenuPosition = useCallback(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }
    const rect = root.getBoundingClientRect();
    const gap = 6;
    const viewportPadding = 12;
    const preferredMenuHeight = Math.min(220, Math.max(44, options.length * 34 + 8));
    const availableBelow = window.innerHeight - rect.bottom - viewportPadding;
    const availableAbove = rect.top - viewportPadding;
    const nextPlacement = availableBelow < preferredMenuHeight && availableAbove > availableBelow ? "top" : "bottom";
    const menuWidth = Math.max(rect.width, Math.min(280, window.innerWidth - viewportPadding * 2));
    const left = Math.min(Math.max(viewportPadding, rect.right - menuWidth), window.innerWidth - menuWidth - viewportPadding);

    setPlacement(nextPlacement);
    setMenuStyle({
      left,
      minWidth: rect.width,
      width: menuWidth,
      ...(nextPlacement === "top"
        ? { bottom: window.innerHeight - rect.top + gap, maxHeight: Math.max(120, availableAbove - gap) }
        : { top: rect.bottom + gap, maxHeight: Math.max(120, availableBelow - gap) }),
    });
  }, [options.length]);

  useLayoutEffect(() => {
    if (isOpen) {
      updateMenuPosition();
    }
  }, [isOpen, updateMenuPosition]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setIsOpen(false);
      }
    };
    const handleReposition = () => updateMenuPosition();
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [isOpen, updateMenuPosition]);

  const normalizedOptions = useMemo(() => options, [options]);

  const selectOption = (nextValue: string) => {
    onChange(nextValue);
    setIsOpen(false);
  };

  const moveSelection = (direction: 1 | -1) => {
    if (normalizedOptions.length === 0) {
      return;
    }
    const nextIndex = selectedIndex >= 0
      ? (selectedIndex + direction + normalizedOptions.length) % normalizedOptions.length
      : 0;
    onChange(normalizedOptions[nextIndex].value);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape") {
      setIsOpen(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        return;
      }
      moveSelection(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        return;
      }
      moveSelection(-1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setIsOpen((current) => !current);
    }
  };

  const menu = isOpen ? createPortal(
    <div
      className={`custom-select__menu custom-select__menu--floating custom-select__menu--${placement}`}
      id={listboxId}
      ref={menuRef}
      role="listbox"
      style={menuStyle}
    >
      {normalizedOptions.map((option, index) => {
        const isSelected = option.value === value;
        return (
          <button
            aria-selected={isSelected}
            className={`custom-select__option ${isSelected ? "is-selected" : ""}`.trim()}
            id={`${listboxId}-${index}`}
            key={option.value}
            onClick={() => selectOption(option.value)}
            role="option"
            type="button"
          >
            <span className="custom-select__option-label">
              {option.indicator ? <span className="custom-select__option-indicator">{option.indicator}</span> : null}
              {option.label}
            </span>
            {isSelected ? <Check aria-hidden="true" size={14} /> : null}
          </button>
        );
      })}
    </div>,
    document.body,
  ) : null;

  return (
    <div className={rootClassName} ref={rootRef}>
      <button
        aria-activedescendant={activeOptionId}
        aria-controls={listboxId}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className="custom-select__trigger"
        disabled={disabled}
        onClick={() => setIsOpen((current) => !current)}
        onKeyDown={handleKeyDown}
        title={title}
        type="button"
      >
        <span className={`custom-select__value ${selectedOption ? "" : "is-placeholder"}`.trim()}>
          {selectedOption?.indicator ? <span className="custom-select__value-indicator">{selectedOption.indicator}</span> : null}
          {selectedOption?.label ?? placeholder}
        </span>
        <ChevronDown aria-hidden="true" size={14} />
      </button>
      {menu}
    </div>
  );
}
