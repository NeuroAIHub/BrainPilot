/**
 * KnowledgeBase build panel — surfaced as a tab inside the Settings dialog.
 *
 * Responsibilities:
 *   - Collect the two API keys the pipeline needs (SiliconFlow for OCR,
 *     OpenAI-compatible for metadata extraction). Models are downloaded
 *     and run locally — no key required there.
 *   - Let the user choose which stages to run (default: all four).
 *   - POST /api/kb/build to start a run; show a live log streamed from
 *     /api/kb/events (SSE); update a stage-by-stage progress strip.
 *   - Surface errors prominently — the user can't easily debug a Python
 *     subprocess in production, so we strive to print the actual python
 *     stderr / stage / msg.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Database, Loader2, Play, RefreshCw, Square, Wrench } from "lucide-react";
import { useT } from "../../i18n/useT";
import { api } from "../../utils/api";

type Stage = "ocr" | "extract" | "chunk" | "vectorize";

interface BuildEvent {
  ts?: string;
  stage: string;
  event: string;
  msg: string;
  // Stage-specific extras (done/total/percent/...). Kept as `unknown` here;
  // the component only reads numeric fields it knows about.
  [k: string]: unknown;
}

const STAGES: Stage[] = ["ocr", "extract", "chunk", "vectorize"];
const STAGE_LABELS: Record<Stage, string> = {
  ocr: "OCR",
  extract: "Metadata",
  chunk: "Chunking",
  vectorize: "Vectorize",
};

interface StageState {
  status: "pending" | "running" | "done" | "error";
  percent: number;
  msg: string;
}

const INITIAL_STAGE_STATE: Record<Stage, StageState> = {
  ocr: { status: "pending", percent: 0, msg: "" },
  extract: { status: "pending", percent: 0, msg: "" },
  chunk: { status: "pending", percent: 0, msg: "" },
  vectorize: { status: "pending", percent: 0, msg: "" },
};

function isKnownStage(stage: string): stage is Stage {
  return (STAGES as string[]).includes(stage);
}

export function KnowledgeBasePanel() {
  const t = useT();
  const [ocrApiKey, setOcrApiKey] = useState("");
  const [metaApiKey, setMetaApiKey] = useState("");
  const [metaBaseUrl, setMetaBaseUrl] = useState("");
  const [metaModel, setMetaModel] = useState("");
  const [reuseAgentKey, setReuseAgentKey] = useState(true);
  const [skip, setSkip] = useState<Record<Stage, boolean>>({
    ocr: false,
    extract: false,
    chunk: false,
    vectorize: false,
  });
  const [events, setEvents] = useState<BuildEvent[]>([]);
  const [stages, setStages] = useState<Record<Stage, StageState>>(INITIAL_STAGE_STATE);
  const [active, setActive] = useState(false);
  /** Distinguishes "the build is running" from "env setup is running" so the
   *  UI can show the right spinner / disable the right buttons. */
  const [activeJob, setActiveJob] = useState<"build" | "setup-env" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [env, setEnv] = useState<{
    python: string;
    pythonIsVenv: boolean;
    venvExists: boolean;
    expectedVenvPath: string;
    scriptsPresent: boolean;
    kbRoot: string;
  } | null>(null);
  const [envBusy, setEnvBusy] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);
  const sseRef = useRef<EventSource | null>(null);

  // Hydrate from server: if a build is already running (e.g. user reopened
  // the dialog mid-build), show its current status + replay recent events.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const status = await api.kb.status();
        if (cancelled) return;
        if (status.environment) setEnv(status.environment);
        if (status.recentEvents?.length) {
          setEvents(status.recentEvents);
          replayStages(status.recentEvents);
        }
        if (status.active) {
          // Guess which job is running from the most recent event with a
          // known stage. setup-env and build share the same RUN slot, so
          // we can't ask the server directly — but the last event's
          // `stage` is reliable enough for the UI banner.
          const recent = status.recentEvents ?? [];
          const last = [...recent].reverse().find(
            (ev) => ev.stage === "setup-env" || ev.stage === "build",
          );
          if (last?.stage === "setup-env") {
            setEnvBusy(true);
            setActiveJob("setup-env");
          } else {
            setActive(true);
            setActiveJob("build");
          }
          openSse();
        }
      } catch {
        /* status fetch is best-effort */
      }
    })();
    return () => {
      cancelled = true;
      closeSse();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll the log to the bottom on new events.
  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [events.length]);

  function replayStages(history: BuildEvent[]) {
    const next: Record<Stage, StageState> = { ...INITIAL_STAGE_STATE };
    for (const ev of history) {
      applyEventToStages(next, ev);
    }
    setStages(next);
  }

  function applyEventToStages(
    target: Record<Stage, StageState>,
    ev: BuildEvent,
  ) {
    if (!isKnownStage(ev.stage)) return;
    const cur = target[ev.stage];
    if (ev.event === "progress") {
      const pct = typeof ev.percent === "number" ? ev.percent : cur.percent;
      target[ev.stage] = { status: "running", percent: pct, msg: ev.msg };
    } else if (ev.event === "info") {
      target[ev.stage] = { ...cur, status: "running", msg: ev.msg };
    } else if (ev.event === "done") {
      target[ev.stage] = { status: "done", percent: 100, msg: ev.msg };
    } else if (ev.event === "error") {
      target[ev.stage] = { ...cur, status: "error", msg: ev.msg };
    } else if (ev.event === "warn") {
      target[ev.stage] = { ...cur, msg: ev.msg };
    }
  }

  async function refreshEnv() {
    try {
      const s = await api.kb.status();
      if (s.environment) setEnv(s.environment);
    } catch {
      /* best-effort */
    }
  }

  function pushEvent(ev: BuildEvent) {
    setEvents((prev) => {
      const next = prev.concat(ev);
      // Cap log at ~2k lines so a long OCR run doesn't drag the DOM.
      return next.length > 2000 ? next.slice(next.length - 2000) : next;
    });
    setStages((prev) => {
      const next = { ...prev };
      applyEventToStages(next, ev);
      return next;
    });
    // Job-level finish signals: clear active flags.
    if (ev.stage === "build" && (ev.event === "done" || ev.event === "error")) {
      setActive(false);
      setActiveJob(null);
    }
    if (ev.stage === "setup-env" && (ev.event === "done" || ev.event === "error")) {
      setEnvBusy(false);
      setActiveJob(null);
      // Re-fetch environment so the banner flips from yellow to green
      // (or stays yellow with the right error).
      void refreshEnv();
    }
  }

  function openSse() {
    if (sseRef.current) return;
    const es = new EventSource(api.kb.eventsUrl());
    sseRef.current = es;
    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data) as BuildEvent;
        if (ev.event === "stream-end" || ev.event === "idle") {
          es.close();
          sseRef.current = null;
          return;
        }
        pushEvent(ev);
      } catch {
        /* swallow malformed event */
      }
    };
    es.onerror = () => {
      // Browser auto-retries; nothing to do.
    };
  }

  function closeSse() {
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }
  }

  const formInvalid = useMemo(() => {
    if (skip.ocr === false && !ocrApiKey.trim()) {
      return t("settings.kb.error.missingOcrKey");
    }
    if (skip.extract === false) {
      if (!metaApiKey.trim() && !reuseAgentKey) {
        return t("settings.kb.error.missingMetaKey");
      }
    }
    return null;
  }, [ocrApiKey, metaApiKey, reuseAgentKey, skip.ocr, skip.extract, t]);

  async function startBuild() {
    setError(null);
    if (formInvalid) {
      setError(formInvalid);
      return;
    }
    // Reset for a fresh run.
    setEvents([]);
    setStages(INITIAL_STAGE_STATE);
    // When "reuse agent key" is on we omit metaKey from the request and let
    // the build_kb.py side resolve it from META_LLM_API_KEY / API_config.json.
    // Browser code can't read the masked provider key over the API, so we
    // intentionally don't try.
    const metaKey: string | undefined = reuseAgentKey ? undefined : (metaApiKey.trim() || undefined);
    const skipList = STAGES.filter((s) => skip[s]);
    try {
      const r = await api.kb.build({
        ocrApiKey: ocrApiKey.trim() || undefined,
        metaApiKey: metaKey || undefined,
        metaBaseUrl: metaBaseUrl.trim() || undefined,
        metaModel: metaModel.trim() || undefined,
        skip: skipList.length ? skipList : undefined,
      });
      if (!r.ok) {
        setError(r.error || "build start failed");
        return;
      }
      setActive(true);
      setActiveJob("build");
      openSse();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function cancelBuild() {
    try {
      await api.kb.cancel();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function startEnvSetup(reinstall: boolean) {
    setError(null);
    // Keep the build log in place if the user already ran one — env setup
    // events get prefixed with [setup-env:...] so they stay visually
    // distinct from prior [build:...] / [ocr:...] lines.
    setEnvBusy(true);
    setActiveJob("setup-env");
    try {
      const r = await api.kb.setupEnv({ reinstall });
      if (!r.ok) {
        setEnvBusy(false);
        setActiveJob(null);
        setError(r.error || "setup-env start failed");
        return;
      }
      openSse();
    } catch (err) {
      setEnvBusy(false);
      setActiveJob(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <section className="settings-section">
      <div className="settings-section__header">
        <div>
          <h3 className="kb-panel__title">
            <Database size={18} aria-hidden />
            {t("settings.kb.title")}
          </h3>
          <p>
            {t("settings.kb.desc")}
          </p>
        </div>
      </div>

      {env ? (
        <div className={`kb-env kb-env--${env.venvExists ? "ready" : "missing"}`}>
          <div className="kb-env__head">
            <span className={`sandbox-chip sandbox-chip--${env.venvExists ? "ok" : "off"}`}>
              <Wrench size={13} />
              {t("settings.kb.env.title")}
              <i className="sandbox-chip__dot" aria-hidden="true" />
            </span>
          </div>
          <dl className="kb-env__facts">
            <div>
              <dt>KB_ROOT</dt>
              <dd>{env.kbRoot}</dd>
            </div>
            <div>
              <dt>Python</dt>
              <dd>{env.python}{env.pythonIsVenv ? " · venv" : ""}</dd>
            </div>
          </dl>
          {!env.venvExists ? (
            <div className="kb-env__action">
              <p className="kb-env__note">{t("settings.kb.env.venvMissing")}</p>
              <div className="kb-env__buttons">
                <button
                  type="button"
                  className="settings-button"
                  onClick={() => void startEnvSetup(false)}
                  disabled={envBusy || activeJob !== null}
                  title={t("settings.kb.env.setupHint")}
                >
                  <Wrench size={14} aria-hidden />
                  {t("settings.kb.env.setupButton")}
                </button>
                {envBusy ? <Loader2 size={14} className="spin" aria-hidden /> : null}
              </div>
              <details className="kb-env__fallback">
                <summary>{t("settings.kb.env.cliFallback")}</summary>
                <pre className="kb-code">{`bash ${env.kbRoot}/scripts/setup_env.sh`}</pre>
                <p className="kb-env__note">{t("settings.kb.env.venvHint")}</p>
              </details>
            </div>
          ) : (
            <div className="kb-env__buttons">
              <button
                type="button"
                className="settings-button settings-button--ghost"
                onClick={() => void startEnvSetup(true)}
                disabled={envBusy || activeJob !== null}
                title={t("settings.kb.env.reinstallHint")}
              >
                <RefreshCw size={14} aria-hidden />
                {t("settings.kb.env.reinstallButton")}
              </button>
              {envBusy ? <Loader2 size={14} className="spin" aria-hidden /> : null}
            </div>
          )}
        </div>
      ) : null}

      <div className="kb-fields">
        <label className="settings-field">
          <span>{t("settings.kb.ocrKey")}</span>
          <input
            type="password"
            value={ocrApiKey}
            onChange={(e) => setOcrApiKey(e.target.value)}
            placeholder="sk-..."
            autoComplete="off"
            disabled={active || skip.ocr}
          />
        </label>

        <label className="settings-check">
          <input
            type="checkbox"
            checked={reuseAgentKey}
            onChange={(e) => setReuseAgentKey(e.target.checked)}
            disabled={active}
          />
          <span>
            {t("settings.kb.reuseAgentKey")}
          </span>
        </label>

        {!reuseAgentKey ? (
          <>
            <label className="settings-field">
              <span>{t("settings.kb.metaKey")}</span>
              <input
                type="password"
                value={metaApiKey}
                onChange={(e) => setMetaApiKey(e.target.value)}
                placeholder="sk-..."
                autoComplete="off"
                disabled={active || skip.extract}
              />
            </label>
            <label className="settings-field">
              <span>{t("settings.kb.metaBaseUrl")}</span>
              <input
                type="url"
                value={metaBaseUrl}
                onChange={(e) => setMetaBaseUrl(e.target.value)}
                placeholder="https://api.example.com"
                disabled={active || skip.extract}
              />
            </label>
            <label className="settings-field">
              <span>{t("settings.kb.metaModel")}</span>
              <input
                type="text"
                value={metaModel}
                onChange={(e) => setMetaModel(e.target.value)}
                placeholder="deepseek-chat"
                disabled={active || skip.extract}
              />
            </label>
          </>
        ) : null}

        <fieldset className="kb-stages">
          <legend>{t("settings.kb.stages")}</legend>
          <div className="kb-stages__row">
            {STAGES.map((s) => (
              <label key={s} className="settings-check kb-stages__item">
                <input
                  type="checkbox"
                  checked={!skip[s]}
                  disabled={active}
                  onChange={(e) =>
                    setSkip((prev) => ({ ...prev, [s]: !e.target.checked }))
                  }
                />
                <span>{STAGE_LABELS[s]}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="kb-actions">
        {!active ? (
          <button
            className="settings-button"
            type="button"
            onClick={() => void startBuild()}
            disabled={!!formInvalid || envBusy || (env != null && !env.venvExists)}
            title={
              formInvalid
                ?? (env != null && !env.venvExists
                  ? t("settings.kb.env.needSetupFirst")
                  : envBusy
                    ? t("settings.kb.env.busy")
                    : undefined)
            }
          >
            <Play size={14} aria-hidden />
            {t("settings.kb.start")}
          </button>
        ) : (
          <button
            className="settings-button"
            type="button"
            onClick={() => void cancelBuild()}
          >
            <Square size={14} aria-hidden />
            {t("settings.kb.cancel")}
          </button>
        )}
        {active ? <Loader2 size={16} className="spin" aria-hidden /> : null}
      </div>

      {error ? <p className="settings-note settings-note--error kb-error">{error}</p> : null}

      <div className="kb-block">
        <h4 className="kb-block__title">{t("settings.kb.progress")}</h4>
        <div className="kb-progress">
          {STAGES.map((s) => {
            const st = stages[s];
            const pct = Math.min(100, Math.max(0, st.percent));
            return (
              <div key={s} className="kb-progress__row">
                <strong className="kb-progress__label">{STAGE_LABELS[s]}</strong>
                <div className="kb-progress__track" aria-hidden="true">
                  <span
                    className={`kb-progress__fill kb-progress__fill--${st.status}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="kb-progress__pct">
                  {st.status === "done" ? "✓" : `${Math.round(st.percent)}%`}
                </span>
                {st.msg ? <div className="kb-progress__msg">{st.msg}</div> : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="kb-block">
        <h4 className="kb-block__title">{t("settings.kb.log")}</h4>
        <div ref={logRef} className="kb-log">
          {events.length === 0 ? (
            <span className="kb-log__empty">{t("settings.kb.logEmpty")}</span>
          ) : events.map((ev, i) => (
            <div key={i} className={`kb-log__line kb-log__line--${ev.event}`}>
              [{ev.stage}:{ev.event}] {ev.msg}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
