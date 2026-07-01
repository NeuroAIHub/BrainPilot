/**
 * Single-user knowledge-base build orchestrator.
 *
 * Spawns ``KnowledgeBase/scripts/build_kb.py --json`` and exposes:
 *   - POST   /api/kb/build   start a run (returns immediately)
 *   - GET    /api/kb/status  current run state
 *   - GET    /api/kb/events  SSE — live stream of NDJSON events from the child
 *   - POST   /api/kb/cancel  best-effort SIGTERM
 *
 * Only one build is allowed at a time across the whole process. A new POST
 * while a run is active 409s — that's the right behaviour because every run
 * mutates the same on-disk files and a second concurrent run would corrupt
 * the OCRed_pdf.json ledger.
 *
 * The child's stdout is line-buffered and parsed as NDJSON. Anything that
 * doesn't parse is forwarded as a `{event: "log", msg: <line>}` so stray
 * prints from a dependency don't drop on the floor.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface KbBuildOptions {
  /** Per-run override of the KnowledgeBase root. Falls through to env / default. */
  kbRoot?: string;
  /** SiliconFlow API key for OCR; forwarded as --ocr-api-key. */
  ocrApiKey?: string;
  /** Per-PDF concurrency; forwarded as --ocr-concurrency. */
  ocrConcurrency?: number;
  /** Cap on number of PDFs (smoke testing). */
  ocrLimit?: number;
  /** Metadata-extraction LLM credentials (OpenAI-compatible). */
  metaApiKey?: string;
  metaBaseUrl?: string;
  metaModel?: string;
  /** Stages to skip; mutually exclusive with `only`. */
  skip?: Array<"ocr" | "extract" | "chunk" | "vectorize">;
  /** Stages to run (overrides skip). */
  only?: Array<"ocr" | "extract" | "chunk" | "vectorize">;
}

export interface KbBuildEvent {
  ts: string;
  stage: string;
  event: string;
  msg: string;
  [key: string]: unknown;
}

export type Listener = (ev: KbBuildEvent) => void;

interface ActiveRun {
  startedAt: number;
  proc: ChildProcess;
  events: KbBuildEvent[];
  listeners: Set<Listener>;
  doneAt?: number;
  exitCode?: number | null;
  error?: string;
}

const EVENT_BUFFER_CAP = 5_000; // last N events kept for the status panel

let RUN: ActiveRun | null = null;

/**
 * Resolve the Python interpreter the build pipeline subprocess will run as.
 *
 * Priority (kept in lock-step with packages/runtime/src/tools/kb/python.ts —
 * we duplicate here rather than importing across packages, so backend-core
 * stays free of a runtime dependency):
 *
 *   1. ``BP_KB_PYTHON``                   — explicit override
 *   2. ``<kbRoot>/.venv/bin/python``      — venv created by setup_env.sh
 *      (``<kbRoot>\.venv\Scripts\python.exe`` on Windows)
 *   3. ``PYTHON`` env var
 *   4. ``python3`` (Unix) / ``python`` (Windows) on PATH
 *
 * If `kbRoot` is undefined we still check `process.cwd()/KnowledgeBase/.venv`
 * which catches the common "ran build_kb.py from the repo root" case.
 */
function pythonBin(kbRoot?: string): string {
  const override = process.env.BP_KB_PYTHON?.trim();
  if (override) return override;
  const rootCandidates: string[] = [];
  if (kbRoot) rootCandidates.push(kbRoot);
  rootCandidates.push(join(process.cwd(), "KnowledgeBase"));
  for (const root of rootCandidates) {
    const venvPython =
      process.platform === "win32"
        ? join(root, ".venv", "Scripts", "python.exe")
        : join(root, ".venv", "bin", "python");
    if (existsSync(venvPython)) return venvPython;
  }
  const pyEnv = process.env.PYTHON?.trim();
  if (pyEnv) return pyEnv;
  return process.platform === "win32" ? "python" : "python3";
}

function defaultBuildScript(): string {
  if (process.env.BP_KB_BUILD_SCRIPT) return process.env.BP_KB_BUILD_SCRIPT;
  return join(findKbRoot(), "scripts", "build_kb.py");
}

