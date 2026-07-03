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
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface KbBuildOptions {
  /** Per-run override of the KnowledgeBase root. Falls through to env / default. */
  kbRoot?: string;
  /** OCR provider preset (siliconflow | openai | anthropic | mistral | zhipu
   *  | qwen | custom). Sets defaults for base_url / model / prompt; the
   *  three individual fields below override that field-by-field. */
  ocrPreset?: string;
  /** OpenAI-compatible base URL for the OCR vision endpoint. */
  ocrBaseUrl?: string;
  /** Vision model id (e.g. "gpt-4o", "deepseek-ai/DeepSeek-OCR"). */
  ocrModel?: string;
  /** Custom instruction sent alongside each rendered page image. */
  ocrPrompt?: string;
  /** Bearer token for the OCR endpoint. */
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
  /** HuggingFace mirror URL for auto model download (e.g. https://hf-mirror.com). */
  hfMirror?: string;
}

export interface KbBuildEvent {
  ts: string;
  stage: string;
  event: string;
  msg: string;
  [key: string]: unknown;
}

export type Listener = (ev: KbBuildEvent) => void;

/** Independent job slot. Build / env-setup / model-download all use one of
 *  these. They can run concurrently — env-setup and model-download don't
 *  touch the same files, and build never overlaps with either because the
 *  build's setup precondition is that both prep jobs already finished. */
interface JobSlot {
  startedAt: number;
  proc: ChildProcess;
  doneAt?: number;
  exitCode?: number | null;
  error?: string;
}

interface Slots {
  build: JobSlot | null;
  envSetup: JobSlot | null;
  modelSetup: JobSlot | null;
}

/** Shared event bus. Every slot's stdout parses into events and lands here,
 *  so /kb/events keeps its single-SSE-stream contract and the frontend
 *  fans out by `ev.stage` at render time. */
interface EventBus {
  events: KbBuildEvent[];
  listeners: Set<Listener>;
}

const EVENT_BUFFER_CAP = 5_000; // last N events kept for the status panel

const SLOTS: Slots = { build: null, envSetup: null, modelSetup: null };
const BUS: EventBus = { events: [], listeners: new Set() };

/** Back-compat re-export: some diagnostic code path may still consult a
 *  "primary" run. Prefer `slotByKey` in new code. */
function anyActiveSlot(): JobSlot | null {
  return SLOTS.build ?? SLOTS.envSetup ?? SLOTS.modelSetup;
}

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
  try { rootCandidates.push(findKbRoot()); } catch { /* findKbRoot fallback */ }
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
  // OCR provider config — every field is optional; ocr_pdfs.py merges
  // CLI / env / API_config.json / preset defaults itself.
  //
  // NOTE: the API-key flags (--ocr-api-key, --meta-api-key) are
  // deliberately NOT pushed onto argv here — they get injected as env
  // vars in buildChildEnv() instead. Two reasons:
  //   1. argv lands in the OS process list (`ps` on Unix, Task Manager
  //      on Windows), so any local user could otherwise scrape the key
  //      while the build is running.
  //   2. spawnLog() below broadcasts `spawned <argv...>` as an SSE
  //      event, which is buffered for hundreds of events and rendered
  //      into the log panel DOM. A key on argv there = key in every
  //      SSE subscriber's browser and in every log screenshot.
  // Passing via env avoids both leaks; ocr_pdfs.py / extract_meta.py
  // already resolve those env vars as their 2nd-tier fallback.
  if (opts.ocrPreset) argv.push("--ocr-preset", opts.ocrPreset);
  if (opts.ocrBaseUrl) argv.push("--ocr-base-url", opts.ocrBaseUrl);
  if (opts.ocrModel) argv.push("--ocr-model", opts.ocrModel);
  if (opts.ocrPrompt) argv.push("--ocr-prompt", opts.ocrPrompt);
  if (opts.ocrConcurrency != null) argv.push("--ocr-concurrency", String(opts.ocrConcurrency));
  if (opts.ocrLimit != null) argv.push("--ocr-limit", String(opts.ocrLimit));
  if (opts.metaBaseUrl) argv.push("--meta-base-url", opts.metaBaseUrl);
  if (opts.metaModel) argv.push("--meta-model", opts.metaModel);
  if (opts.hfMirror) argv.push("--hf-mirror", opts.hfMirror);
  if (opts.only && opts.only.length) {
    argv.push("--only", ...opts.only);
  } else if (opts.skip && opts.skip.length) {
    for (const s of opts.skip) argv.push(`--skip-${s}`);
  }
  return argv;
}

