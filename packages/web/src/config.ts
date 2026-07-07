export const runtimeConfig = {
  useMockBackend: import.meta.env.VITE_USE_MOCK_BACKEND === "1",
  // Local single-user mode is ON by default: there is no container lifecycle to
  // manage — the runtime launched by `brainpilot up` IS the sandbox, and the
  // active session id addresses its workspace. Sandbox list/create/rebuild/
  // destroy/stats/logs are skipped. A downstream multi-user deployment with a
  // real per-user sandbox orchestrator opts out by building with
  // VITE_LOCAL_MODE=0.
  localMode: import.meta.env.VITE_LOCAL_MODE !== "0",
  // Hosted multi-user deployments mount this app under a subpath (e.g. /app)
  // while the marketing/home page lives at the site root. Non-local builds show
  // a "return home" entry pointing here; override with VITE_HOME_URL so the host
  // can target its own landing/account page. Absolute "/" default keeps the
  // single-machine deploy pointing at its own root (issue #250).
  homeUrl: import.meta.env.VITE_HOME_URL ?? "/",
};
