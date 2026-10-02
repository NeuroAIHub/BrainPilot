import { defineConfig } from "vitest/config";

// Vitest 5 uses test.projects instead of vitest.workspace.ts. Keep the root
// suite scoped to non-Web packages; Web uses its own React/Vite configuration.
export default defineConfig({
  test: {
    projects: [
      "packages/protocol",
      "packages/runtime",
      "packages/backend-core",
      "packages/cli",
      "packages/client-cli",
    ],
  },
});
