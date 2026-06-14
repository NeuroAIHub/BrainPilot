import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// vite is deduped to a single version at the monorepo root (see root
// package.json `overrides`), so `react()` types match and no cast is needed.
export default defineConfig({
  plugins: [react()],
});
