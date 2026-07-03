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
import { AlertTriangle, Check, Database, Loader2, Play, RefreshCw, Square, Wrench, X } from "lucide-react";
import { useT } from "../../i18n/useT";
import { api, type KbEnvironment, type KbInventory, type KbInventoryIssue } from "../../utils/api";

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
  /**
   * Stage lifecycle:
   *   pending  — hasn't started yet
   *   running  — first info/progress event received
   *   done     — final ``done`` event received AND no quality issues detected
   *   warning  — final ``done`` event received BUT the stage reported fail /
   *              fallback / empty counts, OR the stage emitted `warn` events
   *              along the way. The stage technically completed; the KB is
   *              usable, but the operator should know something needs
   *              attention (e.g. some PDFs never OCR'd, some rows still in
   *              fallback state, some batches failed to embed).
   *   error    — fatal — the stage crashed or the backend killed it. The
   *              pipeline stops here.
   *
   * Distinction between warning and done is the whole point of this state
   * — a green bar after a run that dropped 200 rows to fallback is a lie.
   */
  status: "pending" | "running" | "done" | "warning" | "error";
  percent: number;
  msg: string;
  /** Human-readable list of issues (one per warning). Rendered as a tooltip
   *  on the warning badge and expanded inline under the row. */
  issues: string[];
  /** Cumulative warn-event count during the run — chunk doesn't have a
   *  quality field on its done event (unlike extract's `fallback`), so we
   *  approximate its "warning" state by counting warn events. */
  warnEvents: number;
}

const INITIAL_STAGE_STATE: Record<Stage, StageState> = {
  ocr: { status: "pending", percent: 0, msg: "", issues: [], warnEvents: 0 },
  extract: { status: "pending", percent: 0, msg: "", issues: [], warnEvents: 0 },
  chunk: { status: "pending", percent: 0, msg: "", issues: [], warnEvents: 0 },
  vectorize: { status: "pending", percent: 0, msg: "", issues: [], warnEvents: 0 },
};

function isKnownStage(stage: string): stage is Stage {
  return (STAGES as string[]).includes(stage);
}

interface SetupState {
  percent: number;
  msg: string;
  status: "pending" | "running" | "done" | "error";
}

/**
 * HuggingFace download source group — bundles two controls that logically
 * belong together but affect the same download step: the mirror checkbox
 * (route through hf-mirror.com) and the auth token input.
 *
 * They're mutually somewhat exclusive: hf-mirror.com is an anonymous
 * public reverse-proxy for HuggingFace's CDN; it does NOT forward
 * authenticated requests to huggingface.co, so any Authorization header
 * we send along is silently dropped by the mirror. That means when the
 * mirror is checked, the token input is disabled and the hint explains
 * why — a subtle detail that would otherwise waste a user's key.
 *
 * The token is intentionally NOT persisted anywhere — kept only in the
 * caller's useState for the lifetime of the panel. If the user reloads,
 * they re-enter it. Unlike the SiliconFlow OCR key (which the pipeline
 * needs on every subsequent build), the HF token is only useful during
 * the one-shot ~2.5 GB weight download, so persisting it would be all
 * downside.
 */
