/**
 * useTurnTimer — React host for the whole-turn timer reducer (#99).
 *
 * Consumes the authoritative whole-session activity signal from SessionContext
 * (session_state.workState.active + backend timestamp) and produces:
 *   - `running`: a turn is in progress (active, or within the settle window);
 *   - `elapsedMs`: live elapsed while running (ticks ~every second), or the
 *     last settled whole-turn duration once finished;
 *   - `lastDurationMs`: the last settled whole-turn duration.
 *
 * The settle window debounces the true→false→true flap that happens when a hook
 * / system message / queued task event re-wakes an agent right after a
 * turn momentarily ends — that mid-flap false must NOT end the turn.
 */
import { useEffect, useReducer, useRef, useState } from "react";
import {
  turnTimerReducer,
  initialTurnTimerState,
  type TurnTimerState,
} from "./turnTimer";

/** Default debounce for the terminal active=false transition. */
export const DEFAULT_SETTLE_MS = 900;

export interface TurnTiming {
  running: boolean;
  /** Live elapsed while running; the settled duration once finished; null if none. */
  elapsedMs: number | null;
  lastDurationMs: number | null;
}

interface UseTurnTimerOptions {
  /** Backend run-active snapshot; null until the first session_state arrives. */
  runActive: { active: boolean; atMs: number } | null;
  /** Key that resets the timer when it changes (e.g. session id). */
  resetKey?: string | null;
  settleMs?: number;
  /** Test seam: clock source (defaults to Date.now). */
  now?: () => number;
}

export function useTurnTimer(options: UseTurnTimerOptions): TurnTiming {
  const { runActive, resetKey, settleMs = DEFAULT_SETTLE_MS, now = Date.now } = options;
  const [state, dispatch] = useReducer(turnTimerReducer, initialTurnTimerState);
  const settleRef = useRef<number | undefined>(undefined);
  const [, forceTick] = useState(0);

  // Reset when the session changes.
  useEffect(() => {
    dispatch({ type: "reset" });
  }, [resetKey]);

  // Feed authoritative active transitions into the reducer.
  useEffect(() => {
    if (!runActive) return;
    dispatch({ type: "active", value: runActive.active, atMs: runActive.atMs });
  }, [runActive]);

  // Arm/disarm the settle timer based on a pending candidate end.
  const hasCandidate = state.candidateEndAt !== null;
  useEffect(() => {
    if (!hasCandidate) {
      if (settleRef.current !== undefined) {
        window.clearTimeout(settleRef.current);
        settleRef.current = undefined;
      }
      return;
    }
    settleRef.current = window.setTimeout(() => {
      settleRef.current = undefined;
      dispatch({ type: "settle" });
    }, settleMs);
    return () => {
      if (settleRef.current !== undefined) {
        window.clearTimeout(settleRef.current);
        settleRef.current = undefined;
      }
    };
  }, [hasCandidate, settleMs]);

  // Tick once per second while running so the live elapsed advances.
  useEffect(() => {
    if (!state.running) return;
    const id = window.setInterval(() => forceTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [state.running]);

  return deriveTiming(state, now);
}

function deriveTiming(state: TurnTimerState, now: () => number): TurnTiming {
  if (state.running && state.startedAt !== null) {
    return {
      running: true,
      elapsedMs: Math.max(0, now() - state.startedAt),
      lastDurationMs: state.lastDurationMs,
    };
  }
  return {
    running: false,
    elapsedMs: state.lastDurationMs,
    lastDurationMs: state.lastDurationMs,
  };
}
