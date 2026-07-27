import { ChevronDown, Square } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ActiveToolExecution } from "@brainpilot/protocol";
import type { ChatMessage } from "../../contracts/backend";
import { useT } from "../../i18n/useT";
import { formatElapsed } from "../../utils/format";
import { selectActiveScripts } from "./runningScripts";

interface Props {
  messages: ChatMessage[];
  activeTools?: ActiveToolExecution[];
  onStopScript: (toolCallId: string) => void;
  onStopTask: () => void;
  isStoppingTask?: boolean;
  stoppingToolIds?: ReadonlySet<string>;
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
export function RunningScriptsPanel({
  messages,
  activeTools,
  onStopScript,
  onStopTask,
  isStoppingTask = false,
  stoppingToolIds = new Set(),
}: Props) {
  const t = useT();
  const scripts = useMemo(() => selectActiveScripts(messages, activeTools), [messages, activeTools]);

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

  const now = Date.now();
  const starts = scripts.map((script) => Date.parse(script.startedAt)).filter(Number.isFinite);
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
            {` · ${formatElapsed(Math.max(0, now - oldest))}`}
          </span>
          <button
            className="running-scripts__stop"
            type="button"
            onClick={(e) => {
              // Don't toggle the <details> when clicking Stop.
              e.stopPropagation();
              e.preventDefault();
              onStopTask();
            }}
            disabled={isStoppingTask}
            aria-label={t("chat.aria.stop")}
            title={t("chat.aria.stop")}
          >
            <Square size={10} fill="currentColor" />
            <span>{isStoppingTask ? t("chat.stoppingTask") : t("chat.stopTask")}</span>
          </button>
        </summary>
        <ul className="running-scripts__list">
          {scripts.map((s) => {
            const start = Date.parse(s.startedAt);
            const elapsed = Number.isFinite(start) ? formatElapsed(Math.max(0, now - start)) : "";
            const stopping = s.status === "stopping" || stoppingToolIds.has(s.id);
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
                {s.cancellable ? (
                  <button
                    className="running-scripts__stop running-scripts__stop--script"
                    type="button"
                    disabled={stopping || isStoppingTask}
                    onClick={() => onStopScript(s.id)}
                  >
                    <Square size={10} fill="currentColor" />
                    <span>{stopping ? t("chat.stoppingScript") : t("chat.stopScript")}</span>
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </details>
    </div>
  );
}
