/**
 * Pure helpers for Knowledge Base readiness taxonomy (#319).
 *
 * Separates two orthogonal signals the UI used to conflate:
 *   - **data consistency** — four-stage ledgers agree (empty sets can be
 *     "consistent" without being usable)
 *   - **query readiness** — PDFs exist, vectors are present, and the
 *     Python runtime is ready to serve / rebuild
 *
 * Callers render inventory chrome from `dataStatus` and the top-level
 * banner / next-step copy from `overall` + `nextStep`.
 */

export type KbDataStatus = "empty" | "stale" | "consistent";

/**
 * Combined status shown as the panel-level readiness signal.
 * Never green-implies-usable unless `ready_to_query`.
 */
export type KbOverallKind =
  | "empty"
  | "stale"
  | "need_env"
  | "need_build"
  | "ready_to_query";

export type KbNextStep = "add_pdfs" | "setup_env" | "rebuild" | "none";

export interface KbReadinessInput {
  pdfsOnDisk: number;
  vectors: { count: number } | null;
  consistency: { healthy: boolean };
}

export interface KbEnvReadinessInput {
  readyToBuild: boolean;
}

export interface KbReadiness {
  /** Inventory-only dimension (pipeline ledgers). */
  dataStatus: KbDataStatus;
  /** Combined usable-for-query state. */
  overall: KbOverallKind;
  /** Primary next action for the operator. */
  nextStep: KbNextStep;
  /** True only when PDFs + consistent index + env are all ready. */
  readyToQuery: boolean;
  /** Runtime/env probe ready (false when env is null or incomplete). */
  envReady: boolean;
}

/**
 * Derive data-consistency and query-readiness from inventory + env probe.
 *
 * `env` may be null while the probe is still loading — that is treated as
 * not ready, so we never flash a false "ready to query" state.
 */
export function deriveKbReadiness(
  inventory: KbReadinessInput | null,
  env: KbEnvReadinessInput | null,
): KbReadiness {
  const envReady = env?.readyToBuild === true;

  if (!inventory) {
    return {
      dataStatus: "empty",
      overall: "empty",
      nextStep: "add_pdfs",
      readyToQuery: false,
      envReady,
    };
  }

  const pdfs = inventory.pdfsOnDisk;
  const healthy = inventory.consistency.healthy;
  const vectorCount = inventory.vectors?.count ?? 0;
  const hasIndex = vectorCount > 0;

  // --- data dimension ----------------------------------------------------
  let dataStatus: KbDataStatus;
  if (pdfs <= 0) {
    dataStatus = "empty";
  } else if (!healthy) {
    dataStatus = "stale";
  } else {
    dataStatus = "consistent";
  }

  // --- overall / next step -----------------------------------------------
  // Priority: empty → stale → ready_to_query → need_env → need_build
  let overall: KbOverallKind;
  let nextStep: KbNextStep;

  if (pdfs <= 0) {
    overall = "empty";
    nextStep = "add_pdfs";
  } else if (!healthy) {
    overall = "stale";
    // Rebuild still needs a usable env; prefer setup when env is missing.
    if (!envReady) {
      overall = "need_env";
      nextStep = "setup_env";
    } else {
      nextStep = "rebuild";
    }
  } else if (hasIndex && envReady) {
    overall = "ready_to_query";
    nextStep = "none";
  } else if (!envReady) {
    overall = "need_env";
    nextStep = "setup_env";
  } else {
    // Env ready, data consistent, but no vectors yet (never built / empty index).
    overall = "need_build";
    nextStep = "rebuild";
  }

  const readyToQuery = overall === "ready_to_query";

  return { dataStatus, overall, nextStep, readyToQuery, envReady };
}

/** CSS modifier for the inventory card (data dimension only). */
export function inventoryCardModifier(dataStatus: KbDataStatus): "empty" | "consistent" | "pending" {
  if (dataStatus === "empty") return "empty";
  if (dataStatus === "stale") return "pending";
  return "consistent";
}

/** Headline tone for the inventory data card. */
export function inventoryHeadlineTone(dataStatus: KbDataStatus): "empty" | "ok" | "pending" {
  if (dataStatus === "empty") return "empty";
  if (dataStatus === "stale") return "pending";
  return "ok";
}

/** i18n key for the inventory data headline. */
export function inventoryHeadlineKey(
  dataStatus: KbDataStatus,
):
  | "settings.kb.inv.headline.empty"
  | "settings.kb.inv.headline.consistent"
  | "settings.kb.inv.headline.pending" {
  if (dataStatus === "empty") return "settings.kb.inv.headline.empty";
  if (dataStatus === "stale") return "settings.kb.inv.headline.pending";
  return "settings.kb.inv.headline.consistent";
}

/** i18n key for the overall readiness banner title. */
export function overallHeadlineKey(
  overall: KbOverallKind,
):
  | "settings.kb.ready.empty"
  | "settings.kb.ready.stale"
  | "settings.kb.ready.needEnv"
  | "settings.kb.ready.needBuild"
  | "settings.kb.ready.readyToQuery" {
  switch (overall) {
    case "empty":
      return "settings.kb.ready.empty";
    case "stale":
      return "settings.kb.ready.stale";
    case "need_env":
      return "settings.kb.ready.needEnv";
    case "need_build":
      return "settings.kb.ready.needBuild";
    case "ready_to_query":
      return "settings.kb.ready.readyToQuery";
  }
}

/** i18n key for the next-step hint under the overall banner. */
export function nextStepKey(
  nextStep: KbNextStep,
):
  | "settings.kb.ready.next.addPdfs"
  | "settings.kb.ready.next.setupEnv"
  | "settings.kb.ready.next.rebuild"
  | null {
  switch (nextStep) {
    case "add_pdfs":
      return "settings.kb.ready.next.addPdfs";
    case "setup_env":
      return "settings.kb.ready.next.setupEnv";
    case "rebuild":
      return "settings.kb.ready.next.rebuild";
    case "none":
      return null;
  }
}
