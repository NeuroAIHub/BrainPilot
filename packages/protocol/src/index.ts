/**
 * @brainpilot/protocol — single source of truth for the BrainPilot wire
 * contract. Re-exports AG-UI events, domain schemas, and the Runtime HTTP
 * contract. Every other package imports from here.
 */
export const PROTOCOL_VERSION = "1.0.0";

export * from "./events.js";
export * from "./domain.js";
export * from "./http.js";
