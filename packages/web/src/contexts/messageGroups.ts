import { ChatMessage } from "../contracts/backend";

/**
 * A unit of rendering in the chat stream. Either a single standalone message
 * (user prompt, assistant text, error, hook note) or an "activity" group that
 * folds adjacent reasoning and tool calls/results into one collapsible block.
 */
export type RenderItem =
  | { type: "single"; message: ChatMessage }
  | { type: "activity"; id: string; steps: ChatMessage[]; streaming: boolean };

/**
 * Standalone kinds render as their own visible card. All assistant text
 * messages — whether they come from the Principal or an Expert agent, and
 * whether they are an intermediate utterance or the turn's final answer —
 * stay standalone so the formal conversation is never hidden behind the
 * "思考过程" fold. Only reasoning (`thinking`) and tool calls/results fold
 * into activity blocks.
 */
function isStandalone(message: ChatMessage): boolean {
  if (message.role === "user") return true;
  if (message.kind === "error" || message.kind === "status" || message.kind === "hook") return true;
  // 修正6 — new-UI kinds each render as their own standalone card.
  if (message.kind === "system_message" || message.kind === "ask_user" || message.kind === "auto_retry") return true;
  if (message.role === "assistant" && (message.kind === "text" || message.kind === undefined)) return true;
  if (message.role === "system" && (message.kind === "text" || message.kind === undefined)) return true;
  return false;
}

/**
 * Transform the flat message list into render items. Adjacent reasoning and
 * tool steps fold into a single activity group; everything else renders
 * standalone. The activity group id is its first step's id so the native
 * <details> DOM node is reused across re-renders, preserving the user's
 * expand/collapse toggle without explicit React state.
 */
export function buildRenderItems(messages: ChatMessage[]): RenderItem[] {
  const items: RenderItem[] = [];
  let buffer: ChatMessage[] = [];
  const flush = () => {
    if (buffer.length === 0) return;
    items.push({
      type: "activity",
      id: buffer[0].id,
      steps: buffer,
      streaming: buffer.some((s) => s.streaming),
    });
    buffer = [];
  };
  for (const m of messages) {
    if (isStandalone(m)) {
      flush();
      items.push({ type: "single", message: m });
    } else {
      buffer.push(m);
    }
  }
  flush();
  return items;
}
