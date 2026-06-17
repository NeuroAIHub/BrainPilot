import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// vite is deduped to a single version at the monorepo root (see root
// package.json `overrides`), so `react()` types match and no cast is needed.
export default defineConfig({
  // Asset base path. Defaults to "/" so the single-machine open-source deploy
  // (backend-core serves the dist at root /*) is unaffected. Downstream hosts
  // can rebuild under a subpath with e.g. `BP_WEB_BASE=/app/ npm run build`
  // (issue #25). API_BASE stays absolute "/api" — the gateway lives at root.
  base: process.env.BP_WEB_BASE ?? "/",
  plugins: [react()],
});
