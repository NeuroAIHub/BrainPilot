import { ChevronDown, Square } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage } from "../../contracts/backend";
import { useT } from "../../i18n/useT";
import { formatElapsed } from "../../utils/format";
import { selectActiveScripts } from "./runningScripts";

interface Props {
  messages: ChatMessage[];
  onStop: () => void;
}

/**
 * "Running scripts" panel — sits directly above the composer while any bash
 * tool call is in flight, and unmounts the moment the last one ends.
 *
 * The message-stream activity block folds a whole turn's reasoning + tool
 * calls into one collapsed history entry; the composer toast only names the
 * working agent. Neither answers what users most often ask when they see the
 * agent pause: "what shell command is running right now, and can I kill it?"
 *
 * Per-script elapsed timing is derived locally from a ref-held Map keyed by
 * `toolCallId` — the runtime doesn't emit a start timestamp on
 * `tool_call_start`, and per-second precision is fine for a "how long has
 * this been going" affordance. `role="status"` (no `aria-live`) so the
 * once-a-second tick doesn't spam screen readers with elapsed digits.
 */
export function RunningScriptsPanel({ messages, onStop }: Props) {
  const t = useT();
  const scripts = useMemo(() => selectActiveScripts(messages), [messages]);

  // New scripts get a stamp the first render they appear in; finished ones
  // are pruned so a re-appearing tool-call-id (shouldn't happen, but be
  // defensive) restarts its clock cleanly.
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

  // Open by default — the whole point of the panel is that the user sees
  // what's running. `<details>` preserves the user's toggle across re-renders
  // as long as the DOM node is reused (which it is: the panel itself doesn't
  // remount while scripts come and go).
  const [open, setOpen] = useState(true);

  if (scripts.length === 0) return null;

  const now = performance.now();
  const starts = Array.from(startedAt.current.values());
  const oldest = starts.length > 0 ? Math.min(...starts) : now;

  return (
    <div className="running-scripts" role="status">
      <details
        open={open}
        onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary>
          <span className="running-scripts__dot" aria-hidden="true" />
          <ChevronDown size={14} className="running-scripts__chevron" aria-hidden="true" />
          <span className="running-scripts__label">
            {t("chat.runningScripts.count", { count: scripts.length })}
            {` · ${formatElapsed(now - oldest)}`}
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
          {scripts.map((s) => {
            const start = startedAt.current.get(s.id);
            const elapsed = start === undefined ? "" : formatElapsed(now - start);
            return (
              <li className="running-scripts__item" key={s.id}>
                <div className="running-scripts__item-head">
                  <span className="running-scripts__item-agent">{s.agent}</span>
                  <span className="running-scripts__item-name">bash</span>
                  <span className="running-scripts__item-elapsed">{elapsed}</span>
                </div>
                <pre className="running-scripts__cmd">
                  {s.command || t("chat.runningScripts.pending")}
                </pre>
              </li>
            );
          })}
        </ul>
      </details>
    </div>
  );
}
