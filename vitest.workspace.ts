import { defineWorkspace } from "vitest/config";

// Each non-web package runs its tests in a Node environment.
// web brings its own vitest/vite config under packages/web.
export default defineWorkspace([
  "packages/protocol",
  "packages/runtime",
  "packages/backend-core",
  "packages/cli",
  "packages/client-cli",
  "packages/skills-mcp",
]);