function buildArgv(opts: KbBuildOptions, script: string): string[] {
  const argv = [script, "--json"];
  if (opts.kbRoot) argv.push("--kb-root", opts.kbRoot);
  if (opts.ocrApiKey) argv.push("--ocr-api-key", opts.ocrApiKey);
  if (opts.ocrConcurrency != null) argv.push("--ocr-concurrency", String(opts.ocrConcurrency));
  if (opts.ocrLimit != null) argv.push("--ocr-limit", String(opts.ocrLimit));
  if (opts.metaApiKey) argv.push("--meta-api-key", opts.metaApiKey);
  if (opts.metaBaseUrl) argv.push("--meta-base-url", opts.metaBaseUrl);
  if (opts.metaModel) argv.push("--meta-model", opts.metaModel);
  if (opts.only && opts.only.length) {
    argv.push("--only", ...opts.only);
  } else if (opts.skip && opts.skip.length) {
    for (const s of opts.skip) argv.push(`--skip-${s}`);
  }
  return argv;
}

function broadcast(ev: KbBuildEvent): void {
  if (!RUN) return;
  RUN.events.push(ev);
  if (RUN.events.length > EVENT_BUFFER_CAP) {
    RUN.events.splice(0, RUN.events.length - EVENT_BUFFER_CAP);
  }
  for (const l of RUN.listeners) {
    try {
      l(ev);
    } catch {
      /* one bad listener should not block the rest */
    }
  }
}

function parseLine(line: string): KbBuildEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const ev = JSON.parse(trimmed) as KbBuildEvent;
      if (typeof ev.stage === "string" && typeof ev.event === "string") return ev;
    } catch {
      /* fall through to log */
    }
  }
  return {
    ts: new Date().toISOString(),
    stage: "log",
    event: "log",
    msg: trimmed,
  };
}

function pipeOutput(stream: NodeJS.ReadableStream): void {
  let buf = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    buf += chunk;
    let idx: number;
    while ((idx = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      const ev = parseLine(line);
      if (ev) broadcast(ev);
    }
  });
  stream.on("end", () => {
    if (buf.trim()) {
      const ev = parseLine(buf);
      if (ev) broadcast(ev);
    }
  });
}

export interface StartResult {
  ok: boolean;
  message?: string;
  startedAt?: number;
}

/**
 * Bootstrap the KnowledgeBase Python venv via ``scripts/setup_env.py``.
 *
 * Shares the same RUN slot as ``startKbBuild`` — at most one Python job is
 * allowed at a time. This is intentional: the build needs the venv to exist
 * first, and the SSE stream is single-channel.
 *
 * The setup script is **pure stdlib Python**, so we deliberately do NOT
 * resolve via the venv (which doesn't exist yet). Priority for the
 * bootstrap interpreter:
 *   1. ``opts.python``     — explicit override from the UI
 *   2. ``BP_KB_PYTHON``    — env var (probably wrong here, but honour it)
 *   3. ``python3`` / ``python`` on PATH
 */
