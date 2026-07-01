import { ChevronDown, Square } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage } from "../../contracts/backend";
import { useT } from "../../i18n/useT";
import { selectActiveScripts, type ActiveScript } from "./runningScripts";

interface Props {
  messages: ChatMessage[];
  onStop: () => void;
}

/**
 * Compact elapsed formatter shared with MessageStream's turn footer:
 * "3.2s" under a minute, "1m 05s" above. Kept inline (rather than pulled
 * into utils) to keep the panel a single-file drop-in.
 */
function formatElapsed(ms: number): string {
  const secondsTotal = ms / 1000;
  if (secondsTotal < 60) return `${secondsTotal.toFixed(1)}s`;
  const m = Math.floor(secondsTotal / 60);
  const s = Math.floor(secondsTotal % 60);
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

/**
 * "Running scripts" panel — sits immediately above the composer while any
 * bash tool call is in flight, and disappears the moment the last one ends.
 *
 * Rationale for its own component (rather than a tab or a message-stream
 * insert): the user's Stop and "what's happening right now" needs are
 * always about the *current* turn, not history. Anchoring the panel to
 * the composer means it's always in the user's line of sight while they
 * consider their next prompt — the same visual weight class as the
 * `.agent-running-toast` it replaces the Stop button of.
 *
 * Per-script elapsed timing is derived locally from a Map keyed by
 * `toolCallId`: the first render that sees a script stamps its start,
 * subsequent renders read back that stamp, and a 1s tick drives the
 * displayed value. We can't use the AG-UI event timestamps here because
 * the runtime doesn't emit them on tool_call_start; per-second precision
 * is fine for a "how long has this been running" affordance.
 */
export function RunningScriptsPanel({ messages, onStop }: Props) {
  const t = useT();
  const scripts = useMemo(() => selectActiveScripts(messages), [messages]);

  // Track per-script start times across renders. New scripts get a stamp
  // the first render they appear in; finished scripts are pruned so a
  // future call with the same tool-call-id (shouldn't happen, but let's
  // be defensive) would restart the clock.
  const startedAt = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    const now = performance.now();
    const live = new Set(scripts.map((s) => s.id));
    for (const id of live) {
      if (!startedAt.current.has(id)) startedAt.current.set(id, now);
    }
    for (const id of startedAt.current.keys()) {
      if (!live.has(id)) startedAt.current.delete(id);
    }
  }, [scripts]);

  // Tick once a second while at least one script is in flight so the
  // per-script elapsed advances without needing external state.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (scripts.length === 0) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [scripts.length]);

  // Open by default — the whole point of the panel is that the user can
  // see what's running. `<details>` preserves the user's toggle across
  // re-renders as long as the DOM node is reused (which it is: the panel
  // itself doesn't remount while scripts come and go).
  const [open, setOpen] = useState(true);

  if (scripts.length === 0) return null;

  const now = performance.now();
  const elapsedFor = (script: ActiveScript): string => {
    const start = startedAt.current.get(script.id);
    if (start === undefined) return "";
    return formatElapsed(Math.max(0, now - start));
  };
  // Total = wall-clock elapsed of the oldest still-running script. That
  // matches how a shell user thinks about "how long has this batch been
  // going": the first thing that started is still going, so its age is
  // the batch's age.
  const oldestStart = Array.from(startedAt.current.values()).reduce(
    (min, v) => (v < min ? v : min),
    Number.POSITIVE_INFINITY,
  );
  const totalElapsed = Number.isFinite(oldestStart)
    ? formatElapsed(Math.max(0, now - oldestStart))
    : "";

  return (
    <div className="running-scripts" role="status" aria-live="polite">
      <details
        open={open}
        onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary className="running-scripts__summary">
          <span className="running-scripts__dot" aria-hidden="true" />
          <ChevronDown
            size={14}
            className="running-scripts__chevron"
            aria-hidden="true"
          />
          <span className="running-scripts__label">
            {t("chat.runningScripts.count", { count: scripts.length })}
            {totalElapsed ? ` · ${totalElapsed}` : ""}
          </span>
          <button
            className="running-scripts__stop"
            type="button"
            onClick={(e) => {
              // Don't toggle the <details> when clicking Stop.
              e.stopPropagation();
              e.preventDefault();
              onStop();
            }}
            aria-label={t("chat.aria.stop")}
            title={t("chat.aria.stop")}
          >
            <Square size={10} fill="currentColor" />
            <span>{t("chat.stop")}</span>
          </button>
        </summary>
        <ul className="running-scripts__list">
          {scripts.map((s) => (
            <li className="running-scripts__item" key={s.id}>
              <div className="running-scripts__item-head">
                <span className="running-scripts__item-agent">{s.agent}</span>
                <span className="running-scripts__item-name">bash</span>
                <span className="running-scripts__item-elapsed">
                  {elapsedFor(s)}
                </span>
              </div>
              <pre className="running-scripts__cmd">
                {s.command || t("chat.runningScripts.pending")}
              </pre>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
