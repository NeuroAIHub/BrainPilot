import { describe, it, expect } from "vitest";
import {
  deriveKbReadiness,
  inventoryCardModifier,
  inventoryHeadlineKey,
  inventoryHeadlineTone,
  nextStepKey,
  overallHeadlineKey,
  type KbReadinessInput,
} from "../components/settings/kbReadiness";

function inv(partial: Partial<KbReadinessInput> & Pick<KbReadinessInput, "pdfsOnDisk">): KbReadinessInput {
  return {
    pdfsOnDisk: partial.pdfsOnDisk,
    vectors: partial.vectors ?? null,
    consistency: partial.consistency ?? { healthy: true },
  };
}

describe("deriveKbReadiness (#319)", () => {
  it("empty KB: 0 PDFs never looks ready-to-query, even when ledgers are 'healthy'", () => {
    const r = deriveKbReadiness(
      inv({ pdfsOnDisk: 0, consistency: { healthy: true }, vectors: null }),
      { readyToBuild: false },
    );
    expect(r.dataStatus).toBe("empty");
    expect(r.overall).toBe("empty");
    expect(r.readyToQuery).toBe(false);
    expect(r.nextStep).toBe("add_pdfs");
    expect(r.envReady).toBe(false);
  });

  it("empty KB with env ready still asks for PDFs first", () => {
    const r = deriveKbReadiness(
      inv({ pdfsOnDisk: 0, consistency: { healthy: true } }),
      { readyToBuild: true },
    );
    expect(r.overall).toBe("empty");
    expect(r.nextStep).toBe("add_pdfs");
    expect(r.readyToQuery).toBe(false);
  });

  it("null inventory is treated as empty (probe not loaded)", () => {
    const r = deriveKbReadiness(null, null);
    expect(r.dataStatus).toBe("empty");
    expect(r.readyToQuery).toBe(false);
    expect(r.nextStep).toBe("add_pdfs");
  });

  it("environment-missing: consistent data + vectors still not ready to query", () => {
    const r = deriveKbReadiness(
      inv({
        pdfsOnDisk: 3,
        consistency: { healthy: true },
        vectors: { count: 100 },
      }),
      { readyToBuild: false },
    );
    expect(r.dataStatus).toBe("consistent");
    expect(r.overall).toBe("need_env");
    expect(r.readyToQuery).toBe(false);
    expect(r.nextStep).toBe("setup_env");
  });

  it("null env probe is treated as not ready (no false ready flash)", () => {
    const r = deriveKbReadiness(
      inv({
        pdfsOnDisk: 2,
        consistency: { healthy: true },
        vectors: { count: 50 },
      }),
      null,
    );
    expect(r.readyToQuery).toBe(false);
    expect(r.overall).toBe("need_env");
    expect(r.nextStep).toBe("setup_env");
  });

  it("stale-index: inconsistent ledgers with env ready → rebuild", () => {
    const r = deriveKbReadiness(
      inv({
        pdfsOnDisk: 5,
        consistency: { healthy: false },
        vectors: { count: 10 },
      }),
      { readyToBuild: true },
    );
    expect(r.dataStatus).toBe("stale");
    expect(r.overall).toBe("stale");
    expect(r.readyToQuery).toBe(false);
    expect(r.nextStep).toBe("rebuild");
  });

  it("stale-index with env missing prefers setup_env over rebuild", () => {
    const r = deriveKbReadiness(
      inv({
        pdfsOnDisk: 5,
        consistency: { healthy: false },
        vectors: { count: 10 },
      }),
      { readyToBuild: false },
    );
    expect(r.dataStatus).toBe("stale");
    expect(r.overall).toBe("need_env");
    expect(r.nextStep).toBe("setup_env");
    expect(r.readyToQuery).toBe(false);
  });

  it("need_build: env ready and data consistent but no vectors yet", () => {
    const r = deriveKbReadiness(
      inv({
        pdfsOnDisk: 4,
        consistency: { healthy: true },
        vectors: null,
      }),
      { readyToBuild: true },
    );
    expect(r.dataStatus).toBe("consistent");
    expect(r.overall).toBe("need_build");
    expect(r.nextStep).toBe("rebuild");
    expect(r.readyToQuery).toBe(false);
  });

  it("need_build when vectors count is zero", () => {
    const r = deriveKbReadiness(
      inv({
        pdfsOnDisk: 1,
        consistency: { healthy: true },
        vectors: { count: 0 },
      }),
      { readyToBuild: true },
    );
    expect(r.overall).toBe("need_build");
    expect(r.readyToQuery).toBe(false);
  });

  it("fully-ready: PDFs + healthy + vectors + env → ready to query", () => {
    const r = deriveKbReadiness(
      inv({
        pdfsOnDisk: 12,
        consistency: { healthy: true },
        vectors: { count: 900 },
      }),
      { readyToBuild: true },
    );
    expect(r.dataStatus).toBe("consistent");
    expect(r.overall).toBe("ready_to_query");
    expect(r.readyToQuery).toBe(true);
    expect(r.nextStep).toBe("none");
  });
});

describe("inventory presentation helpers", () => {
  it("maps data status to card modifiers (empty never uses healthy green)", () => {
    expect(inventoryCardModifier("empty")).toBe("empty");
    expect(inventoryCardModifier("stale")).toBe("pending");
    expect(inventoryCardModifier("consistent")).toBe("consistent");
  });

  it("maps data status to headline keys and tones", () => {
    expect(inventoryHeadlineKey("empty")).toBe("settings.kb.inv.headline.empty");
    expect(inventoryHeadlineKey("stale")).toBe("settings.kb.inv.headline.pending");
    expect(inventoryHeadlineKey("consistent")).toBe("settings.kb.inv.headline.consistent");
    expect(inventoryHeadlineTone("empty")).toBe("empty");
    expect(inventoryHeadlineTone("stale")).toBe("pending");
    expect(inventoryHeadlineTone("consistent")).toBe("ok");
  });
});

describe("overall presentation helpers", () => {
  it("maps overall kinds to i18n keys", () => {
    expect(overallHeadlineKey("empty")).toBe("settings.kb.ready.empty");
    expect(overallHeadlineKey("stale")).toBe("settings.kb.ready.stale");
    expect(overallHeadlineKey("need_env")).toBe("settings.kb.ready.needEnv");
    expect(overallHeadlineKey("need_build")).toBe("settings.kb.ready.needBuild");
    expect(overallHeadlineKey("ready_to_query")).toBe("settings.kb.ready.readyToQuery");
  });

  it("maps next steps to i18n keys", () => {
    expect(nextStepKey("add_pdfs")).toBe("settings.kb.ready.next.addPdfs");
    expect(nextStepKey("setup_env")).toBe("settings.kb.ready.next.setupEnv");
    expect(nextStepKey("rebuild")).toBe("settings.kb.ready.next.rebuild");
    expect(nextStepKey("none")).toBe(null);
  });
});