export function startKbEnvSetup(opts: { python?: string; reinstall?: boolean; kbRoot?: string } = {}): StartResult {
  if (RUN && RUN.doneAt == null) {
    return { ok: false, message: "another knowledge-base job is already running" };
  }
  const root = opts.kbRoot ? resolve(opts.kbRoot) : findKbRoot();
  const script = join(root, "scripts", "setup_env.py");
  if (!existsSync(script)) {
    return {
      ok: false,
      message: `setup_env.py not found at ${script}; is the KnowledgeBase tree intact?`,
    };
  }
  const bootstrapPython =
    opts.python?.trim() ||
    process.env.BP_KB_PYTHON?.trim() ||
    (process.platform === "win32" ? "python" : "python3");

  const argv = [script, "--kb-root", root, "--json"];
  if (opts.reinstall) argv.push("--reinstall");
  if (opts.python) argv.push("--python", opts.python);

  let proc: ChildProcess;
  try {
    proc = spawn(bootstrapPython, argv, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, BP_KB_ROOT: root },
    });
  } catch (err) {
    return {
      ok: false,
      message: `failed to spawn ${bootstrapPython}: ${(err as Error).message}`,
    };
  }

  RUN = {
    startedAt: Date.now(),
    proc,
    events: [],
    listeners: new Set(),
  };

  broadcast({
    ts: new Date().toISOString(),
    stage: "setup-env",
    event: "info",
    msg: `spawned ${bootstrapPython} ${argv.join(" ")}`,
  });

  pipeOutput(proc.stdout!);
  pipeOutput(proc.stderr!);

  proc.on("error", (err) => {
    broadcast({
      ts: new Date().toISOString(),
      stage: "setup-env",
      event: "error",
      msg: `failed to spawn: ${err.message}`,
    });
    if (RUN) {
      RUN.doneAt = Date.now();
      RUN.exitCode = null;
      RUN.error = err.message;
    }
  });
  proc.on("exit", (code, signal) => {
    broadcast({
      ts: new Date().toISOString(),
      stage: "setup-env",
      event: code === 0 ? "done" : "error",
      msg:
        code === 0
          ? "venv ready"
          : `setup-env exited code=${code} signal=${signal ?? ""}`,
      exit_code: code,
      signal,
    });
    if (RUN) {
      RUN.doneAt = Date.now();
      RUN.exitCode = code;
    }
  });

  return { ok: true, startedAt: RUN.startedAt };
}

export function startKbBuild(opts: KbBuildOptions = {}): StartResult {
  if (RUN && RUN.doneAt == null) {
    return { ok: false, message: "a knowledge-base build is already running" };
  }
  const script = defaultBuildScript();
  if (!existsSync(script)) {
    return {
      ok: false,
      message: `build script not found at ${script}; set BP_KB_BUILD_SCRIPT or ensure KnowledgeBase/ ships with the install.`,
    };
  }
  // If neither BP_KB_PYTHON nor the bundled venv is available, refuse rather
  // than spawning a "python3 not found" failure halfway through. PATH-only
  // python3 can still work, but the user's pip-installed deps then need to
  // be system-wide — almost certainly not what they want.
  const env = describeKbEnvironment(opts.kbRoot);
  if (!process.env.BP_KB_PYTHON && !env.venvExists) {
    return {
      ok: false,
      message:
        `Python venv not found at ${env.expectedVenvPath}. ` +
        `Run "bash ${join(env.kbRoot, "scripts", "setup_env.sh")}" first ` +
        `(or set BP_KB_PYTHON to point at a Python with the requirements.txt deps installed).`,
    };
  }
  const argv = buildArgv(opts, script);
  const py = pythonBin(opts.kbRoot);
  const proc = spawn(py, argv, {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...(opts.kbRoot ? { BP_KB_ROOT: resolve(opts.kbRoot) } : {}),
      // Make sure the build_kb.py orchestrator AND every stage it spawns
      // share the same interpreter — without this, each `subprocess.run`
      // call in build_kb.py would re-resolve via PATH and could land on a
      // different python (e.g. system python3 without our deps installed).
      BP_KB_PYTHON: py,
    },
  });

  RUN = {
    startedAt: Date.now(),
    proc,
    events: [],
    listeners: new Set(),
  };

  // Banner so the SSE consumer sees something immediately.
  broadcast({
    ts: new Date().toISOString(),
    stage: "build",
    event: "info",
    msg: `spawned ${py} ${argv.join(" ")}`,
  });

  pipeOutput(proc.stdout!);
  pipeOutput(proc.stderr!);

  proc.on("error", (err) => {
    broadcast({
      ts: new Date().toISOString(),
      stage: "build",
      event: "error",
      msg: `failed to spawn: ${err.message}`,
    });
    if (RUN) {
      RUN.doneAt = Date.now();
      RUN.exitCode = null;
      RUN.error = err.message;
    }
  });
  proc.on("exit", (code, signal) => {
    broadcast({
      ts: new Date().toISOString(),
      stage: "build",
      event: code === 0 ? "done" : "error",
      msg: code === 0
        ? "build finished successfully"
        : `build exited code=${code} signal=${signal ?? ""}`,
      exit_code: code,
      signal,
    });
    if (RUN) {
      RUN.doneAt = Date.now();
      RUN.exitCode = code;
    }
  });

  return { ok: true, startedAt: RUN.startedAt };
}

