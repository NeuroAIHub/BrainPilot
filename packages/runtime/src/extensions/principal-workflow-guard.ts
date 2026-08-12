/** Ephemeral guidance and one bounded follow-up for required PI delegation. */
interface PiContextMessage {
  role: string;
  content: Array<{ type: string; text?: string }>;
  timestamp?: number;
}

interface AgentEndLike {
  messages?: Array<{ role?: string; stopReason?: string }>;
}

interface PiExtensionApi {
  on(
    event: "context",
    handler: (event: { messages: PiContextMessage[] }) =>
      | { messages: PiContextMessage[] }
      | void,
  ): void;
  on(event: "agent_end", handler: (event: AgentEndLike) => void | Promise<void>): void;
  sendUserMessage(content: string, options?: { deliverAs?: "steer" | "followUp" }): void;
}

export interface PrincipalWorkflowGuardDeps {
  /** Fresh host-owned state block; empty when delegation is not currently required. */
  renderState: () => string;
  /** True only after a qualifying Expert dispatch in the current user-work epoch. */
  hasQualifyingDelegation: () => boolean;
  /** Atomically claim the epoch's single reminder. */
  claimReminder: () => boolean | Promise<boolean>;
  /** Record/surface a model that ignored the one reminder. */
  onViolation: () => void | Promise<void>;
}

export const WORKFLOW_TAG_OPEN = "<principal_workflow_state>";
export const WORKFLOW_TAG_CLOSE = "</principal_workflow_state>";

export function renderPrincipalWorkflowBlock(required: boolean): string {
  if (!required) return "";
  return [
    WORKFLOW_TAG_OPEN,
    "Internal coordination guidance. Do not quote or summarize this block to the user.",
    "Expert delegation guidance applies only for substantive scientific execution.",
    "If the request involves dataset processing, experiment or analysis design, modelling, statistical inference, training, evaluation, or scientific interpretation, consider dispatching an appropriate Expert.",
    "Simple questions, document-only work, and summaries of already-validated results do not require Expert delegation.",
    WORKFLOW_TAG_CLOSE,
  ].join("\n");
}

function isWorkflowMessage(message: PiContextMessage): boolean {
  return message.role === "user" && message.content.some(
    (part) => part.type === "text" && (part.text ?? "").startsWith(WORKFLOW_TAG_OPEN),
  );
}

function endedInError(event: AgentEndLike): boolean {
  const messages = event.messages;
  if (!Array.isArray(messages)) return false;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;
    return message.stopReason === "error" || message.stopReason === "aborted";
  }
  return false;
}

const DELEGATION_REMINDER =
  "[SYSTEM-MESSAGE:workflow] If the request involves substantive scientific execution, " +
  "consider dispatching a qualifying Expert task before finalizing it. Simple questions, " +
  "document-only work, and summaries of already-validated results do not need delegation. " +
  "[/SYSTEM-MESSAGE]";

/**
 * The context hook is advisory and fresh on every model call. The agent-end
 * hook forces at most one follow-up per host-owned work epoch; it never loops.
 */
export function makePrincipalWorkflowGuardExt(
  deps: PrincipalWorkflowGuardDeps,
): (pi: PiExtensionApi) => void {
  return (pi) => {
    let reminderFollowUpActive = false;

    pi.on("context", (event) => {
      const stripped = event.messages.filter((message) => !isWorkflowMessage(message));
      const block = deps.renderState();
      if (!block) {
        return stripped.length === event.messages.length ? undefined : { messages: stripped };
      }
      stripped.push({ role: "user", content: [{ type: "text", text: block }] });
      return { messages: stripped };
    });

    pi.on("agent_end", async (event) => {
      if (endedInError(event) || deps.hasQualifyingDelegation()) {
        reminderFollowUpActive = false;
        return;
      }
      if (!deps.renderState()) return;

      if (reminderFollowUpActive) {
        reminderFollowUpActive = false;
        await deps.onViolation();
        return;
      }

      if (!(await deps.claimReminder())) return;
      reminderFollowUpActive = true;
      pi.sendUserMessage(DELEGATION_REMINDER, { deliverAs: "followUp" });
    });
  };
}
