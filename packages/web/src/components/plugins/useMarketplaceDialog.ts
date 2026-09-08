import { useEffect, useRef } from "react";
import { trapFocusKeyDown } from "../settings/settingsModalStack";

/** Keep keyboard navigation within marketplace details and return to its opener. */
export function useMarketplaceDialog(id: string | null, close: () => void) {
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!id) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLButtonElement>(".plugin-detail__close")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
      } else if (dialog) trapFocusKeyDown(dialog, event);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      if (opener?.isConnected) opener.focus();
    };
  }, [id, close]);
  return dialogRef;
}
