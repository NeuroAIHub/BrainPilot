/**
 * @brainpilot/client-cli — headless verification client (dev/CI).
 */
export {
  BrainPilotClient,
  parseSseStream,
  fillPath,
  isTerminalEvent,
  hasWorkflowStatus,
  sessionTerminalStatus,
  sessionWorkflowState,
  DEFAULT_BASE_URL,
} from "./client.js";
export type { BrainPilotClientOptions } from "./client.js";
export { driveSession, run } from "./driver.js";
export type { DriveOptions, DriveResult, DriveDeps } from "./driver.js";

export const CLIENT_CLI_NAME = "@brainpilot/client-cli";
