/** Injects the current flat task list into every model turn without persisting it. */
interface PiContextMessage {
  role: string;
  content: Array<{ type: string; text?: string }>;
  timestamp?: number;
}

interface PiExtensionApi {
  on(
    event: "context",
    handler: (e: { messages: PiContextMessage[] }) => { messages: PiContextMessage[] } | void,
  ): void;
}

const TAG_OPEN = "<task_list>";
const TAG_CLOSE = "</task_list>";

export interface TaskContextDeps {
  renderTasks: () => string;
}

export function renderTaskListBlock(
  assigned: readonly { id: string; created_by: string; content: string }[],
  delegated: readonly { id: string; assigned_to: string; content: string }[],
  maxChars = 24_000,
): string {
  if (assigned.length === 0 && delegated.length === 0) return "";
  const lines = [
    TAG_OPEN,
    "Current pending tasks, oldest first. Use dispatch_task to assign work and complete_task with the exact task ID to return a result.",
    "Never claim completion while <delegated_by_me> contains reply_received=false. Give only an explicit interim update, then wait for the delegated result before the final answer.",
    "<assigned_to_me>",
  ];
  let includedAssigned = 0;
  let includedDelegated = 0;
  const append = (line: string): boolean => {
    if (lines.join("\n").length + line.length + TAG_CLOSE.length + 100 > maxChars) return false;
    lines.push(line);
    return true;
  };
  for (const task of assigned) {
    if (!append(`- ${task.id} from=${task.created_by}: ${task.content}`)) break;
    includedAssigned++;
  }
  if (includedAssigned < assigned.length) lines.push(`- ... ${assigned.length - includedAssigned} more assigned task(s) omitted by context budget`);
  lines.push("</assigned_to_me>", "<delegated_by_me>");
  for (const task of delegated) {
    if (!append(`- ${task.id} to=${task.assigned_to} reply_received=false: ${task.content}`)) break;
    includedDelegated++;
  }
  if (includedDelegated < delegated.length) lines.push(`- ... ${delegated.length - includedDelegated} more delegated task(s) omitted by context budget`);
  lines.push("</delegated_by_me>", TAG_CLOSE);
  return lines.join("\n");
}

function isTaskContextMessage(message: PiContextMessage): boolean {
  return message.role === "user" && message.content.some(
    (part) => part.type === "text" && (part.text ?? "").startsWith(TAG_OPEN),
  );
}

export function makeTaskContextExt(deps: TaskContextDeps): (pi: PiExtensionApi) => void {
  return (pi) => {
    pi.on("context", (event) => {
      const stripped = event.messages.filter((message) => !isTaskContextMessage(message));
      const block = deps.renderTasks();
      if (!block) return stripped.length === event.messages.length ? undefined : { messages: stripped };
      stripped.push({ role: "user", content: [{ type: "text", text: block }] });
      return { messages: stripped };
    });
  };
}
