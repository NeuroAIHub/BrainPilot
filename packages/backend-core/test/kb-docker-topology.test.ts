import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const staticCompose = readFileSync(
  fileURLToPath(new URL("../../../docker-compose.yml", import.meta.url)),
  "utf8",
);
const dynamicCompose = readFileSync(
  fileURLToPath(new URL("../../../docker-compose.dynamic.yml", import.meta.url)),
  "utf8",
);

describe("Knowledge Base Docker topology (#486)", () => {
  it("gives static main and sandbox the same persistent KB root", () => {
    expect(staticCompose.match(/BP_KB_ROOT=\/root\/\.bp-root\/KnowledgeBase/g)).toHaveLength(2);
    expect(staticCompose.match(/\$\{BP_DATA_DIR:-\.\/brainpilot\}:\/root\/\.bp-root:rw/g)).toHaveLength(2);
    expect(staticCompose).toContain("- BP_DATA_DIR=/root/.bp-root");
  });

  it("keeps unsupported multi-user KB management actions hidden", () => {
    expect(dynamicCompose).toMatch(/VITE_KB_SETTINGS_ENABLED:\s*0/);
  });
});
