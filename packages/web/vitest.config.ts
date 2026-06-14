/// <reference types="vitest" />
import { defineConfig, type PluginOption } from "vitest/config";
import react from "@vitejs/plugin-react";

// Test-only config. The app build uses vite.config.ts; tests run under vitest's
// own pipeline. We deliberately use the default "node" environment because the
// monorepo root does not ship jsdom/happy-dom or @testing-library (deps are not
// installable in this task). Component coverage therefore uses
// react-dom/server (renderToStaticMarkup), and interaction/round-trip coverage
// uses the pure event→view-model + reducer helpers. See src/__tests__.
export default defineConfig({
  plugins: [react() as PluginOption],
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    globals: true,
  },
});
