/**
 * driver.ts — the high-level "drive one session to completion" flow used by the
 * bin and by integration smoke tests. Creates a session, sends a message,
 * subscribes to the event stream, and resolves on a session-level terminal
 * status. Legacy runtimes fall back to RUN_FINISHED/RUN_ERROR.
 */
import {
  BrainPilotClient,
  hasWorkflowStatus,
  isTerminalEvent,
  sessionWorkflowState,
} from "./client.js";
import type { AgUiEvent } from "@brainpilot/protocol";

export interface DriveOptions {
  baseUrl?: string;
  message: string;
  agent?: string;
  /** Reuse an existing session instead of creating one. */
  sessionId?: string;
  /** Stop after this many events even without a terminal (safety bound). */
  maxEvents?: number;
}

export interface DriveDeps {
  client?: BrainPilotClient;
  fetchFn?: typeof fetch;
  /** Called for every event as it arrives (e.g. to print). */
  onEvent?: (evt: AgUiEvent) => void;
  log?: (msg: string) => void;
}

export interface DriveResult {
  sessionId: string;
  events: AgUiEvent[];
  /** Why the drive ended. */
  reason: "terminal" | "command_complete" | "stream_end" | "max_events";
}

function isCommandComplete(evt: AgUiEvent): boolean {
  const t = (evt as { type?: string }).type;
  if (t === "command_complete") return true;
  // A CUSTOM event may carry a command_complete name.
  if (t === "CUSTOM") {
    const name = (evt as { name?: string }).name;
    return name === "command_complete";
  }
  return false;
}

/** Drive a single session to completion. */
export async function driveSession(
  options: DriveOptions,
  deps: DriveDeps = {},
): Promise<DriveResult> {
  const client =
    deps.client ??
    new BrainPilotClient({ baseUrl: options.baseUrl, fetchFn: deps.fetchFn });
  const onEvent = deps.onEvent;
  const events: AgUiEvent[] = [];
  const maxEvents = options.maxEvents ?? Infinity;

  const sessionId = options.sessionId ?? (await client.createSession());

  // Start the stream BEFORE sending so we don't miss early events. The runtime
  // replays buffered events on connect, so ordering here is best-effort.
  const controller = new AbortController();
  const stream = client.streamEvents(sessionId, controller.signal);

  await client.sendMessage(sessionId, options.message, options.agent);

  let reason: DriveResult["reason"] = "stream_end";
  let authoritativeWorkflow = false;
  let workflowEpoch = -1;
  try {
    for await (const evt of stream) {
      events.push(evt);
      onEvent?.(evt);
      if (hasWorkflowStatus(evt)) authoritativeWorkflow = true;
      const workflow = sessionWorkflowState(evt);
      if (workflow && workflow.epoch >= workflowEpoch) {
        workflowEpoch = workflow.epoch;
        if (workflow.status === "idle" && workflow.epoch > 0) {
          reason = "terminal";
          break;
        }
      }
      // Compatibility with runtimes predating workState.status.
      if (!authoritativeWorkflow && isTerminalEvent(evt)) {
        reason = "terminal";
        break;
      }
      if (isCommandComplete(evt)) {
        reason = "command_complete";
        break;
      }
      if (events.length >= maxEvents) {
        reason = "max_events";
        break;
      }
    }
  } finally {
    controller.abort();
  }

  return { sessionId, events, reason };
}

export interface RunDeps extends DriveDeps {
  log?: (msg: string) => void;
}

/**
 * CLI entrypoint logic (parsed args → drive → print). Kept separate from the
 * commander wiring in bin.ts so it can be unit-tested.
 */
export async function run(
  options: DriveOptions & { mock?: boolean },
  deps: RunDeps = {},
): Promise<DriveResult> {
  const log = deps.log ?? ((m: string) => console.log(m));
  const result = await driveSession(options, {
    ...deps,
    onEvent: (evt) => {
      deps.onEvent?.(evt);
      const t = (evt as { type?: string }).type ?? "?";
      log(`[${t}] ${summarize(evt)}`);
    },
  });
  log(`-- done (${result.reason}); ${result.events.length} events`);
  return result;
}

function summarize(evt: AgUiEvent): string {
  const e = evt as Record<string, unknown>;
  if (typeof e.delta === "string") return e.delta;
  if (typeof e.message === "string") return e.message;
  if (typeof e.name === "string") return String(e.name);
  if (e.agent_name) return `agent=${String(e.agent_name)}`;
  return "";
}