export interface KbBuildStatus {
  active: boolean;
  startedAt: number | null;
  finishedAt: number | null;
  exitCode: number | null | undefined;
  error?: string;
  recentEvents: KbBuildEvent[];
  /** Diagnostic info the UI shows in the panel BEFORE a build starts. */
  environment: KbEnvironment;
}

export interface KbEnvironment {
  /** Absolute path to the python the build will use. */
  python: string;
  /** True if the chosen python is the bundled venv (recommended). */
  pythonIsVenv: boolean;
  /** Did setup_env.sh ever finish? */
  venvExists: boolean;
  /** Path to the bundled venv even if it doesn't exist yet (for the UI hint). */
  expectedVenvPath: string;
  /** True iff the four pipeline scripts + the orchestrator are all present. */
  scriptsPresent: boolean;
  /** Resolved KnowledgeBase root the backend will use by default. */
  kbRoot: string;
}

function describeKbEnvironment(kbRoot?: string): KbEnvironment {
  // Mirror defaultBuildScript()'s walk-up to find KnowledgeBase/.
  const root = kbRoot ?? findKbRoot();
  const expectedVenv =
    process.platform === "win32"
      ? join(root, ".venv", "Scripts", "python.exe")
      : join(root, ".venv", "bin", "python");
  const venvExists = existsSync(expectedVenv);
  const python = pythonBin(root);
  return {
    python,
    pythonIsVenv: python === expectedVenv,
    venvExists,
    expectedVenvPath: expectedVenv,
    scriptsPresent: existsSync(join(root, "scripts", "build_kb.py")),
    kbRoot: root,
  };
}

function findKbRoot(): string {
  if (process.env.BP_KB_ROOT?.trim()) return resolve(process.env.BP_KB_ROOT.trim());
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "KnowledgeBase");
    if (existsSync(join(candidate, "scripts", "build_kb.py"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return join(process.cwd(), "KnowledgeBase");
}

export function getKbBuildStatus(): KbBuildStatus {
  const environment = describeKbEnvironment();
  if (!RUN) {
    return {
      active: false,
      startedAt: null,
      finishedAt: null,
      exitCode: undefined,
      recentEvents: [],
      environment,
    };
  }
  return {
    active: RUN.doneAt == null,
    startedAt: RUN.startedAt,
    finishedAt: RUN.doneAt ?? null,
    exitCode: RUN.exitCode,
    error: RUN.error,
    // Last ~200 events — the SSE stream is the primary surface; this is for
    // a panel that has just been opened and wants context.
    recentEvents: RUN.events.slice(-200),
    environment,
  };
}

export interface SubscribeHandle {
  unsubscribe: () => void;
  /** Replay of buffered events for late subscribers. */
  history: KbBuildEvent[];
  /** Resolves when the current run finishes (or immediately if no active run). */
  done: Promise<void>;
}

export function subscribeKbBuild(listener: Listener): SubscribeHandle {
  if (!RUN) {
    return {
      unsubscribe: () => {},
      history: [],
      done: Promise.resolve(),
    };
  }
  RUN.listeners.add(listener);
  const history = [...RUN.events];
  const done = RUN.doneAt != null
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        const check = () => {
          if (!RUN || RUN.doneAt != null) {
            resolve();
          } else {
            setTimeout(check, 200);
          }
        };
        check();
      });
  return {
    unsubscribe: () => RUN?.listeners.delete(listener),
    history,
    done,
  };
}

export function cancelKbBuild(): { ok: boolean; message?: string } {
  if (!RUN || RUN.doneAt != null) {
    return { ok: false, message: "no active build to cancel" };
  }
  try {
    RUN.proc.kill("SIGTERM");
    return { ok: true };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}
