#!/usr/bin/env node
/** One-user, loopback-only live workflow demo using the normal BrainPilot app. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createServer as createPortProbe } from "node:net";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const usage = "Usage: node scripts/workflow-demo-server.mjs --create|--resume --provider-env ABS --output ABS --model-id ID --port PORT [--ttl-minutes N]";
const values = new Map();
let mode;
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === "--create" || arg === "--resume") {
    if (mode) throw new Error(usage);
    mode = arg.slice(2);
    continue;
  }
  if (!["--provider-env", "--output", "--model-id", "--port", "--ttl-minutes"].includes(arg)
    || values.has(arg) || !process.argv[i + 1] || process.argv[i + 1].startsWith("--")) throw new Error(usage);
  values.set(arg, process.argv[++i]);
}
if (!mode || ["--provider-env", "--output", "--model-id", "--port"].some(key => !values.has(key))) throw new Error(usage);
if (process.platform !== "linux") throw new Error("This isolated demo launcher runs only on Linux.");
const providerPath = values.get("--provider-env");
const outputArg = values.get("--output");
assert(isAbsolute(providerPath) && isAbsolute(outputArg), "--provider-env and --output must be absolute paths.");
const output = resolve(outputArg);
const modelId = values.get("--model-id");
assert(modelId.trim() === modelId && modelId.length > 0 && modelId.length <= 200 && !/[\r\n\0]/u.test(modelId), "--model-id must be a nonempty single-line ID.");
const port = Number(values.get("--port"));
assert(Number.isSafeInteger(port) && port >= 1024 && port < 65535, "--port must allow the runtime to use port + 1.");
const runtimePort = port + 1;
const ttlMinutes = Number(values.get("--ttl-minutes") ?? "1440");
assert(Number.isSafeInteger(ttlMinutes) && ttlMinutes >= 1 && ttlMinutes <= 1440, "--ttl-minutes must be between 1 and 1440.");

const checkout = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const providerFile = await realpath(providerPath);
assert((await lstat(providerFile)).isFile(), "--provider-env must refer to a regular file.");
const providerBytes = await readFile(providerFile);
const digest = data => createHash("sha256").update(data).digest("hex");
const providerFingerprint = digest(providerBytes);
const providerPathFingerprint = digest(providerFile);
const markerPath = join(output, "demo-owner.json");
const readyPath = join(output, "demo-ready.json");
const stoppedPath = join(output, "demo-stopped.json");
let owner;
if (mode === "resume") {
  assert.equal(await realpath(output), output, "--resume requires the original directory, not a symlink.");
  owner = JSON.parse(await readFile(markerPath, "utf8"));
  assert.equal(owner.kind, "brainpilot-live-workflow-demo-v1", "Directory is not owned by this launcher.");
  assert(typeof owner.id === "string" && /^[0-9a-f-]{36}$/u.test(owner.id), "Demo owner marker is invalid.");
  assert.equal(owner.output, output, "Demo owner directory does not match.");
  assert.equal(owner.port, port, "Resume must use the original port.");
  assert.equal(owner.modelId, modelId, "Resume must use the original model.");
  assert.equal(owner.providerFingerprint, providerFingerprint, "Provider file changed; use the original provider configuration.");
  assert.equal(owner.providerPathFingerprint, providerPathFingerprint, "Resume must use the original provider reference.");
  // A first boot may have failed after writing the owner marker but before
  // reaching readiness. That owned directory is still resumable.
  const previousText = await readFile(readyPath, "utf8").catch(error => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  const previous = previousText === null ? null : JSON.parse(previousText);
  if (previous) assert.equal(previous.ownerId, owner.id, "Ready record belongs to another demo.");
  if (Number.isSafeInteger(previous?.pid) && previous.pid !== process.pid) {
    try { process.kill(previous.pid, 0); throw new Error(`Demo PID ${previous.pid} is still running; stop it before resuming.`); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
  }
}

const { parseDotenv } = await import("../packages/backend-core/dist/config.js");
const secrets = await parseDotenv(providerFile);
const apiKey = secrets.SQZ_API_KEY || secrets.CUSTOM_API_KEY || secrets.ANTHROPIC_API_KEY;
const baseUrl = secrets.CUSTOM_BASE_URL || secrets.ANTHROPIC_BASE_URL;
assert(apiKey && baseUrl, "Provider reference lacks an API key or base URL.");
let parsedBase;
try { parsedBase = new URL(baseUrl); }
catch { throw new Error("Provider base URL is invalid."); }
assert(["http:", "https:"].includes(parsedBase.protocol), "Provider URL must use HTTP or HTTPS.");

// Probe before creating any output or starting a runtime. A failed bind at the
// actual server start still fails safely; port probes never stop an owner.
for (const candidate of [port, runtimePort]) {
  await new Promise((done, reject) => {
    const probe = createPortProbe();
    probe.once("error", reject);
    probe.listen(candidate, "127.0.0.1", () => probe.close(done));
  });
}

if (mode === "create") {
  await mkdir(output, { recursive: false, mode: 0o700 });
  owner = {
    kind: "brainpilot-live-workflow-demo-v1", id: randomUUID(), output,
    modelId, port, providerFingerprint, providerPathFingerprint,
    createdAt: new Date().toISOString(),
  };
  await writeFile(markerPath, JSON.stringify(owner, null, 2) + "\n", { flag: "wx", mode: 0o600 });
}

const dataRoot = join(output, "data");
const env = {
  ANTHROPIC_API_KEY: apiKey,
  ANTHROPIC_BASE_URL: baseUrl.replace(/\/+$/u, "").replace(/\/v1$/u, ""),
  ANTHROPIC_MODEL: modelId,
  BP_MODEL: modelId,
  BP_DATA_DIR: dataRoot,
  BP_LOCAL_MODE: "1",
  BP_ORCHESTRATOR: "local",
  BP_HOST: "127.0.0.1",
  BP_RUNTIME_HOST: "127.0.0.1",
  PI_CODING_AGENT_DIR: join(output, "pi-agent"),
  PI_CODING_AGENT_SESSION_DIR: join(output, "pi-sessions"),
  BP_KB_ROOT: join(output, "knowledge-base"),
};
for (const key of ["BP_RUNTIME_URL", "BP_MOCK", "BP_SHARED_DIR", "BP_DYNAMIC", "BP_MODE", "BP_MODEL_INPUT_MODALITIES"]) delete process.env[key];
if (secrets.BP_MODEL_INPUT_MODALITIES && modelId === (secrets.BP_MODEL || secrets.ANTHROPIC_MODEL)) {
  env.BP_MODEL_INPUT_MODALITIES = secrets.BP_MODEL_INPUT_MODALITIES;
}
Object.assign(process.env, env);
// The model's image input capability must be checked in Settings/Provider
// before attempting paper-writing. A new UI session can select thinking=low.
const { LocalProcessOrchestrator } = await import("../packages/backend-core/dist/local-orchestrator.js");
const orchestrator = new LocalProcessOrchestrator({ dataDir: dataRoot, port: runtimePort, host: "127.0.0.1" });
let running, timer, stopping;
const stop = reason => stopping ??= (async () => {
  clearTimeout(timer);
  if (running) await running.stop();
  else await orchestrator.stopRuntime();
  await writeFile(stoppedPath, JSON.stringify({ ownerId: owner.id, pid: process.pid,
    reason, stoppedAt: new Date().toISOString(), sessionsPersistedBy: "runtime.shutdownAndSave" }, null, 2) + "\n", { mode: 0o600 });
})();
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => { void stop(signal).then(() => process.exit(0), error => { console.error(error); process.exit(1); }); });
}
const priorSignals = new Map(["SIGINT", "SIGTERM"].map(signal => [signal, new Set(process.listeners(signal))]));
const { startServer } = await import("../packages/backend-core/dist/server.js");
try {
  running = await startServer({
    port, runtimePort, hostname: "127.0.0.1", mode: "local", dataDir: dataRoot,
    orchestrator,
    serveWeb: true, webRoot: join(checkout, "packages", "web", "dist"), eager: true,
    env: process.env, kbManagementEnabled: false,
  });
  // The backend installs process-exit handlers for standalone use. This
  // wrapper owns final metadata and must await the same server.stop() itself.
  for (const signal of ["SIGINT", "SIGTERM"]) {
    for (const handler of process.listeners(signal)) {
      if (!priorSignals.get(signal).has(handler)) process.removeListener(signal, handler);
    }
  }
  if (!running.server.listening) await new Promise((done, reject) => {
    running.server.once("listening", done);
    running.server.once("error", reject);
  });
  const ready = {
    status: "ready", ownerId: owner.id, pid: process.pid, modelId, port, runtimePort,
    backendUrl: `http://127.0.0.1:${port}`, dataRoot, resumed: mode === "resume",
    startedAt: new Date().toISOString(), ttlMinutes,
  };
  await writeFile(readyPath, JSON.stringify(ready, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify(ready));
  timer = setTimeout(() => { void stop("ttl-expired").then(() => process.exit(0), error => { console.error(error); process.exit(1); }); }, ttlMinutes * 60_000);
  timer.unref();
} catch (error) {
  await stop("startup-failed").catch(() => {});
  throw error;
}
