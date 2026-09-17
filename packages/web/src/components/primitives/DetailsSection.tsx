import type { ReactNode } from "react";

/** Native disclosure keeps optional information available without crowding the main task. */
export function DetailsSection({ summary, children, className = "" }: {
  summary: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details className={`details-section ${className}`.trim()}>
      <summary>{summary}</summary>
      <div className="details-section__body">{children}</div>
    </details>
  );
}
