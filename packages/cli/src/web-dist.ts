/**
 * web-dist.ts — locate the built `@brainpilot/web` SPA so the backend can
 * serve it (§11A.4 step 4). The web package has no JS entry points, so we
 * resolve its `package.json` and derive `<pkgDir>/dist`.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/**
 * Resolve the `@brainpilot/web` dist directory, or null if the package can't
 * be located. `from` is the module URL to resolve relative to (defaults to
 * this file so resolution follows the CLI's own node_modules).
 */
export function resolveWebDist(from: string = import.meta.url): string | null {
  try {
    const require = createRequire(from);
    const pkgJson = require.resolve("@brainpilot/web/package.json");
    return join(dirname(pkgJson), "dist");
  } catch {
    return null;
  }
}
