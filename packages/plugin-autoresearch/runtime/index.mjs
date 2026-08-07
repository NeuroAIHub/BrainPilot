const STATE_FILE = "session.json";
const RUNS_FILE = "runs.jsonl";
const MAX_ITERATIONS = 30;
const MAX_DURATION_MS = 2 * 60 * 60 * 1000;
const MAX_COMMAND_MS = 10 * 60 * 1000;
const MAX_CONSECUTIVE_FAILURES = 20;

const text = (value, details = {}) => ({ content: [{ type: "text", text: value }], details });
const error = (value) => ({ ...text(value), isError: true });
const objectSchema = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });

function metricFrom(output, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...output.matchAll(new RegExp(`^METRIC\\s+${escaped}=([^\\s]+)\\s*$`, "gm"))];
  if (!matches.length) return undefined;
  const value = Number(matches.at(-1)[1]);
  return Number.isFinite(value) ? value : undefined;
}

function isBetter(value, best, direction) {
  return direction === "higher" ? value > best : value < best;
}

function matchesScope(path, patterns) {
  const normalized = path.replaceAll("\\", "/");
  return patterns.some((raw) => {
    const pattern = raw.replaceAll("\\", "/").replace(/^\.\//, "");
    if (pattern.endsWith("/**")) return normalized === pattern.slice(0, -3) || normalized.startsWith(pattern.slice(0, -2));
    if (pattern.endsWith("*")) return normalized.startsWith(pattern.slice(0, -1));
    return normalized === pattern;
  });
}

function publicState(state) {
  if (!state) return { status: "idle" };
  const accepted = state.runs.filter((run) => run.status === "accepted").length;
  const discarded = state.runs.filter((run) => run.status === "discarded").length;
  const failed = state.runs.filter((run) => run.status === "crashed" || run.status === "checks_failed" || run.status === "scope_failed").length;
  return {
    status: state.status,
    objective: state.contract.objective,
    metricName: state.contract.metricName,
    direction: state.contract.direction,
    baselineMetric: state.baselineMetric,
    bestMetric: state.bestMetric,
    bestCheckpointId: state.bestCheckpointId,
    finalCheckpointId: state.finalCheckpointId,
    verifiedMetric: state.verifiedMetric,
    iterations: state.runs.length,
    accepted,
    discarded,
    failed,
    maxIterations: state.contract.maxIterations,
    expiresAt: new Date(state.startedAt + state.contract.maxDurationMs).toISOString(),
    lastError: state.lastError,
  };
}

export default async function autoresearch(context) {
  const load = async () => context.storage.readJson(STATE_FILE);
  const save = async (state) => {
    state.updatedAt = Date.now();
    await context.storage.writeJson(STATE_FILE, state);
    context.emit("autoresearch_state", publicState(state));
  };
  const restore = async (checkpointId) => {
    const preview = await context.checkpoints.preview(checkpointId);
    if (!preview) throw new Error(`checkpoint is not restorable: ${checkpointId}`);
    if (preview.files.length) await context.checkpoints.restore(checkpointId, preview.stateToken);
  };
  const ensureLease = (state) => {
    if (!context.workspaceLease.owned() && !context.workspaceLease.acquire()) {
      throw new Error("workspace is leased by another agent");
    }
    if (state.status === "paused") state.status = "running";
  };
  const recoverPending = async (state) => {
    if (!state.pendingResult && !state.iterationOpen) return;
    await restore(state.parentCheckpointId);
    state.pendingResult = undefined;
    state.iterationOpen = false;
    state.lastError = "Interrupted candidate was restored before resuming.";
    await save(state);
  };
  const budgetReason = (state) => {
    if (state.runs.length >= state.contract.maxIterations) return "maximum iterations reached";
    if (Date.now() - state.startedAt >= state.contract.maxDurationMs) return "maximum duration reached";
    if (state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) return "consecutive failure limit reached";
    return undefined;
  };

  // Rehydrate an interrupted worker before its next model turn. Keeping the
  // lease at activation prevents another agent from building on a half-applied
  // candidate while the worker decides what to do next.
  const persisted = await load();
  if (persisted?.status === "running") {
    try {
      ensureLease(persisted);
      await recoverPending(persisted);
    } catch (cause) {
      persisted.status = "paused";
      persisted.lastError = cause instanceof Error ? cause.message : String(cause);
      context.workspaceLease.release();
      await save(persisted);
    }
  }

  return (pi) => {
    pi.registerTool({
      name: "autoresearch_init",
      label: "Initialize Autoresearch",
      description: "Create a bounded measured optimization session and acquire the workspace lease. Call before editing files.",
      parameters: objectSchema({
        objective: { type: "string", minLength: 1 },
        benchmarkCommand: { type: "string", minLength: 1 },
        metricName: { type: "string", pattern: "^[A-Za-z0-9_.µ-]+$" },
        direction: { type: "string", enum: ["lower", "higher"] },
        editablePaths: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
        checksCommand: { type: "string" },
        maxIterations: { type: "integer", minimum: 1, maximum: 30 },
        maxDurationMinutes: { type: "integer", minimum: 1, maximum: 120 },
        commandTimeoutSeconds: { type: "integer", minimum: 1, maximum: 600 },
        verificationTolerancePercent: { type: "number", minimum: 0, maximum: 100 },
      }, ["objective", "benchmarkCommand", "metricName", "direction", "editablePaths"]),
      async execute(_id, params) {
        const existing = await load();
        if (existing?.status === "running" || existing?.status === "paused") return error("An autoresearch session already exists; finish or stop it first.");
        if (!context.workspaceLease.acquire()) return error("Workspace is leased by another agent.");
        const checkpoint = await context.checkpoints.capture("experiment-best");
        if (!checkpoint.commitId) { context.workspaceLease.release(); return error(checkpoint.error ?? "Failed to capture initial checkpoint."); }
        const state = {
          version: 1,
          status: "running",
          startedAt: Date.now(),
          updatedAt: Date.now(),
          contract: {
            objective: String(params.objective),
            benchmarkCommand: String(params.benchmarkCommand),
            metricName: String(params.metricName),
            direction: params.direction === "higher" ? "higher" : "lower",
            editablePaths: params.editablePaths.map(String),
            checksCommand: params.checksCommand ? String(params.checksCommand) : undefined,
            maxIterations: Math.min(MAX_ITERATIONS, Number(params.maxIterations ?? MAX_ITERATIONS)),
            maxDurationMs: Math.min(MAX_DURATION_MS, Number(params.maxDurationMinutes ?? 120) * 60_000),
            commandTimeoutMs: Math.min(MAX_COMMAND_MS, Number(params.commandTimeoutSeconds ?? 600) * 1_000),
            verificationTolerancePercent: Number(params.verificationTolerancePercent ?? 5),
          },
          baselineCheckpointId: checkpoint.id,
          parentCheckpointId: checkpoint.id,
          bestCheckpointId: checkpoint.id,
          baselineMetric: undefined,
          bestMetric: undefined,
          runs: [],
          consecutiveFailures: 0,
          iterationOpen: false,
        };
        await save(state);
        return text("Autoresearch initialized. Run the unchanged benchmark now to establish the baseline.", publicState(state));
      },
    });

    pi.registerTool({
      name: "autoresearch_run",
      label: "Run Autoresearch Benchmark",
      description: "Run the fixed benchmark and optional correctness checks for the current candidate.",
      parameters: objectSchema({}),
      async execute() {
        const state = await load();
        if (!state || !["running", "paused"].includes(state.status)) return error("No active autoresearch session.");
        try {
          ensureLease(state);
          await recoverPending(state);
          const reason = budgetReason(state);
          if (reason) { state.status = "paused"; state.lastError = reason; context.workspaceLease.release(); await save(state); return error(`Autoresearch paused: ${reason}.`); }
          state.iterationOpen = true;
          await save(state);
          const benchmark = await context.execProcess(state.contract.benchmarkCommand, state.contract.commandTimeoutMs);
          const metric = benchmark.exitCode === 0 && !benchmark.timedOut
            ? metricFrom(`${benchmark.stdout}\n${benchmark.stderr}`, state.contract.metricName)
            : undefined;
          let checks;
          if (benchmark.exitCode === 0 && !benchmark.timedOut && metric !== undefined && state.contract.checksCommand) {
            checks = await context.execProcess(state.contract.checksCommand, state.contract.commandTimeoutMs);
          }
          state.pendingResult = {
            metric,
            benchmark: { exitCode: benchmark.exitCode, timedOut: benchmark.timedOut, durationMs: benchmark.durationMs, stdout: benchmark.stdout.slice(-8_000), stderr: benchmark.stderr.slice(-8_000) },
            checks: checks ? { exitCode: checks.exitCode, timedOut: checks.timedOut, durationMs: checks.durationMs, stdout: checks.stdout.slice(-8_000), stderr: checks.stderr.slice(-8_000) } : undefined,
          };
          await save(state);
          return text(metric === undefined ? "Benchmark failed or did not emit the required metric. Call autoresearch_record." : `Measured ${state.contract.metricName}=${metric}. Call autoresearch_record.`, state.pendingResult);
        } catch (cause) {
          state.status = "paused";
          state.lastError = cause instanceof Error ? cause.message : String(cause);
          context.workspaceLease.release();
          await save(state);
          return error(`Autoresearch paused: ${state.lastError}`);
        }
      },
    });

    pi.registerTool({
      name: "autoresearch_record",
      label: "Record Autoresearch Candidate",
      description: "Capture the candidate and automatically accept it or restore the parent checkpoint.",
      parameters: objectSchema({ hypothesis: { type: "string", minLength: 1 }, learned: { type: "string" } }, ["hypothesis"]),
      async execute(_id, params) {
        const state = await load();
        if (!state || state.status !== "running" || !state.pendingResult) return error("No measured candidate is ready to record.");
        try {
          ensureLease(state);
          const result = state.pendingResult;
          const benchmarkPassed = result.benchmark.exitCode === 0 && !result.benchmark.timedOut && result.metric !== undefined;
          const checksPassed = !result.checks || (result.checks.exitCode === 0 && !result.checks.timedOut);
          const improves = state.bestMetric === undefined || isBetter(result.metric, state.bestMetric, state.contract.direction);
          const candidate = await context.checkpoints.capture(benchmarkPassed && checksPassed && improves ? "experiment-best" : "experiment");
          if (!candidate.commitId) throw new Error(candidate.error ?? "candidate checkpoint failed");
          const changes = await context.checkpoints.provenance(candidate.id) ?? [];
          const outsideScope = changes.map((change) => change.path).filter((path) => !matchesScope(path, state.contract.editablePaths));
          let status;
          if (!benchmarkPassed) status = "crashed";
          else if (!checksPassed) status = "checks_failed";
          else if (outsideScope.length) status = "scope_failed";
          else if (!improves) status = "discarded";
          else status = "accepted";
          const run = {
            run: state.runs.length + 1,
            hypothesis: String(params.hypothesis),
            learned: params.learned ? String(params.learned) : undefined,
            parentCheckpointId: state.parentCheckpointId,
            candidateCheckpointId: candidate.id,
            metric: result.metric,
            status,
            changedFiles: changes.map((change) => change.path),
            outsideScope,
            durationMs: result.benchmark.durationMs,
            createdAt: new Date().toISOString(),
          };
          if (status === "accepted") {
            if (state.baselineMetric === undefined) state.baselineMetric = result.metric;
            state.bestMetric = result.metric;
            state.bestCheckpointId = candidate.id;
            state.parentCheckpointId = candidate.id;
            state.consecutiveFailures = 0;
          } else {
            await restore(state.parentCheckpointId);
            state.consecutiveFailures += status === "discarded" ? 1 : 1;
          }
          state.runs.push(run);
          state.pendingResult = undefined;
          state.iterationOpen = false;
          state.lastError = outsideScope.length ? `candidate changed files outside scope: ${outsideScope.join(", ")}` : undefined;
          await context.storage.appendJsonl(RUNS_FILE, run);
          const reason = budgetReason(state);
          if (reason) { state.status = "paused"; state.lastError = reason; context.workspaceLease.release(); }
          await save(state);
          return text(`Experiment #${run.run}: ${status}${result.metric === undefined ? "" : ` (${state.contract.metricName}=${result.metric})`}.`, { run, state: publicState(state) });
        } catch (cause) {
          state.status = "paused";
          state.lastError = cause instanceof Error ? cause.message : String(cause);
          context.workspaceLease.release();
          await save(state);
          return error(`Candidate recording failed; loop paused: ${state.lastError}`);
        }
      },
    });

    const pauseOrStop = async (status) => {
      const state = await load();
      if (!state || !["running", "paused"].includes(state.status)) return error("No active autoresearch session.");
      try {
        if (context.workspaceLease.owned()) await recoverPending(state);
        state.status = status;
        context.workspaceLease.release();
        await save(state);
        return text(`Autoresearch ${status}.`, publicState(state));
      } catch (cause) {
        state.status = "paused";
        state.lastError = cause instanceof Error ? cause.message : String(cause);
        await save(state);
        return error(`Could not safely ${status}: ${state.lastError}`);
      }
    };

    pi.registerTool({ name: "autoresearch_pause", label: "Pause Autoresearch", description: "Restore unrecorded work, pause, and release the workspace lease.", parameters: objectSchema({}), execute: () => pauseOrStop("paused") });
    pi.registerTool({ name: "autoresearch_stop", label: "Stop Autoresearch", description: "Restore unrecorded work, stop, and release the workspace lease.", parameters: objectSchema({}), execute: () => pauseOrStop("stopped") });
    pi.registerTool({
      name: "autoresearch_resume", label: "Resume Autoresearch", description: "Reacquire the workspace lease and recover interrupted work.", parameters: objectSchema({}),
      async execute() {
        const state = await load();
        if (!state || state.status !== "paused") return error("No paused autoresearch session.");
        try { ensureLease(state); await recoverPending(state); state.status = "running"; state.lastError = undefined; await save(state); return text("Autoresearch resumed.", publicState(state)); }
        catch (cause) { return error(cause instanceof Error ? cause.message : String(cause)); }
      },
    });
    pi.registerTool({ name: "autoresearch_status", label: "Autoresearch Status", description: "Read the persisted autoresearch status.", parameters: objectSchema({}), async execute() { const state = await load(); return text(JSON.stringify(publicState(state), null, 2), publicState(state)); } });

    pi.registerTool({
      name: "autoresearch_finish",
      label: "Finish Autoresearch",
      description: "Restore the best checkpoint, verify it, capture a final checkpoint, and release the lease.",
      parameters: objectSchema({}),
      async execute() {
        const state = await load();
        if (!state || !["running", "paused"].includes(state.status)) return error("No active autoresearch session.");
        try {
          ensureLease(state);
          await recoverPending(state);
          await restore(state.bestCheckpointId);
          const benchmark = await context.execProcess(state.contract.benchmarkCommand, state.contract.commandTimeoutMs);
          const metric = benchmark.exitCode === 0 && !benchmark.timedOut ? metricFrom(`${benchmark.stdout}\n${benchmark.stderr}`, state.contract.metricName) : undefined;
          if (metric === undefined) throw new Error("final benchmark failed or omitted the metric");
          if (state.bestMetric !== undefined) {
            const worse = state.contract.direction === "higher" ? metric < state.bestMetric : metric > state.bestMetric;
            const relativeRegression = Math.abs(metric - state.bestMetric) / Math.max(Math.abs(state.bestMetric), Number.EPSILON) * 100;
            if (worse && relativeRegression > state.contract.verificationTolerancePercent) {
              throw new Error(`final metric ${metric} regressed ${relativeRegression.toFixed(2)}% from recorded best ${state.bestMetric}`);
            }
          }
          if (state.contract.checksCommand) {
            const checks = await context.execProcess(state.contract.checksCommand, state.contract.commandTimeoutMs);
            if (checks.exitCode !== 0 || checks.timedOut) throw new Error("final correctness checks failed");
          }
          const finalCheckpoint = await context.checkpoints.capture("experiment-best");
          if (!finalCheckpoint.commitId) throw new Error(finalCheckpoint.error ?? "final checkpoint failed");
          state.finalCheckpointId = finalCheckpoint.id;
          state.bestCheckpointId = finalCheckpoint.id;
          state.verifiedMetric = metric;
          state.status = "completed";
          state.completedAt = Date.now();
          state.lastError = undefined;
          context.workspaceLease.release();
          await save(state);
          return text("Autoresearch completed and the best result was independently re-verified.", publicState(state));
        } catch (cause) {
          state.status = "paused";
          state.lastError = cause instanceof Error ? cause.message : String(cause);
          context.workspaceLease.release();
          await save(state);
          return error(`Final verification failed; loop paused: ${state.lastError}`);
        }
      },
    });
  };
}
