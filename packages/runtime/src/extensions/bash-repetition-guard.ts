/** Bound high-frequency repeated Bash calls without persisting reminder text. */

interface PiContextMessage {
  role: string;
  content: Array<{ type: string; text?: string }>;
  timestamp?: number;
}

interface PiExtensionApi {
  on(event: "agent_start", handler: () => void): void;
  on(
    event: "context",
    handler: (event: { messages: PiContextMessage[] }) =>
      | { messages: PiContextMessage[] }
      | void,
  ): void;
  on(
    event: "tool_execution_end",
    handler: (event: { toolName: string; isError: boolean }) => void,
  ): void;
}

export interface BashRepetitionDecision {
  terminate: boolean;
  message?: string;
}

export interface BashRepetitionGuard {
  beforeBash(command: string): BashRepetitionDecision;
  extension: (pi: PiExtensionApi) => void;
}

export interface BashRepetitionGuardOptions {
  now?: () => number;
}

export const BASH_REPETITION_TAG_OPEN = "<bash_repetition_warning>";
const BASH_REPETITION_TAG_CLOSE = "</bash_repetition_warning>";
export const BASH_REPETITION_WINDOW_MS = 60_000;
export const BASH_REPETITION_WARNING_COUNT = 3;
export const BASH_REPETITION_TERMINATION_COUNT = 5;

export const BASH_REPETITION_WARNING = [
  BASH_REPETITION_TAG_OPEN,
  "Repeated Bash execution was detected within the last 60 seconds.",
  "",
  "Do not use Bash, sleep, tail, ps, ls, or process inspection to wait for progress. " +
    "If a managed background job is running, end this turn and wait for its completion event. " +
    "Re-run the command only when new evidence or a concrete workflow change justifies it.",
  "",
  "Runtime enforcement: if the same Bash command reaches five executions within this detection " +
    "window without an intervening state-changing action, the fifth execution will be blocked " +
    "and the current agent turn will terminate automatically.",
  BASH_REPETITION_TAG_CLOSE,
].join("\n");

export const BASH_REPETITION_TERMINATION_MESSAGE = [
  "Repeated Bash execution reached the runtime safety limit.",
  "The command was not executed, and this turn is ending automatically.",
  "Wait for an event-driven completion notification or resume after a meaningful state change.",
].join("\n");

function normalizeCommand(command: string): string {
  const output: string[] = [];
  let quote: "'" | '"' | undefined;
  let escaped = false;
  let pendingSpace = false;

  for (const character of command.trim()) {
    if (escaped) {
      output.push(character);
      escaped = false;
      continue;
    }
    if (character === "\\") {
      output.push(character);
      escaped = true;
      continue;
    }
    if (quote) {
      output.push(character);
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === "'" || character === '"') {
      if (pendingSpace && output.length > 0) output.push(" ");
      pendingSpace = false;
      quote = character;
      output.push(character);
      continue;
    }
    if (/\s/u.test(character)) {
      pendingSpace = output.length > 0;
      continue;
    }
    if (pendingSpace) output.push(" ");
    pendingSpace = false;
    output.push(character);
  }
  return output.join("");
}

function isWarningMessage(message: PiContextMessage): boolean {
  return message.role === "user" && message.content.some(
    (part) => part.type === "text" && (part.text ?? "").startsWith(BASH_REPETITION_TAG_OPEN),
  );
}

export function createBashRepetitionGuard(
  options: BashRepetitionGuardOptions = {},
): BashRepetitionGuard {
  const now = options.now ?? Date.now;
  const attempts = new Map<string, number[]>();
  const warned = new Set<string>();
  let warningPending = false;

  const reset = (): void => {
    attempts.clear();
    warned.clear();
    warningPending = false;
  };

  const beforeBash = (command: string): BashRepetitionDecision => {
    const fingerprint = normalizeCommand(command);
    if (!fingerprint) return { terminate: false };

    const timestamp = now();
    const recent = (attempts.get(fingerprint) ?? [])
      .filter((attemptedAt) => timestamp - attemptedAt <= BASH_REPETITION_WINDOW_MS);
    if (recent.length === 0) warned.delete(fingerprint);
    recent.push(timestamp);
    attempts.set(fingerprint, recent);

    if (recent.length >= BASH_REPETITION_TERMINATION_COUNT) {
      return { terminate: true, message: BASH_REPETITION_TERMINATION_MESSAGE };
    }
    if (recent.length >= BASH_REPETITION_WARNING_COUNT && !warned.has(fingerprint)) {
      warned.add(fingerprint);
      warningPending = true;
    }
    return { terminate: false };
  };

  const extension = (pi: PiExtensionApi): void => {
    pi.on("agent_start", reset);

    pi.on("tool_execution_end", (event) => {
      const tool = event.toolName.toLowerCase();
      if (!event.isError && (tool === "write" || tool === "edit")) reset();
    });

    pi.on("context", (event) => {
      const stripped = event.messages.filter((message) => !isWarningMessage(message));
      const removedSome = stripped.length !== event.messages.length;
      if (!warningPending) return removedSome ? { messages: stripped } : undefined;

      warningPending = false;
      stripped.push({
        role: "user",
        content: [{ type: "text", text: BASH_REPETITION_WARNING }],
      });
      return { messages: stripped };
    });
  };

  return { beforeBash, extension };
}
