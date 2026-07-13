/// <reference types="vitest" />
import { defineConfig } from "vitest/config";

// Test-only config for the CLI package. The build uses tsc (`tsc -b`); this
// only affects `vitest`. The sole reason it exists is `setupFiles` (#284): the
// setup file sets BP_SKIP_SKILL_COPY so no CLI test pays the cost of copying the
// full bundled skills tree on every scaffold. Everything else stays on vitest's
// Node defaults, matching the other non-web packages in the workspace.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
