export const runtimeConfig = {
  useMockBackend: import.meta.env.VITE_USE_MOCK_BACKEND === "1",
  // Multi-user auth is OFF by default: this repo is single-user and must not
  // show a login screen. A downstream multi-user deployment re-enables the full
  // login/register/me flow by building with VITE_AUTH_ENABLED=1.
  authEnabled: import.meta.env.VITE_AUTH_ENABLED === "1",
};
