export const runtimeConfig = {
  useMockBackend: import.meta.env.VITE_USE_MOCK_BACKEND === "1",
  // Multi-user auth is OFF by default: this repo is single-user and must not
  // show a login screen. A downstream multi-user deployment re-enables the full
  // login/register/me flow by building with VITE_AUTH_ENABLED=1.
  authEnabled: import.meta.env.VITE_AUTH_ENABLED === "1",
  // Local single-user mode is ON by default: there is no container lifecycle to
  // manage — the runtime launched by `brainpilot up` IS the sandbox, and the
  // active session id addresses its workspace. Sandbox list/create/rebuild/
  // destroy/stats/logs are skipped. A downstream multi-user deployment with a
  // real per-user sandbox orchestrator opts out by building with
  // VITE_LOCAL_MODE=0.
  localMode: import.meta.env.VITE_LOCAL_MODE !== "0",
};
