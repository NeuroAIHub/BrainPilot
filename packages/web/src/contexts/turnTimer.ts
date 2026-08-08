/**
 * turnTimer — derive a "whole-turn" wall-clock duration for the Chat footer
 * ("本轮对话用时"), issue #99.
 *
 * A turn is NOT a single assistant message. It spans from the user's input
 * until all session work has finished — i.e. authoritative `workState.active`
 * goes false and STAYS false.
 *
 * The subtlety (#99): `workState.active` can briefly flip true→false→true when a
 * turn ends and a hook / system message / queued task event immediately
 * re-wakes an agent. That mid-flap `false` is NOT the end of the turn. So we
 * debounce the terminal transition with a settle window: a false only counts as
 * the turn's end once it has held for `settleMs`. If `active` goes true again
 * inside the window, the candidate end is discarded and the same turn continues.
 *
 * This reducer is pure and driven entirely by authoritative backend signals
 * (`workState.active` + the event's ISO timestamp). The host attaches the settle
 * timer and a live "ticking" clock for the running display.
 */

export interface TurnTimerState {
  /** ms epoch when the current turn started (user input / first active=true). */
  startedAt: number | null;
  /** Whether a turn is currently in progress (active, or within settle window). */
  running: boolean;
  /** Pending terminal end: active went false, awaiting settle confirmation. */
  candidateEndAt: number | null;
  /** The last settled whole-turn duration in ms, or null if none yet. */
  lastDurationMs: number | null;
}

export const initialTurnTimerState: TurnTimerState = {
  startedAt: null,
  running: false,
  candidateEndAt: null,
  lastDurationMs: null,
};

export type TurnTimerEvent =
  /** Authoritative runState.active snapshot at time `atMs` (from session_state). */
  | { type: "active"; value: boolean; atMs: number }
  /** The settle window elapsed with active still false → commit the turn end. */
  | { type: "settle" }
  /** A fresh user submission opens a new turn at `atMs` (optimistic start). */
  | { type: "userInput"; atMs: number }
  /** Session switch / reset — clear all timing. */
  | { type: "reset" };

/**
 * Advance the turn-timer state machine. Pure: returns the next state. The host
 * is responsible for (re)arming the settle timer whenever `candidateEndAt`
 * becomes non-null, and dispatching `{type:"settle"}` after `settleMs`.
 */
export function turnTimerReducer(state: TurnTimerState, event: TurnTimerEvent): TurnTimerState {
  switch (event.type) {
    case "reset":
      return initialTurnTimerState;

    case "userInput": {
      // Opening (or continuing) a turn from the user side. If a turn is already
      // running, keep its original start; otherwise begin a new one. Clears any
      // stale candidate end.
      if (state.running && state.startedAt !== null) {
        return { ...state, candidateEndAt: null };
      }
      return {
        startedAt: event.atMs,
        running: true,
        candidateEndAt: null,
        lastDurationMs: state.lastDurationMs,
      };
    }

    case "active": {
      if (event.value) {
        // active=true: turn is (still) running. Cancel any pending end. Seed a
        // start if the user-input optimistic open was missed (e.g. reconnect).
        return {
          startedAt: state.startedAt ?? event.atMs,
          running: true,
          candidateEndAt: null,
          lastDurationMs: state.lastDurationMs,
        };
      }
      // active=false: candidate terminal transition. Only meaningful if a turn
      // is in progress. Record the candidate end; the host arms the settle
      // timer. A re-wake (active=true) before settle discards this.
      if (!state.running || state.startedAt === null) return state;
      return { ...state, candidateEndAt: event.atMs };
    }

    case "settle": {
      // Settle window held with active false → commit the whole-turn duration.
      if (state.candidateEndAt === null || state.startedAt === null) return state;
      const duration = Math.max(0, state.candidateEndAt - state.startedAt);
      return {
        startedAt: null,
        running: false,
        candidateEndAt: null,
        lastDurationMs: duration,
      };
    }

    default:
      return state;
  }
}
