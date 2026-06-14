import type { ButtonHTMLAttributes, ReactNode } from "react";

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  children: ReactNode;
  variant?: "ghost" | "soft" | "strong";
};

export function IconButton({
  label,
  children,
  className = "",
  variant = "ghost",
  ...props
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`icon-button icon-button--${variant} ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  );
}
