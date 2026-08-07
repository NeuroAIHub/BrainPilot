import { describe, expect, it } from "vitest";
import createExtension from "./index.mjs";

function harness(results, restoreError) {
  const stored = new Map();
  const tools = new Map();
  const restores = [];
  let checkpoint = 0;
  let leased = false;
  const context = {
    storage: {
      readJson: async (name) => structuredClone(stored.get(name)),
      writeJson: async (name, value) => { stored.set(name, structuredClone(value)); },
      appendJsonl: async () => {},
    },
    checkpoints: {
      capture: async () => ({ id: `checkpoint_${++checkpoint}`, commitId: String(checkpoint) }),
      preview: async (id) => ({ checkpointId: id, stateToken: "token", files: [{ path: "src/a.ts", status: "modified" }], skipped: [] }),
      restore: async (id) => { if (restoreError) throw restoreError; restores.push(id); return { restoredCheckpointId: id }; },
      provenance: async () => [{ path: "src/a.ts", status: "modified" }],
    },
    workspaceLease: { acquire: () => (leased ? true : (leased = true)), release: () => { leased = false; }, owned: () => leased },
    execProcess: async () => results.shift(),
    emit: () => {},
  };
  return createExtension(context).then((factory) => {
    factory({ registerTool(tool) { tools.set(tool.name, tool); } });
    return { tools, stored, restores };
  });
}

const ok = (metric) => ({ exitCode: 0, timedOut: false, durationMs: 1, stdout: `METRIC score=${metric}\n`, stderr: "" });

async function init(tools) {
  return tools.get("autoresearch_init").execute("1", {
    objective: "faster", benchmarkCommand: "./measure.sh", metricName: "score", direction: "lower", editablePaths: ["src/**"],
  });
}

describe("autoresearch runtime extension", () => {
  it("accepts baseline and improvements, then verifies the best result", async () => {
    const { tools, stored } = await harness([ok(10), ok(8), ok(8)]);
    await init(tools);
    await tools.get("autoresearch_run").execute();
    await tools.get("autoresearch_record").execute("2", { hypothesis: "baseline" });
    await tools.get("autoresearch_run").execute();
    await tools.get("autoresearch_record").execute("3", { hypothesis: "optimize" });
    const finished = await tools.get("autoresearch_finish").execute();
    expect(finished.isError).not.toBe(true);
    expect(stored.get("session.json")).toMatchObject({ status: "completed", baselineMetric: 10, bestMetric: 8 });
  });

  it("restores a regressing candidate", async () => {
    const { tools, stored, restores } = await harness([ok(10), ok(12)]);
    await init(tools);
    await tools.get("autoresearch_run").execute();
    await tools.get("autoresearch_record").execute("2", { hypothesis: "baseline" });
    await tools.get("autoresearch_run").execute();
    await tools.get("autoresearch_record").execute("3", { hypothesis: "regression" });
    expect(stored.get("session.json").runs.at(-1).status).toBe("discarded");
    expect(restores).toHaveLength(1);
  });

  it("pauses instead of overwriting when restore is stale", async () => {
    const stale = Object.assign(new Error("workspace changed after restore preview"), { code: "STALE_WORKSPACE" });
    const { tools, stored } = await harness([ok(10), ok(12)], stale);
    await init(tools);
    await tools.get("autoresearch_run").execute();
    await tools.get("autoresearch_record").execute("2", { hypothesis: "baseline" });
    await tools.get("autoresearch_run").execute();
    const result = await tools.get("autoresearch_record").execute("3", { hypothesis: "regression" });
    expect(result.isError).toBe(true);
    expect(stored.get("session.json")).toMatchObject({ status: "paused", lastError: "workspace changed after restore preview" });
  });
});
