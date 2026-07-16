import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  children: ReactNode;
  variant?: "ghost" | "soft" | "strong";
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    { label, children, className = "", variant = "ghost", type = "button", ...props },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        aria-label={label}
        title={label}
        className={`icon-button icon-button--${variant} ${className}`.trim()}
        {...props}
      >
        {children}
      </button>
    );
  },
);
