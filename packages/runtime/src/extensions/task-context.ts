/** Injects current tasks and optional Auditor-only user context without persisting either. */
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
const USER_TAG_OPEN = "<recent_user_messages>";
const USER_TAG_CLOSE = "</recent_user_messages>";

export const AUDITOR_USER_MESSAGE_LIMIT = 5;
export const AUDITOR_USER_CONTEXT_MAX_CHARS = 16_000;

export interface TaskContextDeps {
  renderTasks: () => string;
}

export function appendRecentUserMessage(
  current: readonly string[],
  message: string,
  limit = AUDITOR_USER_MESSAGE_LIMIT,
): string[] {
  if (limit <= 0) return [];
  return [...current, message].slice(-limit);
}

function jsonForContext(value: string): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");
}

function truncatedMessage(value: string, retainedChars: number): string {
  const marker = " … [truncated] … ";
  const keep = Math.max(0, retainedChars - marker.length);
  const head = Math.ceil(keep / 2);
  const tail = Math.floor(keep / 2);
  return `${value.slice(0, head)}${marker}${tail > 0 ? value.slice(-tail) : ""}`;
}

export function renderRecentUserMessagesBlock(
  messages: readonly string[],
  limit = AUDITOR_USER_MESSAGE_LIMIT,
  maxChars = AUDITOR_USER_CONTEXT_MAX_CHARS,
): string {
  if (messages.length === 0 || limit <= 0 || maxChars <= 0) return "";
  const candidates = messages.slice(-limit);
  const header = [
    USER_TAG_OPEN,
    "Runtime-owned user messages for the current workflow, oldest to newest. PI summaries and audit-request wording do not replace them.",
  ];
  const assemble = (entries: readonly string[], omitted: number): string => [
    ...header,
    ...(omitted > 0 ? [`- ... ${omitted} older or over-budget user message(s) omitted`] : []),
    ...entries.map((entry) => `- ${entry}`),
    USER_TAG_CLOSE,
  ].join("\n");

  const selected: string[] = [];
  for (let index = candidates.length - 1; index >= 0; index--) {
    const encoded = jsonForContext(candidates[index]!);
    const next = [encoded, ...selected];
    const omitted = messages.length - next.length;
    if (assemble(next, omitted).length > maxChars) break;
    selected.unshift(encoded);
  }
  if (selected.length > 0) return assemble(selected, messages.length - selected.length);

  const newest = candidates.at(-1)!;
  let low = 0;
  let high = newest.length;
  let best = "";
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const encoded = jsonForContext(truncatedMessage(newest, middle));
    const rendered = assemble([encoded], messages.length - 1);
    if (rendered.length <= maxChars) {
      best = rendered;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return best;
}

export function renderTaskListBlock(
  assigned: readonly { id: string; created_by: string; content: string }[],
  delegated: readonly { id: string; assigned_to: string; content: string }[],
  maxChars = 24_000,
  recentUserMessages: readonly string[] = [],
): string {
  if (assigned.length === 0 && delegated.length === 0) return "";
  const recentUserBlock = renderRecentUserMessagesBlock(recentUserMessages);
  const lines = [
    TAG_OPEN,
    "Current pending tasks, oldest first. Use dispatch_task to assign work and complete_task with the exact task ID to return a result.",
    "Never claim completion while <delegated_by_me> contains reply_received=false. Give only an explicit interim update, then wait for the delegated result before the final answer.",
    ...(recentUserBlock ? recentUserBlock.split("\n") : []),
    "<assigned_to_me>",
  ];
  let includedAssigned = 0;
  let includedDelegated = 0;
  const append = (line: string): boolean => {
    const taskChars = lines.join("\n").length - recentUserBlock.length;
    if (taskChars + line.length + TAG_CLOSE.length + 100 > maxChars) return false;
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
