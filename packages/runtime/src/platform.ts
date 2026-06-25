/**
 * platform.ts — single source of truth for cross-platform branch logic.
 *
 * Centralizes `process.platform` checks so callers consume semantic constants
 * (`isWindows`, `gracefulSignalsSupported`) instead of scattering raw string
 * comparisons (`process.platform === "win32"`) across the codebase. Re-exported
 * from `@brainpilot/runtime` so `backend-core` and the CLI consume the same
 * helpers without duplicating the detection.
 *
 * Resolved once at module load; we never observe `process.platform` mutating
 * inside a single Node process, so caching as `const` is safe and lets V8
 * fold the branches.
 */

const platform = process.platform;

/** True when running on Windows (`win32`). Use this instead of literal compares. */
export const isWindows = platform === "win32";

/** True on macOS / Darwin. */
export const isMacOS = platform === "darwin";

/** True on Linux. */
export const isLinux = platform === "linux";

/**
 * Whether the OS surfaces graceful POSIX signals (SIGINT/SIGTERM) to a Node
 * child process via `process.kill` / `child.kill`. On Windows, Node maps any
 * inter-process signal to `TerminateProcess`, which is a forceful kill that
 * the target process cannot intercept — so a `SIGTERM` issued to a Windows
 * BrainPilot server will NOT run the registered handlers, and any code that
 * waits for "graceful exit" after SIGTERM will time out for no reason.
 *
 * Callers should use this to short-circuit the SIGTERM-then-wait path on
 * Windows and proceed straight to the force-kill code.
 */
export const gracefulSignalsSupported = !isWindows;
