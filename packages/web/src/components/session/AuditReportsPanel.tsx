import { ClipboardCheck } from "lucide-react";
import { useEffect, useState } from "react";
import type { AuditReport } from "../../contracts/backend";
import type { TranslateVars } from "../../i18n/translate";
import { api } from "../../utils/api";

export function AuditReportsPanel({
  sessionId,
  revision,
  t,
}: {
  sessionId?: string;
  revision?: number;
  t: (key: string, vars?: TranslateVars) => string;
}) {
  const [reports, setReports] = useState<AuditReport[]>([]);

  useEffect(() => {
    if (!sessionId) {
      setReports([]);
      return;
    }
    let cancelled = false;
    void api.sessions.getAuditReports(sessionId)
      .then((items) => { if (!cancelled) setReports(items.slice().reverse()); })
      .catch(() => { if (!cancelled) setReports([]); });
    return () => { cancelled = true; };
  }, [sessionId, revision]);

  if (!sessionId || reports.length === 0) return null;

  return (
    <details className="trace-detail__section trace-audit-reports">
      <summary><ClipboardCheck size={13} /> {t("trace.audit.title", { count: reports.length })}</summary>
      <div className="trace-audit-reports__list">
        {reports.map((report) => (
          <article key={report.id}>
            <header>
              <strong>{report.summary}</strong>
              <span data-risk={report.risk}>{t(`trace.audit.risk.${report.risk}`)}</span>
            </header>
            {report.target?.nodeId ? (
              <small>{t("trace.audit.target", { node: report.target.nodeId })}</small>
            ) : null}
            <details>
              <summary>{t("trace.audit.view")}</summary>
              <pre>{report.report}</pre>
            </details>
          </article>
        ))}
      </div>
    </details>
  );
}
