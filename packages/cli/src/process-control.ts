/**
 * process-control.ts — pid file lifecycle for detached `up` + `down`/`status`
 * (TS_PI_REFACTOR_DESIGN §11A.5). Pure-ish: process probing/signalling is
 * injectable so tests run against a fake process table.
 */
import { writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export interface ProcessControlDeps {
  /** Probe liveness. Defaults to `process.kill(pid, 0)`. */
  isAlive?: (pid: number) => boolean;
  /** Send a signal. Defaults to `process.kill`. */
  signal?: (pid: number, sig: NodeJS.Signals) => void;
  /** Sleep impl (injectable for tests). */
  sleep?: (ms: number) => Promise<void>;
}

const realIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH = no such process; EPERM = exists but not ours (treat as alive).
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
};

const realSignal = (pid: number, sig: NodeJS.Signals): void => {
  process.kill(pid, sig);
};

const realSleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/** Write a pid to a file, creating parent dirs. */
export async function writePid(pidFile: string, pid: number): Promise<void> {
  await mkdir(dirname(pidFile), { recursive: true });
  await writeFile(pidFile, String(pid), "utf8");
}

/** Read a pid from a file, or null if missing/unparseable. */
export async function readPid(pidFile: string): Promise<number | null> {
  try {
    const raw = (await readFile(pidFile, "utf8")).trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** Remove a pid file (no error if absent). */
export async function removePid(pidFile: string): Promise<void> {
  await rm(pidFile, { force: true });
}

/** Is the process recorded in `pidFile` currently alive? */
export async function isRunning(
  pidFile: string,
  deps: ProcessControlDeps = {},
): Promise<boolean> {
  const pid = await readPid(pidFile);
  if (pid === null) return false;
  return (deps.isAlive ?? realIsAlive)(pid);
}

export interface StopResult {
  /** Was a live process found and stopped (or already gone)? */
  stopped: boolean;
  /** The pid that was targeted, if any. */
  pid: number | null;
  /** True if SIGKILL was needed after SIGTERM timed out. */
  forced: boolean;
}

/**
 * Gracefully stop the process recorded in `pidFile`: SIGTERM, wait up to
 * `timeoutMs`, then SIGKILL. Removes the pid file afterward.
 */
export async function stop(
  pidFile: string,
  options: { timeoutMs?: number; pollMs?: number } & ProcessControlDeps = {},
): Promise<StopResult> {
  const isAlive = options.isAlive ?? realIsAlive;
  const signal = options.signal ?? realSignal;
  const sleep = options.sleep ?? realSleep;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const pollMs = options.pollMs ?? 100;

  const pid = await readPid(pidFile);
  if (pid === null) {
    return { stopped: false, pid: null, forced: false };
  }
  if (!isAlive(pid)) {
    await removePid(pidFile);
    return { stopped: true, pid, forced: false };
  }

  try {
    signal(pid, "SIGTERM");
  } catch {
    // process vanished between probe and signal — treat as stopped.
    await removePid(pidFile);
    return { stopped: true, pid, forced: false };
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) {
      await removePid(pidFile);
      return { stopped: true, pid, forced: false };
    }
    await sleep(pollMs);
  }

  // Still alive — force kill.
  let forced = false;
  try {
    signal(pid, "SIGKILL");
    forced = true;
  } catch {
    // already gone
  }
  await removePid(pidFile);
  return { stopped: true, pid, forced };
}