/**
 * Compose the child process environment for a KB build, injecting API keys
 * as env vars instead of argv flags. See buildArgv() for the rationale.
 *
 * We use the generic ``OCR_API_KEY`` (rather than the preset-specific env
 * name like SILICONFLOW_API_KEY) so a mid-build preset change doesn't
 * require the caller to know which env var maps to which provider —
 * ocr_pdfs.py's resolver checks OCR_API_KEY after the preset-specific one,
 * so this always wins for the key coming from the UI.
 */
function buildChildEnv(opts: KbBuildOptions, root: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    BP_KB_ROOT: root,
    // BP_KB_PYTHON is set by the caller so both this env-injection path
    // and any other spawn share the same interpreter.
  };
  if (opts.ocrApiKey) env.OCR_API_KEY = opts.ocrApiKey;
  if (opts.metaApiKey) env.META_LLM_API_KEY = opts.metaApiKey;
  return env;
}

/**
 * Redact secret values in a copy of argv so it's safe to broadcast into an
 * SSE event / dump to a log file. Kept as a belt-and-braces defence: the
 * key flags are supposed to be routed through env vars (buildChildEnv) and
 * never end up on argv, but if a future contributor adds a new secret flag
 * and forgets, this catches it before the value hits every log listener.
 *
 * Matching strategy: any flag whose name contains "key", "token", "secret",
 * or "password" (case-insensitive) is treated as sensitive. Both
 * ``--api-key VALUE`` and ``--api-key=VALUE`` forms are handled.
 */
function redactArgvForLog(argv: readonly string[]): string[] {
  const secretPat = /(key|token|secret|password)/i;
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    // "--foo-key=sk-..." → mask the RHS.
    const eq = a.indexOf("=");
    if (a.startsWith("--") && eq > 0) {
      const name = a.slice(0, eq);
      const val = a.slice(eq + 1);
      if (secretPat.test(name) && val) {
        out.push(`${name}=***${val.slice(-4)}`);
        continue;
      }
    }
    // "--foo-key sk-..." → mask the NEXT argv item.
    if (a.startsWith("--") && secretPat.test(a) && i + 1 < argv.length) {
      const val = argv[i + 1]!;
      out.push(a, `***${val.slice(-4)}`);
      i++;
      continue;
    }
    out.push(a);
  }
  return out;
}