function HfSourceGroup({
  useMirror,
  onUseMirrorChange,
  token,
  onTokenChange,
  disabled,
  t,
}: {
  useMirror: boolean;
  onUseMirrorChange: (next: boolean) => void;
  token: string;
  onTokenChange: (next: string) => void;
  disabled?: boolean;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  return (
    <fieldset className="kb-hf-group">
      <legend>{t("settings.kb.env.hfSourceGroup")}</legend>

      <label className="settings-check">
        <input
          type="checkbox"
          checked={useMirror}
          onChange={(e) => onUseMirrorChange(e.target.checked)}
          disabled={disabled}
        />
        <span>{t("settings.kb.useHfMirror")}</span>
      </label>
      <p className="kb-field-hint">{t("settings.kb.useHfMirrorHint")}</p>

      <label className="settings-field kb-hf-group__token">
        <span>{t("settings.kb.env.hfToken")}</span>
        <input
          type="password"
          value={useMirror ? "" : token}
          onChange={(e) => onTokenChange(e.target.value)}
          placeholder={useMirror ? t("settings.kb.env.hfTokenDisabledPlaceholder") : "hf_..."}
          autoComplete="off"
          disabled={disabled || useMirror}
        />
        <p className="kb-field-hint">
          {useMirror
            ? t("settings.kb.env.hfTokenIgnoredByMirror")
            : t("settings.kb.env.hfTokenHint")}
        </p>
      </label>
    </fieldset>
  );
}

/**
 * Toggle for the Tsinghua tuna pip mirror. Rendered as a plain checkbox
 * (not password-masked) because the URL is fixed and public. Extracted so
 * both env-setup branches (venv-missing and venv-present) render identical
 * UI without duplication. Same reason we pass `t` in as a prop rather than
 * re-hooking useT() inside — the parent already holds the language.
 */
function PipMirrorField({
  checked,
  onChange,
  disabled,
  t,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  return (
    <div className="settings-field">
      <label className="settings-check">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
        />
        <span>{t("settings.kb.env.usePipMirror")}</span>
      </label>
      <p className="kb-field-hint">{t("settings.kb.env.usePipMirrorHint")}</p>
    </div>
  );
}

/**
 * The KB status card — surfaces the four-stage pipeline health independent
 * of any in-flight build. Green when the four ledgers agree; amber when
 * the consistency check spots gaps (new PDFs waiting, fallback rows,
 * chunks not yet vectorised, etc.).
 *
 * `t` and `nowMs` are passed in rather than hooked internally so the parent
 * can share a single "seconds ago" clock tick with all its subcomponents.
 */
function InventoryCard({
  inventory,
  busy,
  onRefresh,
  t,
  nowMs,
}: {
  inventory: KbInventory | null;
  busy: boolean;
  onRefresh: () => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  nowMs: number;
}) {
  if (!inventory) return null;

  const inv = inventory;
  const healthy = inv.consistency.healthy;
  const secondsAgo = Math.max(0, Math.floor((nowMs - inv.sampledAt) / 1000));

  // Per-stage rollup — the four "stage cell" columns at the top. Each cell
  // gets its own ok/pending flag by scanning the issue list. Order of the
  // stages is fixed (pipeline order) so the UI matches the mental model.
  const stageStatus: Record<KbInventoryIssue["stage"], { ok: boolean; count: number }> = {
    ocr: { ok: true, count: 0 },
    extract: { ok: true, count: 0 },
    chunk: { ok: true, count: 0 },
    vectorize: { ok: true, count: 0 },
  };
  for (const iss of inv.consistency.issues) {
    stageStatus[iss.stage].ok = false;
    stageStatus[iss.stage].count += iss.count;
  }

  // Left-column value formatter: numbers get their locale-formatted
  // thousands separators for readability. null → em-dash so an absent
  // ledger doesn't look like "0".
  const fmt = (n: number | null | undefined) =>
    n == null ? t("settings.kb.inv.metric.unavailable") : n.toLocaleString();

  return (
    <div className={`kb-inv kb-inv--${healthy ? "healthy" : "pending"}`}>
      <div className="kb-inv__head">
        <span className={`sandbox-chip sandbox-chip--${healthy ? "ok" : "off"}`}>
          <Database size={13} />
          {t("settings.kb.inv.title")}
          <i className="sandbox-chip__dot" aria-hidden="true" />
        </span>
        <div className="kb-inv__head-right">
          <span className="kb-inv__sampled-at">
            {t("settings.kb.inv.sampledAt", { seconds: secondsAgo })}
          </span>
          <button
            type="button"
            className="settings-button settings-button--ghost settings-button--sm"
            onClick={onRefresh}
            disabled={busy}
            title={t("settings.kb.inv.refresh")}
          >
            <RefreshCw size={12} aria-hidden className={busy ? "spin" : undefined} />
            {busy ? t("settings.kb.inv.refreshing") : t("settings.kb.inv.refresh")}
          </button>
        </div>
      </div>

      {/* Headline — one-liner summarising green/amber state. */}
      <div className={`kb-inv__headline kb-inv__headline--${healthy ? "ok" : "pending"}`}>
        {healthy ? <Check size={16} aria-hidden /> : <AlertTriangle size={16} aria-hidden />}
        <strong>
          {healthy
            ? t("settings.kb.inv.headline.healthy")
            : t("settings.kb.inv.headline.pending")}
        </strong>
      </div>

      {/* Four-cell stage strip: each cell = one pipeline stage with its own
          ok/pending badge. When ok the cell shows a filled progress bar. */}
      <div className="kb-inv__stages">
        {(["ocr", "extract", "chunk", "vectorize"] as const).map((s) => {
          const st = stageStatus[s];
          const label = t(`settings.kb.inv.stage${s[0]!.toUpperCase() + s.slice(1)}`);
          return (
            <div key={s} className={`kb-inv__stage kb-inv__stage--${st.ok ? "ok" : "pending"}`}>
              <div className="kb-inv__stage-head">
                <span className="kb-inv__stage-icon" aria-hidden>
                  {st.ok ? <Check size={12} /> : <AlertTriangle size={12} />}
                </span>
                <span className="kb-inv__stage-label">{label}</span>
              </div>
              <div className="kb-inv__stage-bar" aria-hidden>
                <span
                  className={`kb-inv__stage-fill kb-inv__stage-fill--${st.ok ? "ok" : "pending"}`}
                  style={{ width: st.ok ? "100%" : "40%" }}
                />
              </div>
              {!st.ok ? (
                <span className="kb-inv__stage-count">
                  {t("settings.kb.inv.issue.missing", { n: st.count })}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Numeric summary — dense two-column grid of the aggregate stats
          the four ledgers give us. Rendered even on amber runs; a user
          looking at "wait what's the actual number of chunks" doesn't
          want to hunt through the log. */}
      <dl className="kb-inv__metrics">
        <MetricRow label={t("settings.kb.inv.metric.pdfs")} value={fmt(inv.pdfsOnDisk)} />
        <MetricRow label={t("settings.kb.inv.metric.ocred")} value={fmt(inv.ocred)} />
        {inv.extracted ? (
          <>
            <MetricRow
              label={t("settings.kb.inv.metric.extracted")}
              value={`${fmt(inv.extracted.total)} (ok: ${fmt(inv.extracted.ok)}${
                inv.extracted.fallback ? `, fallback: ${fmt(inv.extracted.fallback)}` : ""
              }${inv.extracted.empty ? `, empty: ${fmt(inv.extracted.empty)}` : ""})`}
            />
          </>
        ) : null}
        {inv.chunks ? (
          <>
            <MetricRow label={t("settings.kb.inv.metric.chunks")} value={fmt(inv.chunks.total)} />
            {inv.chunks.totalChars != null ? (
              <MetricRow
                label={t("settings.kb.inv.metric.totalChars")}
                value={fmt(inv.chunks.totalChars)}
              />
            ) : null}
            {inv.chunks.meanChars != null ? (
              <MetricRow
                label={t("settings.kb.inv.metric.meanChars")}
                value={fmt(inv.chunks.meanChars)}
              />
            ) : null}
          </>
        ) : null}
        {inv.vectors ? (
          <>
            <MetricRow label={t("settings.kb.inv.metric.vectors")} value={fmt(inv.vectors.count)} />
            <MetricRow
              label={t("settings.kb.inv.metric.embedModel")}
              value={`${inv.vectors.model} (dim=${inv.vectors.dim})`}
            />
            {inv.vectors.updatedAt ? (
              <MetricRow
                label={t("settings.kb.inv.metric.updatedAt")}
                value={new Date(inv.vectors.updatedAt).toLocaleString()}
              />
            ) : null}
          </>
        ) : null}
      </dl>

      {/* Issue drill-down — only rendered on amber runs. Each entry is
          one machine-derived inconsistency; the raw msg is kept as a
          fallback for API consumers, but we translate via the kind here. */}
      {!healthy && inv.consistency.issues.length ? (
        <ul className="kb-inv__issues">
          {inv.consistency.issues.map((iss, i) => (
            <li key={i} className="kb-inv__issue">
              <AlertTriangle size={13} aria-hidden />
              <span className="kb-inv__issue-stage">
                {t(`settings.kb.inv.stage${iss.stage[0]!.toUpperCase() + iss.stage.slice(1)}`)}
              </span>
              <span>{t(`settings.kb.inv.issue.${iss.kind}`, { n: iss.count })}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {inv.pdfsOnDisk === 0 ? (
        <p className="kb-inv__hint">
          {t("settings.kb.inv.noPdfs", { path: `${inv.kbRoot}/source/pdf/` })}
        </p>
      ) : null}
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/**
 * One row in the env-completeness checklist. Three states:
 *  - ok = true          → green ✓, label only
 *  - unknown = true     → grey ?, label + neutral hint (probe not yet run;
 *                         happens briefly while status is loading)
 *  - otherwise          → red ×, label + `pendingText` explaining what to do
 */
function ChecklistItem({
  ok,
  unknown,
  label,
  pendingText,
}: {
  ok: boolean;
  unknown?: boolean;
  label: string;
  pendingText: string;
}) {
  const state = ok ? "ok" : unknown ? "unknown" : "pending";
  return (
    <li className={`kb-env__check kb-env__check--${state}`}>
      <span className="kb-env__check-icon" aria-hidden>
        {ok ? <Check size={14} /> : unknown ? "…" : <X size={14} />}
      </span>
      <span className="kb-env__check-body">
        <span className="kb-env__check-label">{label}</span>
        {!ok ? <span className="kb-env__check-hint">{pendingText}</span> : null}
      </span>
    </li>
  );
}

// Small progress bar used for the venv + model download rows in the env
// card. Kept local to this file so we don't grow a shared "ProgressBar"
// component just for two sites — one file, one style.
function SetupProgressRow({
  label,
  state,
}: {
  label: string;
  state: SetupState;
}) {
  const pct = Math.max(0, Math.min(100, state.percent));
  return (
    <div className="kb-setup-row">
      <div className="kb-setup-row__head">
        <span className="kb-setup-row__label">{label}</span>
        <span className="kb-setup-row__pct">{state.status === "done" ? "✓ 100%" : `${pct}%`}</span>
      </div>
      <div className="kb-setup-row__track" aria-hidden="true">
        <span className={`kb-setup-row__fill kb-setup-row__fill--${state.status}`} style={{ width: `${pct}%` }} />
      </div>
      {state.msg ? (
        <div className={`kb-setup-row__msg ${state.status === "error" ? "kb-setup-row__msg--error" : ""}`}>
          {state.msg}
        </div>
      ) : null}
    </div>
  );
}

export function KnowledgeBasePanel() {
  const t = useT();
  const [ocrApiKey, setOcrApiKey] = useState("");
  const [metaApiKey, setMetaApiKey] = useState("");
  const [metaBaseUrl, setMetaBaseUrl] = useState("");
  const [metaModel, setMetaModel] = useState("");
  const [reuseAgentKey, setReuseAgentKey] = useState(true);
  const [useHfMirror, setUseHfMirror] = useState(false);
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
   *  UI can show the right spinner / disable the right buttons.
   *  "setup-full" covers the one-click orchestration that runs venv + model
   *  download back-to-back. */
  const [activeJob, setActiveJob] = useState<"build" | "setup-env" | "setup-full" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [env, setEnv] = useState<KbEnvironment | null>(null);
  /** Live-updating "N seconds ago" clock — needs its own tick to advance
   *  without waiting on a re-render triggered by something else. Kept on
   *  a 5s cadence: precise enough for the label, quiet enough not to churn.
   *  probeTick also flips true when the user hits "Re-check" so the button
   *  can show a spinner while the request is in flight. */
  const [probeTick, setProbeTick] = useState(0);
  const [probeBusy, setProbeBusy] = useState(false);
  // Inventory panel (four-stage disk state + consistency check). Independent
  // of the env probe — the two answer different questions ("is the pipeline
  // installable" vs "is what's on disk internally consistent").
  const [inventory, setInventory] = useState<KbInventory | null>(null);
  const [inventoryBusy, setInventoryBusy] = useState(false);
  const [envBusy, setEnvBusy] = useState(false);
  // Model download runs in parallel with env setup; it needs its own
  // progress row and busy flag so the UI can show both in flight at once.
  const [modelBusy, setModelBusy] = useState(false);
  // Optional HuggingFace token — session-only so a shared machine can't leak
  // credentials by accident. Empty string ≡ anonymous download.
  const [hfToken, setHfToken] = useState("");
  // Toggle for the China pip mirror. Only affects the venv install path;
  // the KB pipeline's HTTP calls (SiliconFlow OCR, metadata LLM) are
  // orthogonal and unchanged.
  const [usePipMirror, setUsePipMirror] = useState(false);
  const PIP_MIRROR_URL = "https://pypi.tuna.tsinghua.edu.cn/simple";
  const [envProgress, setEnvProgress] = useState<SetupState>(
    { percent: 0, msg: "", status: "pending" },
  );
  const [modelProgress, setModelProgress] = useState<SetupState>(
    { percent: 0, msg: "", status: "pending" },
  );
  // Persisted OCR key state: true iff the backend confirms one is on disk.
  // When true, the input shows a masked preview + "Change" button so the
  // user doesn't have to re-type it on every page reload.
  const [ocrKeySaved, setOcrKeySaved] = useState(false);
  const [ocrKeyPreview, setOcrKeyPreview] = useState("");
  const [ocrKeyEditing, setOcrKeyEditing] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);
  const sseRef = useRef<EventSource | null>(null);
  /**
   * Cursor for SSE de-dup. When we open the panel mid-build we call
   * ``replayStages`` on ``/kb/status.recentEvents`` FIRST, then
   * ``openSse`` — but the server's SSE stream **also** replays its
   * buffered history immediately after subscribing, so the same events
   * would flow through ``applyEventToStages`` twice. That's mostly
   * idempotent (progress → done overwrites), but the ``warn`` accumulator
   * would double-count. This ref stores the ISO ts of the newest event
   * we've already applied; any SSE event with an equal-or-earlier ts is
   * a replayed dup and gets dropped.
   */
  const lastAppliedTsRef = useRef<string>("");

  // Hydrate from server: if a build is already running (e.g. user reopened
  // the dialog mid-build), show its current status + replay recent events.
  // Also fetch the persisted OCR key state so the input can show "saved".
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const cfg = await api.kb.getApiConfig();
        if (cancelled) return;
        setOcrKeySaved(cfg.hasOcrApiKey);
        setOcrKeyPreview(cfg.ocrApiKeyPreview);
      } catch {
        /* api-config fetch is best-effort */
      }
    })();
    // Fetch the on-disk inventory in parallel — it's the top card of the
    // panel and users expect it to be filled in immediately on open.
    void (async () => {
      try {
        const r = await api.kb.inventory();
        if (cancelled) return;
        setInventory(r.inventory);
      } catch {
        /* best-effort — leave inventory null and the card just doesn't render. */
      }
    })();
    void (async () => {
      try {
        const status = await api.kb.status();
        if (cancelled) return;
        if (status.environment) setEnv(status.environment);
        if (status.recentEvents?.length) {
          setEvents(status.recentEvents);
          replayStages(status.recentEvents);
          replaySetupProgress(status.recentEvents);
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
    // Reset each stage to a fresh copy — the initial constant is shared,
    // and applyEventToStages mutates by index.
    const next: Record<Stage, StageState> = {
      ocr: { ...INITIAL_STAGE_STATE.ocr },
      extract: { ...INITIAL_STAGE_STATE.extract },
      chunk: { ...INITIAL_STAGE_STATE.chunk },
      vectorize: { ...INITIAL_STAGE_STATE.vectorize },
    };
    for (const ev of history) {
      applyEventToStages(next, ev);
    }
    setStages(next);
    // Remember the newest ts we applied so the SSE handler can skip the
    // replayed duplicates it's about to receive.
    let maxTs = "";
    for (const ev of history) {
      if (ev.ts && ev.ts > maxTs) maxTs = ev.ts;
    }
    if (maxTs) lastAppliedTsRef.current = maxTs;
  }

  function applyEventToStages(
    target: Record<Stage, StageState>,
    ev: BuildEvent,
  ) {
    if (!isKnownStage(ev.stage)) return;
    const cur = target[ev.stage];
    if (ev.event === "progress") {
      const pct = typeof ev.percent === "number" ? ev.percent : cur.percent;
      target[ev.stage] = { ...cur, status: "running", percent: pct, msg: ev.msg };
    } else if (ev.event === "info") {
      target[ev.stage] = { ...cur, status: "running", msg: ev.msg };
    } else if (ev.event === "done") {
      // Inspect the stage-specific quality counters carried on the done
      // event. Each stage advertises different fields — see the tables in
      // KnowledgeBase/scripts/*.py's emit_event("<stage>", "done", ...).
      const issues = deriveDoneIssues(ev.stage, ev, cur.warnEvents);
      const isWarning = issues.length > 0;
      target[ev.stage] = {
        status: isWarning ? "warning" : "done",
        percent: 100,
        msg: ev.msg,
        issues,
        warnEvents: cur.warnEvents,
      };
    } else if (ev.event === "error") {
      target[ev.stage] = {
        ...cur,
        status: "error",
        msg: ev.msg,
        // Preserve issues so a warning that later escalates to error still
        // shows both in the drill-down list.
        issues: cur.issues,
      };
    } else if (ev.event === "warn") {
      // Accumulate: warn events during a run are the raw signal for the
      // "chunk stage got a warning" case where the done event doesn't
      // report failure counts. They also add colour to the tooltip for the
      // other stages, so we keep them even when a numeric quality field
      // will also fire on done.
      target[ev.stage] = {
        ...cur,
        msg: ev.msg,
        issues: [...cur.issues, ev.msg],
        warnEvents: cur.warnEvents + 1,
      };
    }
  }

  /**
   * Read the numeric quality counters a Python stage emits alongside its
   * ``done`` event, and translate any non-zero counter into a plain-string
   * issue the UI can render. Keeps the stage-specific field names as the
   * single source of truth here (backend already emits them; no wire
   * change needed).
   *
   * `priorWarnCount` covers `chunk`, which has no numeric quality field on
   * done — we approximate by "was there at least one warn event during the
   * run?". OCR/extract/vectorize get precise counts.
   */
  function deriveDoneIssues(
    stage: Stage,
    ev: BuildEvent,
    priorWarnCount: number,
  ): string[] {
    const out: string[] = [];
    const num = (key: string): number => {
      const v = ev[key];
      return typeof v === "number" ? v : 0;
    };
    if (stage === "ocr") {
      const fail = num("fail");
      if (fail > 0) out.push(t("settings.kb.stage.warn.ocrFail", { n: fail }));
    } else if (stage === "extract") {
      const fallback = num("fallback");
      const empty = num("empty");
      if (fallback > 0) out.push(t("settings.kb.stage.warn.extractFallback", { n: fallback }));
      if (empty > 0) out.push(t("settings.kb.stage.warn.extractEmpty", { n: empty }));
    } else if (stage === "vectorize") {
      const fail = num("fail");
      if (fail > 0) out.push(t("settings.kb.stage.warn.vectorizeFail", { n: fail }));
    } else if (stage === "chunk") {
      // chunk's done event doesn't carry a numeric error count — surface an
      // aggregate "N warnings during chunking" line so the user knows to
      // check the log.
      if (priorWarnCount > 0) {
        out.push(t("settings.kb.stage.warn.chunkGeneric", { n: priorWarnCount }));
      }
    }
    return out;
  }

  // Replay setup-env / setup-models progress from a fresh snapshot (used on
  // page reload when there might be a job already in flight — the SSE stream
  // gives us subsequent events, this fills in whatever happened before).
  function replaySetupProgress(history: BuildEvent[]) {
    let envP: SetupState = { percent: 0, msg: "", status: "pending" };
    let modelP: SetupState = { percent: 0, msg: "", status: "pending" };
    for (const ev of history) {
      if (ev.stage === "setup-env") {
        envP = deriveSetupState(envP, ev);
      } else if (ev.stage === "setup-models") {
        modelP = deriveSetupState(modelP, ev);
      }
    }
    setEnvProgress(envP);
    setModelProgress(modelP);
  }

  function deriveSetupState(prev: SetupState, ev: BuildEvent): SetupState {
    if (ev.event === "progress") {
      const pct = typeof ev.percent === "number" ? ev.percent : prev.percent;
      return { status: "running", percent: pct, msg: ev.msg };
    }
    if (ev.event === "info") {
      return { ...prev, status: "running", msg: ev.msg };
    }
    if (ev.event === "done") {
      return { status: "done", percent: 100, msg: ev.msg };
    }
    if (ev.event === "error") {
      return { ...prev, status: "error", msg: ev.msg };
    }
    return prev;
  }

  async function refreshInventory() {
    setInventoryBusy(true);
    try {
      const r = await api.kb.inventory();
      setInventory(r.inventory);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("kb.inventory failed:", err);
    } finally {
      setInventoryBusy(false);
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

  /** Force-refresh the deps+models probe on the backend, bypassing the 60s
   *  cache. Used by the "Re-check" button — always safe to click, and the
   *  only way to see the effect of e.g. a manual `pip install` without
   *  waiting for the TTL. */
  async function startProbe() {
    setProbeBusy(true);
    try {
      const r = await api.kb.probe();
      if (r.environment) setEnv(r.environment);
    } catch (err) {
      // Don't set the top-level error banner — the probe is diagnostic; a
      // failure is uninteresting to the build flow and would just noise up
      // the panel. Log to console so it's still discoverable in devtools.
      // eslint-disable-next-line no-console
      console.warn("kb.probe failed:", err);
    } finally {
      setProbeBusy(false);
    }
  }

  // Tick the "N seconds ago" label every 5 s while the panel is mounted.
  // Cheap: one setState with a number, guaranteed to trigger only that label.
  useEffect(() => {
    const id = window.setInterval(() => setProbeTick((t) => t + 1), 5_000);
    return () => window.clearInterval(id);
  }, []);
  // Reference probeTick so React treats the render as depending on it — the
  // computation reads env.probedAt but the DISPLAY needs to re-render every
  // tick. Assigning to a discarded local is cheap and lint-clean.
  void probeTick;

  function pushEvent(ev: BuildEvent) {
    // Drop events we've already replayed from /kb/status. The server's SSE
    // stream re-emits its buffer to every new subscriber, so opening the
    // panel mid-build causes each buffered event to arrive twice — once
    // via /kb/status.recentEvents (via replayStages), once via the SSE
    // stream. Comparing ts against the cursor drops the second copy.
    if (ev.ts && ev.ts <= lastAppliedTsRef.current) return;
    if (ev.ts) lastAppliedTsRef.current = ev.ts;
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
      // A finished build changed the on-disk ledgers — refresh the inventory
      // panel so the operator sees updated counts + a fresh consistency check
      // without having to click "Refresh" themselves.
      void refreshInventory();
    }
    if (ev.stage === "setup-env") {
      setEnvProgress((prev) => deriveSetupState(prev, ev));
      if (ev.event === "done" || ev.event === "error") {
        setEnvBusy(false);
        // Re-fetch environment so the banner flips from yellow to green
        // (or stays yellow with the right error).
        void refreshEnv();
      }
    }
    if (ev.stage === "setup-models") {
      setModelProgress((prev) => deriveSetupState(prev, ev));
      if (ev.event === "info" && !modelBusy) setModelBusy(true);
      if (ev.event === "done" || ev.event === "error") {
        setModelBusy(false);
      }
    }
    // The whole "setup-full" umbrella job clears activeJob only when both
    // constituent jobs are done (or one failed). setup-full emits its own
    // synthetic done/error event that we key off here.
    if (ev.stage === "setup-full" && (ev.event === "done" || ev.event === "error")) {
      setActiveJob(null);
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
    if (skip.ocr === false && !ocrApiKey.trim() && !ocrKeySaved) {
      return t("settings.kb.error.missingOcrKey");
    }
    if (skip.extract === false) {
      if (!metaApiKey.trim() && !reuseAgentKey) {
        return t("settings.kb.error.missingMetaKey");
      }
    }
    return null;
  }, [ocrApiKey, ocrKeySaved, metaApiKey, reuseAgentKey, skip.ocr, skip.extract, t]);

  async function startBuild() {
    setError(null);
    if (formInvalid) {
      setError(formInvalid);
      return;
    }
    // Reset for a fresh run.
    setEvents([]);
    setStages({
      ocr: { ...INITIAL_STAGE_STATE.ocr },
      extract: { ...INITIAL_STAGE_STATE.extract },
      chunk: { ...INITIAL_STAGE_STATE.chunk },
      vectorize: { ...INITIAL_STAGE_STATE.vectorize },
    });
    // Fresh run — throw away the "last seen ts" cursor so the first event
    // of this build gets applied even though its ts might be earlier than
    // some ancient event from an old buffer.
    lastAppliedTsRef.current = "";
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
        hfMirror: useHfMirror ? "https://hf-mirror.com" : undefined,
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
    setEnvProgress({ percent: 0, msg: "", status: "running" });
    try {
      const r = await api.kb.setupEnv({
        reinstall,
        pipIndexUrl: usePipMirror ? PIP_MIRROR_URL : undefined,
      });
      if (!r.ok) {
        setEnvBusy(false);
        setActiveJob(null);
        setEnvProgress({ percent: 0, msg: r.error || "start failed", status: "error" });
        setError(r.error || "setup-env start failed");
        return;
      }
      openSse();
    } catch (err) {
      setEnvBusy(false);
      setActiveJob(null);
      setEnvProgress({ percent: 0, msg: String(err), status: "error" });
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  /** Kick off ONLY the model download (venv is assumed to exist). Idempotent
   *  on the Python side — bge-m3 completing then bge-reranker crashing
   *  half-way is exactly the case this button exists for: rerun, skip the
   *  ~1 GB already on disk, resume the missing one. Token is opt-in. */
  async function startModelSetup() {
    setError(null);
    setModelBusy(true);
    setActiveJob((cur) => cur ?? "setup-env");
    setModelProgress({ percent: 0, msg: "", status: "running" });
    try {
      const r = await api.kb.setupModels({
        hfMirror: useHfMirror ? "https://hf-mirror.com" : undefined,
        hfToken: hfToken.trim() || undefined,
      });
      if (!r.ok) {
        setModelBusy(false);
        setActiveJob(null);
        setModelProgress({ percent: 0, msg: r.error || "start failed", status: "error" });
        setError(r.error || "setup-models start failed");
        return;
      }
      openSse();
    } catch (err) {
      setModelBusy(false);
      setActiveJob(null);
      setModelProgress({ percent: 0, msg: String(err), status: "error" });
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  /** One-click: create venv, then download bge models. The backend chains
   *  the two jobs — venv completes first, models kick off automatically. */
  async function startFullSetup() {
    setError(null);
    setEnvBusy(true);
    setModelBusy(true);
    setActiveJob("setup-full");
    setEnvProgress({ percent: 0, msg: "", status: "running" });
    setModelProgress({ percent: 0, msg: "waiting for venv…", status: "pending" });
    try {
      const r = await api.kb.setupFull({
        hfMirror: useHfMirror ? "https://hf-mirror.com" : undefined,
        hfToken: hfToken.trim() || undefined,
        pipIndexUrl: usePipMirror ? PIP_MIRROR_URL : undefined,
      });
      if (!r.ok) {
        setEnvBusy(false);
        setModelBusy(false);
        setActiveJob(null);
        setEnvProgress({ percent: 0, msg: r.error || "start failed", status: "error" });
        setError(r.error || "setup-full start failed");
        return;
      }
      openSse();
    } catch (err) {
      setEnvBusy(false);
      setModelBusy(false);
      setActiveJob(null);
      setEnvProgress({ percent: 0, msg: String(err), status: "error" });
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  /** Save the OCR API key to disk (backend → API_config.json). Called on
   *  blur when the user typed something new. */
  async function saveOcrKey(value: string) {
    if (!value.trim()) return;
    try {
      const r = await api.kb.saveApiConfig({ ocrApiKey: value.trim() });
      if (!r.ok) {
        setError(r.error || "failed to save OCR key");
        return;
      }
      setOcrKeySaved(true);
      // The backend gives us the masked preview on GET; refresh so the UI
      // shows "...abcd" matching what's actually on disk.
      const cfg = await api.kb.getApiConfig();
      setOcrKeyPreview(cfg.ocrApiKeyPreview);
      setOcrKeyEditing(false);
      // Clear the input value now that it's persisted — subsequent builds
      // pick it up from the backend's saved copy.
      setOcrApiKey("");
    } catch (err) {
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

      {/* Inventory card — surfaces the current KB pipeline health from
          disk. Rendered before the env card because a user opening this
          panel most often wants to know "is my KB fresh?" first, and only
          then "what do I need to install to build more?". */}
      <InventoryCard
        inventory={inventory}
        busy={inventoryBusy}
        onRefresh={() => void refreshInventory()}
        t={t}
        nowMs={Date.now()}
      />

      {env ? (
        <div className={`kb-env kb-env--${env.readyToBuild ? "ready" : env.venvExists ? "partial" : "missing"}`}>
          <div className="kb-env__head">
            <span className={`sandbox-chip sandbox-chip--${env.readyToBuild ? "ok" : "off"}`}>
              <Wrench size={13} />
              {t("settings.kb.env.title")}
              <i className="sandbox-chip__dot" aria-hidden="true" />
            </span>
            <div className="kb-env__head-right">
              {env.probedAt ? (
                <span className="kb-env__probed-at">
                  {t("settings.kb.env.probedAt", {
                    seconds: Math.max(0, Math.floor((Date.now() - env.probedAt) / 1000)),
                  })}
                </span>
              ) : null}
              <button
                type="button"
                className="settings-button settings-button--ghost settings-button--sm"
                onClick={() => void startProbe()}
                disabled={probeBusy || envBusy || modelBusy}
                title={t("settings.kb.env.recheck")}
              >
                <RefreshCw size={12} aria-hidden className={probeBusy ? "spin" : undefined} />
                {probeBusy ? t("settings.kb.env.checking") : t("settings.kb.env.recheck")}
              </button>
            </div>
          </div>

          {/* Completeness summary — one line per prerequisite, green ✓ if
              satisfied, red × with an actionable hint otherwise. This is the
              first thing the user sees when they open the panel. */}
          <div className={`kb-env__summary kb-env__summary--${env.readyToBuild ? "ok" : "pending"}`}>
            {env.readyToBuild ? (
              <div className="kb-env__summary-headline">
                <Check size={16} aria-hidden />
                <strong>{t("settings.kb.env.ready")}</strong>
              </div>
            ) : (
              <div className="kb-env__summary-headline">
                <strong>{t("settings.kb.env.notReady")}</strong>
              </div>
            )}
            <ul className="kb-env__checklist">
              <ChecklistItem
                ok={env.venvExists}
                label={t("settings.kb.env.itemVenv")}
                pendingText={t("settings.kb.env.checkVenv")}
              />
              <ChecklistItem
                ok={env.depsInstalled === true}
                unknown={env.depsInstalled === null && env.venvExists}
                label={t("settings.kb.env.itemDeps")}
                pendingText={
                  env.depsError
                    ? t("settings.kb.env.checkDepsError", { error: env.depsError })
                    : env.depsMissing.length > 0
                      ? t("settings.kb.env.checkDepsWithMissing", { names: env.depsMissing.join(", ") })
                      : t("settings.kb.env.checkDeps")
                }
              />
              <ChecklistItem
                ok={env.models.bgeM3 && env.models.bgeReranker}
                label={t("settings.kb.env.itemModels")}
                pendingText={t("settings.kb.env.checkModelsWithMissing", {
                  names: [
                    env.models.bgeM3 ? null : "bge-m3",
                    env.models.bgeReranker ? null : "bge-reranker-v2-m3",
                  ]
                    .filter(Boolean)
                    .join(", "),
                })}
              />
              <ChecklistItem
                ok={env.pdfsPresent > 0}
                label={t("settings.kb.env.itemPdfs", { count: env.pdfsPresent })}
                pendingText={t("settings.kb.env.checkPdfs", { path: `${env.kbRoot}/source/pdf/` })}
              />
            </ul>
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

              {/* Grouped HF source controls — first-time setup benefits the
                  most from choosing the right mirror + optional token. */}
              <HfSourceGroup
                useMirror={useHfMirror}
                onUseMirrorChange={setUseHfMirror}
                token={hfToken}
                onTokenChange={setHfToken}
                disabled={envBusy || modelBusy}
                t={t}
              />

              {/* China pip mirror — same rationale: first-time setup is the
                  slowest and benefits the most from a nearby index. */}
              <PipMirrorField
                checked={usePipMirror}
                onChange={setUsePipMirror}
                disabled={envBusy || modelBusy}
                t={t}
              />

              <div className="kb-env__buttons">
                <button
                  type="button"
                  className="settings-button"
                  onClick={() => void startFullSetup()}
                  disabled={envBusy || modelBusy || activeJob !== null}
                  title={t("settings.kb.env.setupFullHint")}
                >
                  <Wrench size={14} aria-hidden />
                  {t("settings.kb.env.setupFullButton")}
                </button>
                {envBusy || modelBusy ? <Loader2 size={14} className="spin" aria-hidden /> : null}
              </div>
              <details className="kb-env__fallback">
                <summary>{t("settings.kb.env.cliFallback")}</summary>
                <pre className="kb-code">
                  {`bash ${env.kbRoot}/scripts/setup_env.sh
${env.kbRoot}/.venv/bin/python ${env.kbRoot}/scripts/setup_models.py`}
                </pre>
                <p className="kb-env__note">{t("settings.kb.env.venvHint")}</p>
              </details>
            </div>
          ) : (
            <div className="kb-env__action">
              {/* HF source group — mirror + token. Session-only credentials. */}
              <HfSourceGroup
                useMirror={useHfMirror}
                onUseMirrorChange={setUseHfMirror}
                token={hfToken}
                onTokenChange={setHfToken}
                disabled={envBusy || modelBusy}
                t={t}
              />
              {/* pip mirror is only meaningful when re-installing the venv;
                  we still surface it here (rather than gate on `--reinstall`
                  clicks alone) because the same button set covers both
                  "reinstall venv" and "download models" — the flag is
                  ignored by the models path. */}
              <PipMirrorField
                checked={usePipMirror}
                onChange={setUsePipMirror}
                disabled={envBusy || modelBusy}
                t={t}
              />
              <div className="kb-env__buttons">
                <button
                  type="button"
                  className="settings-button settings-button--ghost"
                  onClick={() => void startEnvSetup(true)}
                  disabled={envBusy || modelBusy || activeJob !== null}
                  title={t("settings.kb.env.reinstallHint")}
                >
                  <RefreshCw size={14} aria-hidden />
                  {t("settings.kb.env.reinstallButton")}
                </button>
                <button
                  type="button"
                  className="settings-button settings-button--ghost"
                  onClick={() => void startModelSetup()}
                  disabled={envBusy || modelBusy || activeJob !== null}
                  title={t("settings.kb.env.downloadModelsHint")}
                >
                  <Wrench size={14} aria-hidden />
                  {t("settings.kb.env.downloadModelsButton")}
                </button>
                {envBusy || modelBusy ? <Loader2 size={14} className="spin" aria-hidden /> : null}
              </div>
            </div>
          )}

          {/* Setup progress rows: shown any time either job is/was active. */}
          {(envProgress.status !== "pending" || modelProgress.status !== "pending") ? (
            <div className="kb-setup-rows">
              <SetupProgressRow
                label={t("settings.kb.env.venvProgressLabel")}
                state={envProgress}
              />
              <SetupProgressRow
                label={t("settings.kb.env.modelProgressLabel")}
                state={modelProgress}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="kb-fields">
        <label className="settings-field">
          <span>{t("settings.kb.ocrKey")}</span>
          {ocrKeySaved && !ocrKeyEditing ? (
            <div className="kb-key-saved-row">
              <div className="kb-key-saved">
                {t("settings.kb.ocrKeySaved")} {ocrKeyPreview}
              </div>
              <button
                type="button"
                className="settings-button settings-button--ghost"
                onClick={() => setOcrKeyEditing(true)}
                disabled={active || skip.ocr}
              >
                {t("settings.kb.ocrKeyChange")}
              </button>
            </div>
          ) : (
            <input
              type="password"
              value={ocrApiKey}
              onChange={(e) => setOcrApiKey(e.target.value)}
              onBlur={(e) => {
                // Persist on blur so the user doesn't have to remember to
                // save. Empty input (they cleared it) → treat as no-op.
                if (e.target.value.trim()) void saveOcrKey(e.target.value);
              }}
              placeholder="sk-..."
              autoComplete="off"
              disabled={active || skip.ocr}
            />
          )}
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

        {/* The HF mirror + token controls previously lived here in the
            build-config section. They moved to the environment card
            (grouped as HfSourceGroup) because they affect the model
            download step — same place users configure venv/models. */}

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
            disabled={
              !!formInvalid ||
              envBusy ||
              modelBusy ||
              // env == null means we haven't heard from the backend yet; allow
              // the click so the user isn't blocked forever if /kb/status is
              // slow, and the backend will reject with a helpful message.
              (env != null && (!env.venvExists || env.depsInstalled === false || !env.models.bgeM3 || !env.models.bgeReranker))
            }
            title={
              formInvalid
                ?? (env != null && !env.venvExists
                  ? t("settings.kb.env.needSetupFirst")
                  : env != null && env.depsInstalled === false
                    ? t("settings.kb.env.checkDeps")
                    : env != null && (!env.models.bgeM3 || !env.models.bgeReranker)
                      ? t("settings.kb.env.checkModels")
                      : envBusy || modelBusy
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
            // Symbol shown in the percent column — takes precedence over the
            // raw number when the stage is in a terminal state, so users see
            // an unambiguous ✓/⚠/✗ instead of a bare "100%" that hides a
            // problem. Warning tooltip lists the exact counts.
            const badge =
              st.status === "done" ? "✓"
                : st.status === "warning" ? "⚠"
                  : st.status === "error" ? "✗"
                    : `${Math.round(st.percent)}%`;
            return (
              <div key={s} className={`kb-progress__row kb-progress__row--${st.status}`}>
                <strong className="kb-progress__label">{STAGE_LABELS[s]}</strong>
                <div className="kb-progress__track" aria-hidden="true">
                  <span
                    className={`kb-progress__fill kb-progress__fill--${st.status}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span
                  className={`kb-progress__pct kb-progress__pct--${st.status}`}
                  title={st.issues.length ? st.issues.join("\n") : undefined}
                >
                  {badge}
                </span>
                {st.msg ? <div className="kb-progress__msg">{st.msg}</div> : null}
                {/* Warning breakdown: only shown when the stage terminated
                    with a warning — otherwise we don't nag with an issue
                    list. Each item is one plain-string sentence produced by
                    deriveDoneIssues / warn events. */}
                {st.status === "warning" && st.issues.length ? (
                  <ul className="kb-progress__issues">
                    {st.issues.map((iss, i) => (
                      <li key={i} className="kb-progress__issue">{iss}</li>
                    ))}
                  </ul>
                ) : null}
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