function broadcast(ev: KbBuildEvent): void {
  BUS.events.push(ev);
  if (BUS.events.length > EVENT_BUFFER_CAP) {
    BUS.events.splice(0, BUS.events.length - EVENT_BUFFER_CAP);
  }
  for (const l of BUS.listeners) {
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
 * Owns SLOTS.envSetup. Can run concurrently with startKbModelSetup (they
 * don't touch the same files); guarded against a second env-setup only.
 * Build refuses to start while env-setup is running via its own check
 * inside startKbBuild.
 *
 * The setup script is **pure stdlib Python**, so we deliberately do NOT
 * resolve via the venv (which doesn't exist yet). Priority for the
 * bootstrap interpreter:
 *   1. ``opts.python``     — explicit override from the UI
 *   2. ``BP_KB_PYTHON``    — env var (probably wrong here, but honour it)
 *   3. ``python3`` / ``python`` on PATH
 */
export function startKbEnvSetup(opts: {
  python?: string;
  reinstall?: boolean;
  kbRoot?: string;
  /** pip index URL to override the default (pypi.org). Passed via env so it
   *  doesn't show up in `ps` for corporate mirrors that carry tokens. */
  pipIndexUrl?: string;
} = {}): StartResult {
  if (SLOTS.envSetup && SLOTS.envSetup.doneAt == null) {
    return { ok: false, message: "Python environment setup is already running" };
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

  // Prefer env-based delivery over --pip-index-url flag for the same reason
  // hf_token uses env: `ps` doesn't show env, and tokenised corp mirrors
  // (`https://<token>@repo.corp/...`) would otherwise leak into the process
  // list. setup_env.py reads PIP_INDEX_URL when --pip-index-url is absent, so
  // this transparently wires up.
  const childEnv: NodeJS.ProcessEnv = { ...process.env, BP_KB_ROOT: root };
  if (opts.pipIndexUrl) childEnv.PIP_INDEX_URL = opts.pipIndexUrl;

  let proc: ChildProcess;
  try {
    proc = spawn(bootstrapPython, argv, {
      stdio: ["ignore", "pipe", "pipe"],
      env: childEnv,
    });
  } catch (err) {
    return {
      ok: false,
      message: `failed to spawn ${bootstrapPython}: ${(err as Error).message}`,
    };
  }

  const slot: JobSlot = { startedAt: Date.now(), proc };
  SLOTS.envSetup = slot;

  broadcast({
    ts: new Date().toISOString(),
    stage: "setup-env",
    event: "info",
    msg: `spawned ${bootstrapPython} ${redactArgvForLog(argv).join(" ")}`,
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
    slot.doneAt = Date.now();
    slot.exitCode = null;
    slot.error = err.message;
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
    slot.doneAt = Date.now();
    slot.exitCode = code;
    // A fresh venv means the deps probe cache is now stale — drop it so
    // the next /kb/status returns a fresh reading instead of the pre-install
    // "missing" result.
    PROBE_CACHE.clear();
  });

  return { ok: true, startedAt: slot.startedAt };
}

/**
 * Download the bge-m3 + bge-reranker-v2-m3 weights (~2.5 GB) via
 * ``scripts/setup_models.py``. Runs in its own SLOTS.modelSetup slot so it
 * can execute concurrently with setup_env — the two don't touch the same
 * files. Reuses the venv's Python if present (needed for huggingface_hub);
 * falls back to system Python otherwise (which will fail loudly if the
 * package isn't there, letting the operator know to run env setup first).
 */
export function startKbModelSetup(opts: { hfMirror?: string; hfToken?: string; kbRoot?: string } = {}): StartResult {
  if (SLOTS.modelSetup && SLOTS.modelSetup.doneAt == null) {
    return { ok: false, message: "model download is already running" };
  }
  const root = opts.kbRoot ? resolve(opts.kbRoot) : findKbRoot();
  const script = join(root, "scripts", "setup_models.py");
  if (!existsSync(script)) {
    return {
      ok: false,
      message: `setup_models.py not found at ${script}; is the KnowledgeBase tree intact?`,
    };
  }
  const py = pythonBin(root);
  const argv = [script, "--kb-root", root, "--json"];
  if (opts.hfMirror) argv.push("--hf-mirror", opts.hfMirror);
  // Deliberately do NOT push --hf-token to argv: it lands in the process list
  // (visible to any local user via `ps` and to any process-listing dashboard).
  // Passing via env keeps it in the child's environment block, which is
  // per-process and not surfaced by `ps` by default. setup_models.py resolves
  // HF_TOKEN when --hf-token is absent, so this transparently wires up.
  const childEnv: NodeJS.ProcessEnv = { ...process.env, BP_KB_ROOT: root, BP_KB_PYTHON: py };
  if (opts.hfToken) childEnv.HF_TOKEN = opts.hfToken;

  let proc: ChildProcess;
  try {
    proc = spawn(py, argv, {
      stdio: ["ignore", "pipe", "pipe"],
      env: childEnv,
    });
  } catch (err) {
    return {
      ok: false,
      message: `failed to spawn ${py}: ${(err as Error).message}`,
    };
  }

  const slot: JobSlot = { startedAt: Date.now(), proc };
  SLOTS.modelSetup = slot;

  broadcast({
    ts: new Date().toISOString(),
    stage: "setup-models",
    event: "info",
    msg: `spawned ${py} ${redactArgvForLog(argv).join(" ")}`,
  });

  pipeOutput(proc.stdout!);
  pipeOutput(proc.stderr!);

  proc.on("error", (err) => {
    broadcast({
      ts: new Date().toISOString(),
      stage: "setup-models",
      event: "error",
      msg: `failed to spawn: ${err.message}`,
    });
    slot.doneAt = Date.now();
    slot.exitCode = null;
    slot.error = err.message;
  });
  proc.on("exit", (code, signal) => {
    broadcast({
      ts: new Date().toISOString(),
      stage: "setup-models",
      event: code === 0 ? "done" : "error",
      msg:
        code === 0
          ? "models ready"
          : `setup-models exited code=${code} signal=${signal ?? ""}`,
      exit_code: code,
      signal,
    });
    slot.doneAt = Date.now();
    slot.exitCode = code;
    // Model files changed on disk — the probe stores a cached snapshot; drop
    // it so the panel's next status poll reflects the new completeness.
    PROBE_CACHE.clear();
  });

  return { ok: true, startedAt: slot.startedAt };
}

/**
 * One-click orchestration: start venv setup, then chain model download when
 * (and only when) the venv build exits 0. huggingface_hub lives inside the
 * venv, so kicking off model download before it exists would fail — the
 * chaining is required, not just a nice-to-have.
 *
 * Emits a synthetic ``setup-full`` info event so the frontend can display a
 * single "combined setup" banner and know when the whole thing is done.
 */
export function startKbFullSetup(
  opts: {
    python?: string;
    reinstall?: boolean;
    hfMirror?: string;
    hfToken?: string;
    pipIndexUrl?: string;
    kbRoot?: string;
  } = {},
): StartResult {
  if (SLOTS.envSetup && SLOTS.envSetup.doneAt == null) {
    return { ok: false, message: "Python environment setup is already running" };
  }
  if (SLOTS.modelSetup && SLOTS.modelSetup.doneAt == null) {
    return { ok: false, message: "model download is already running" };
  }
  broadcast({
    ts: new Date().toISOString(),
    stage: "setup-full",
    event: "info",
    msg: "starting Python env + model download (venv first, models will chain automatically on venv success)",
  });
  const envResult = startKbEnvSetup({
    python: opts.python,
    reinstall: opts.reinstall,
    kbRoot: opts.kbRoot,
    pipIndexUrl: opts.pipIndexUrl,
  });
  if (!envResult.ok) return envResult;

  // Chain: when the venv slot completes with code 0, kick off model download.
  // We install this listener now so it fires exactly once — subsequent
  // manual setupModels calls won't retrigger, and a non-zero venv exit
  // leaves modelSetup untouched (letting the operator retry after fixing
  // whatever broke venv creation).
  const chain: Listener = (ev) => {
    if (ev.stage !== "setup-env") return;
    if (ev.event !== "done" && ev.event !== "error") return;
    BUS.listeners.delete(chain);
    if (ev.event === "error") {
      broadcast({
        ts: new Date().toISOString(),
        stage: "setup-full",
        event: "error",
        msg: "venv setup failed; skipping model download",
      });
      return;
    }
    const modelResult = startKbModelSetup({
      hfMirror: opts.hfMirror,
      hfToken: opts.hfToken,
      kbRoot: opts.kbRoot,
    });
    if (!modelResult.ok) {
      broadcast({
        ts: new Date().toISOString(),
        stage: "setup-full",
        event: "error",
        msg: `venv done, but model download refused to start: ${modelResult.message}`,
      });
      return;
    }
    // Second listener: once model download finishes, emit the setup-full done.
    const doneChain: Listener = (ev2) => {
      if (ev2.stage !== "setup-models") return;
      if (ev2.event !== "done" && ev2.event !== "error") return;
      BUS.listeners.delete(doneChain);
      broadcast({
        ts: new Date().toISOString(),
        stage: "setup-full",
        event: ev2.event,
        msg: ev2.event === "done"
          ? "venv + models ready — knowledge base is ready to build"
          : "model download failed after venv completed",
      });
    };
    BUS.listeners.add(doneChain);
  };
  BUS.listeners.add(chain);

  return envResult;
}

export function startKbBuild(opts: KbBuildOptions = {}): StartResult {
  if (SLOTS.build && SLOTS.build.doneAt == null) {
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
  const kbRootAbs = opts.kbRoot ? resolve(opts.kbRoot) : env.kbRoot;
  const childEnv = {
    ...buildChildEnv(opts, kbRootAbs),
    // Make sure the build_kb.py orchestrator AND every stage it spawns
    // share the same interpreter — without this, each `subprocess.run`
    // call in build_kb.py would re-resolve via PATH and could land on a
    // different python (e.g. system python3 without our deps installed).
    BP_KB_PYTHON: py,
  };
  const proc = spawn(py, argv, {
    stdio: ["ignore", "pipe", "pipe"],
    env: childEnv,
  });

  const slot: JobSlot = { startedAt: Date.now(), proc };
  SLOTS.build = slot;

  // Banner so the SSE consumer sees something immediately. Argv is
  // redacted for the log (see redactArgvForLog) — the OCR / meta keys
  // are already routed via env vars in buildChildEnv, but this guards
  // against a future contributor adding a new secret flag on argv.
  broadcast({
    ts: new Date().toISOString(),
    stage: "build",
    event: "info",
    msg: `spawned ${py} ${redactArgvForLog(argv).join(" ")}`,
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
    slot.doneAt = Date.now();
    slot.exitCode = null;
    slot.error = err.message;
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
    slot.doneAt = Date.now();
    slot.exitCode = code;
  });

  return { ok: true, startedAt: slot.startedAt };
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
  /** venv-python `import` probe result. `null` = unknown / not yet checked. */
  depsInstalled: boolean | null;
  /** Names of REQUIRED_IMPORTS that failed to import. Empty when all ok. */
  depsMissing: string[];
  /** Free-form probe error (python crashed, ENOENT, timeout, ...) if any. */
  depsError?: string;
  /** Model weight completeness — same criterion setup_models.py uses. */
  models: {
    /** models/bge-m3 has config.json + a real weight file. */
    bgeM3: boolean;
    /** models/bge-reranker-v2-m3 has config.json + a real weight file. */
    bgeReranker: boolean;
  };
  /** Number of PDFs found under source/pdf/ — used by the "put PDFs first" hint. */
  pdfsPresent: number;
  /** Fully green: venv + deps + models all present. */
  readyToBuild: boolean;
  /** Epoch-ms when the deps/models probe was last run (for the UI's `X seconds ago` label). */
  probedAt: number | null;
}

/**
 * These have to stay in lock-step with ``scripts/setup_env.py::REQUIRED_IMPORTS``.
 * We import here again (rather than parse the python file at runtime) because
 * the check is intentionally cheap — a tiny stringified script sent to
 * ``python -c`` — and duplicating one string list is more robust than shelling
 * out to parse a source file whose format may change.
 */
const REQUIRED_PIPELINE_IMPORTS = [
  "fitz",              // OCR (PyMuPDF)
  "openai",            // OCR + extract_meta
  "numpy",
  "requests",
  "fastapi",
  "uvicorn",
  "pydantic",
  "huggingface_hub",   // setup_models.py
  "FlagEmbedding",     // vectorize + sidecar
];

/** Weight-file names that count as "download completed". Mirrors the check in
 *  scripts/setup_models.py — either safetensors or the legacy pytorch bin. */
const MODEL_WEIGHT_FILES = ["model.safetensors", "pytorch_model.bin"];

/** Result of a deps+models probe, cached in memory. */
interface ProbeResult {
  depsInstalled: boolean | null;
  depsMissing: string[];
  depsError?: string;
  models: { bgeM3: boolean; bgeReranker: boolean };
  probedAt: number;
  /** Interpreter path we probed with — invalidates when the venv is rebuilt. */
  python: string;
  /** mtime of the venv python binary — a rebuild bumps it, invalidating. */
  pythonMtime: number;
}

const PROBE_TTL_MS = 60_000; // 60 s — cheap enough to re-probe on demand, expensive enough to skip on every poll
const PROBE_CACHE = new Map<string, ProbeResult>();

/** Count the PDFs under ``<kbRoot>/source/pdf/``. Missing dir = 0.
 *  Used by the UI to hint "no PDFs yet — copy them into source/pdf/" before
 *  the user tries a build with nothing to ingest. */
function countPdfs(kbRoot: string): number {
  const pdfDir = join(kbRoot, "source", "pdf");
  try {
    return readdirSync(pdfDir).filter((name) => name.toLowerCase().endsWith(".pdf")).length;
  } catch {
    return 0;
  }
}

/** True iff ``<modelsDir>/<sub>`` looks like a completed HF download — same
 *  gate as setup_models.py so a partial download shows up as "not ready"
 *  everywhere consistently. */
function modelDirComplete(modelsDir: string, sub: string): boolean {
  const target = join(modelsDir, sub);
  if (!existsSync(join(target, "config.json"))) return false;
  return MODEL_WEIGHT_FILES.some((name) => existsSync(join(target, name)));
}

/**
 * Probe the venv python with a tiny `python -c 'import ...'` snippet, mirroring
 * setup_env.py's post-install verification. Returns an all-`null`s result when
 * we can't or shouldn't probe (no venv yet), so the UI can distinguish
 * "not-installed" from "not-yet-checked".
 *
 * Cached for PROBE_TTL_MS keyed by the python binary path. A `--reinstall`
 * that recreates the venv bumps the binary's mtime, so we detect that and
 * invalidate; the caller can also pass ``force=true`` to bypass the cache.
 */
function probeDepsAndModels(kbRoot: string, force: boolean): ProbeResult {
  const python = pythonBin(kbRoot);
  const modelsDir = join(kbRoot, "models");
  const models = {
    bgeM3: modelDirComplete(modelsDir, "bge-m3"),
    bgeReranker: modelDirComplete(modelsDir, "bge-reranker-v2-m3"),
  };

  // Detect the interpreter's mtime up-front so we can invalidate on rebuild.
  let pythonMtime = 0;
  try {
    pythonMtime = statSync(python).mtimeMs;
  } catch {
    // ENOENT — python doesn't exist. That's an unambiguous "not installed"
    // signal; we don't spawn, and cache a `depsInstalled = null` so the UI
    // says "no venv" and not "checking …".
    const result: ProbeResult = {
      depsInstalled: null,
      depsMissing: [],
      depsError: undefined,
      models,
      probedAt: Date.now(),
      python,
      pythonMtime: 0,
    };
    PROBE_CACHE.set(python, result);
    return result;
  }

  if (!force) {
    const cached = PROBE_CACHE.get(python);
    if (
      cached &&
      cached.python === python &&
      cached.pythonMtime === pythonMtime &&
      Date.now() - cached.probedAt < PROBE_TTL_MS
    ) {
      // Models can change between probes without touching the python binary,
      // so always re-scan the (cheap) filesystem for the two model dirs.
      return { ...cached, models };
    }
  }

  let depsInstalled: boolean | null;
  let depsMissing: string[] = [];
  let depsError: string | undefined;

  // The snippet: probe every import, report failures as JSON. Kept intentionally
  // minimal — same shape as setup_env.py::_verify_imports so a user reading
  // both files sees they agree.
  const snippet =
    "import importlib, json\n" +
    `required = ${JSON.stringify(REQUIRED_PIPELINE_IMPORTS)}\n` +
    "missing = []\n" +
    "for m in required:\n" +
    "    try: importlib.import_module(m)\n" +
    "    except Exception as e: missing.append([m, repr(e)[:200]])\n" +
    "print(json.dumps(missing))\n";
  try {
    const res = spawnSync(python, ["-c", snippet], {
      encoding: "utf8",
      timeout: 20_000, // 20 s is plenty; FlagEmbedding is the slowest import (~2-5 s cold).
    });
    if (res.error) {
      depsInstalled = null;
      depsError = res.error.message;
    } else if (res.status !== 0) {
      depsInstalled = null;
      depsError = `python exited ${res.status}: ${(res.stderr || "").trim().slice(0, 500)}`;
    } else {
      try {
        const parsed = JSON.parse((res.stdout || "").trim()) as Array<[string, string]>;
        depsMissing = parsed.map(([name]) => name);
        depsInstalled = depsMissing.length === 0;
      } catch (err) {
        depsInstalled = null;
        depsError = `parse failed: ${(err as Error).message}; stdout=${(res.stdout || "").slice(0, 200)}`;
      }
    }
  } catch (err) {
    depsInstalled = null;
    depsError = (err as Error).message;
  }

  const result: ProbeResult = {
    depsInstalled,
    depsMissing,
    depsError,
    models,
    probedAt: Date.now(),
    python,
    pythonMtime,
  };
  PROBE_CACHE.set(python, result);
  return result;
}

function describeKbEnvironment(kbRoot?: string, force = false): KbEnvironment {
  // Mirror defaultBuildScript()'s walk-up to find KnowledgeBase/.
  const root = kbRoot ?? findKbRoot();
  const expectedVenv =
    process.platform === "win32"
      ? join(root, ".venv", "Scripts", "python.exe")
      : join(root, ".venv", "bin", "python");
  const venvExists = existsSync(expectedVenv);
  const python = pythonBin(root);
  const pythonIsVenv = python === expectedVenv;

  // Only probe imports when we have SOMETHING to probe. If the venv doesn't
  // exist AND the user hasn't pointed BP_KB_PYTHON at an existing interpreter,
  // pythonBin() returns "python3"/"python" — spawning that would either fail
  // (deps not installed globally) or succeed by accident (they happen to have
  // FlagEmbedding system-wide), neither of which is useful information.
  const probeCandidate = venvExists || pythonIsVenv || Boolean(process.env.BP_KB_PYTHON);
  const probe = probeCandidate
    ? probeDepsAndModels(root, force)
    : {
        depsInstalled: null,
        depsMissing: [],
        depsError: undefined,
        models: {
          bgeM3: modelDirComplete(join(root, "models"), "bge-m3"),
          bgeReranker: modelDirComplete(join(root, "models"), "bge-reranker-v2-m3"),
        },
        probedAt: null as number | null,
      } as Pick<
        ProbeResult,
        "depsInstalled" | "depsMissing" | "depsError" | "models"
      > & { probedAt: number | null };

  const readyToBuild =
    venvExists &&
    probe.depsInstalled === true &&
    probe.models.bgeM3 &&
    probe.models.bgeReranker;

  return {
    python,
    pythonIsVenv,
    venvExists,
    expectedVenvPath: expectedVenv,
    scriptsPresent: existsSync(join(root, "scripts", "build_kb.py")),
    kbRoot: root,
    depsInstalled: probe.depsInstalled,
    depsMissing: probe.depsMissing,
    depsError: probe.depsError,
    models: probe.models,
    pdfsPresent: countPdfs(root),
    readyToBuild,
    probedAt: probe.probedAt,
  };
}

/**
 * Force a fresh probe of the deps + models. Used by the "Re-check" button
 * in the KB panel — bypasses the 60 s memoization so the user sees the
 * effect of a manual pip install or model download without waiting for the
 * TTL to elapse.
 */
export function probeKbEnvironment(kbRoot?: string): KbEnvironment {
  return describeKbEnvironment(kbRoot, true);
}

export function findKbRoot(): string {
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
  // "Active" now means "any slot is running" — build, env-setup, or model-
  // download. The frontend already fans out on ev.stage for UI display, so
  // this rollup is just used for the "reopened the panel mid-run" banner.
  const active = anyActiveSlot();
  const primary = SLOTS.build ?? SLOTS.envSetup ?? SLOTS.modelSetup;
  if (!primary) {
    return {
      active: false,
      startedAt: null,
      finishedAt: null,
      exitCode: undefined,
      recentEvents: BUS.events.slice(-200),
      environment,
    };
  }
  return {
    active: active !== null && active.doneAt == null,
    startedAt: primary.startedAt,
    finishedAt: primary.doneAt ?? null,
    exitCode: primary.exitCode,
    error: primary.error,
    // Last ~200 events across every slot — the SSE stream is the primary
    // surface; this is for a panel that has just been opened and wants
    // enough context to replay the recent progress.
    recentEvents: BUS.events.slice(-200),
    environment,
  };
}

export interface SubscribeHandle {
  unsubscribe: () => void;
  /** Replay of buffered events for late subscribers. */
  history: KbBuildEvent[];
  /** Resolves when every active slot finishes (or immediately if none is running). */
  done: Promise<void>;
}

export function subscribeKbBuild(listener: Listener): SubscribeHandle {
  BUS.listeners.add(listener);
  const history = [...BUS.events];
  const done = anyActiveSlot() == null
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        const check = () => {
          const slot = anyActiveSlot();
          if (slot == null || slot.doneAt != null) {
            // "All idle" — no need to keep polling.
            const anyRunning =
              (SLOTS.build && SLOTS.build.doneAt == null) ||
              (SLOTS.envSetup && SLOTS.envSetup.doneAt == null) ||
              (SLOTS.modelSetup && SLOTS.modelSetup.doneAt == null);
            if (!anyRunning) {
              resolve();
              return;
            }
          }
          setTimeout(check, 200);
        };
        check();
      });
  return {
    unsubscribe: () => BUS.listeners.delete(listener),
    history,
    done,
  };
}

export function cancelKbBuild(): { ok: boolean; message?: string } {
  // Cancel every active slot — the user has one "Cancel" button in the UI
  // and expects it to stop whatever's currently running. Order: build
  // first (most likely target), then setup jobs.
  const targets: JobSlot[] = [];
  if (SLOTS.build && SLOTS.build.doneAt == null) targets.push(SLOTS.build);
  if (SLOTS.envSetup && SLOTS.envSetup.doneAt == null) targets.push(SLOTS.envSetup);
  if (SLOTS.modelSetup && SLOTS.modelSetup.doneAt == null) targets.push(SLOTS.modelSetup);
  if (!targets.length) {
    return { ok: false, message: "no active job to cancel" };
  }
  const errs: string[] = [];
  for (const t of targets) {
    try {
      t.proc.kill("SIGTERM");
    } catch (err) {
      errs.push((err as Error).message);
    }
  }
  return errs.length ? { ok: false, message: errs.join("; ") } : { ok: true };
}
