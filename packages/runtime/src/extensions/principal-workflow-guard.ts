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

const INFORMATIONAL_REQUEST = /^(?:what\s+(?:is|are|does)|why\b|how\s+(?:do|does|is|are|can|could|would|should|to)\b|(?:(?:please|can you|could you)\s+)?(?:explain|define|describe|summari[sz]e|translate|proofread|rewrite|polish)\b|什么是|为什么|为何|如何理解|怎么理解|(?:请(?:帮我)?)?(?:解释|介绍|概述|总结|翻译|润色))/i;
// Evaluation/smoke-test prompts often contain a literal phrase such as
// "model test passed". Classifying the requested output text as user intent
// arms the delegation guard, which then runs the provider twice and exposes
// two assistant messages. Only exempt explicit literal-output forms; a request
// such as "Reply after you test this dataset" must still be classified by its
// substantive action.
const LITERAL_OUTPUT_REQUEST = /^(?:(?:please|kindly)\s+)?(?:reply|respond|answer|say|repeat|echo|return|output)\s+(?:(?:with|using)\s+)?(?:exactly\b|only\s+(?:with\s+)?(?:the\s+)?(?:word|phrase|text|string)\b)|^(?:请)?(?:只|仅)(?:回复|回答|输出|返回)(?:一句|以下)?(?=\s*[:："'“])/i;
const CONCEPTUAL_REQUEST = /\b(?:principles?|concepts?|differences?|pros?\s+and\s+cons?|advantages?|disadvantages?|overview|tutorial|meaning|definition|theory)\b|(?:原理|概念|区别|差异|优缺点|优势|劣势|含义|定义|理论|教程)/i;
const DIRECT_EXECUTION_ACTION = /\b(?:process|clean|transform|train|fit|fine[- ]?tune|optimi[sz]e|simulate|run|execute|implement|build|develop|design|perform|conduct|model|predict|classify|cluster|forecast)\b|(?:处理|清洗|转换|训练|拟合|微调|优化|模拟|运行|执行|实现|构建|开发|设计|建模|预测|分类|聚类)/i;
const INPUT_BOUND_ACTION = /\b(?:analy[sz]e|evaluate|benchmark|validate|test|compare|interpret|infer|inspect|check|find|detect|identify)\b|(?:分析|评估|基准测试|验证|测试|比较|解读|推断|检查|查看|看看|寻找|找出|识别|检测)/i;
const SCIENTIFIC_SCOPE = /\b(?:data|dataset|experiment|study|analysis|model|statistic|inference|training|evaluation|benchmark|simulation|prediction|classification|clustering|forecast|scientific|literature|results?|treatments?)s?\b|(?:数据|数据集|实验|研究|分析|模型|统计|推断|训练|评估|基准|模拟|预测|分类|聚类|科学|文献|结果|处理组)/i;
const CONCRETE_INPUT = /\b(?:(?:this|that|these|those|the|my|our|attached|uploaded|provided|given|current|existing)\s+(?:[\w-]+\s+){0,3}(?:data|dataset|file|table|results?|predictions?|checkpoint|validation\s+set|test\s+set)|(?:attached|uploaded|provided|trained|saved)\s+(?:[\w-]+\s+){0,2}models?)\b|(?:[\w./-]+\.(?:csv|tsv|json|jsonl|parquet|xlsx?|sav|h5|pt|pth|onnx))\b|(?:(?:这个|这份|这组|这些|上述|当前|现有|我的|我们的|附件中的|上传的|提供的)(?:[^，。,.]{0,12})(?:数据|数据集|文件|表格|结果|预测|检查点|验证集|测试集)|(?:上传的|提供的|训练好的|保存的)(?:[^，。,.]{0,8})模型)/i;

const ATTACHMENT_NOTICE = /^\[(?:Conversation attachments[^\]]*|本次对话附件[^\]]*)\]\s*/iu;
const TEST_INPUT_NOUN = /\btest\s+(?:file|attachment)\b|测试(?:文件|附件|样本)(?!中|里|内)/giu;

function intentText(content: string): string {
  // The web prepends a localized transport notice containing attachment names.
  // Those implementation details must not affect the host's intent classifier.
  // Also neutralize noun phrases such as “test file”: test describes the
  // input there, while “test the attached dataset” remains an execution verb.
  return content
    .replace(ATTACHMENT_NOTICE, "")
    .replace(TEST_INPUT_NOUN, (phrase) => phrase.replace(/^(?:test|测试)/iu, ""))
    .trim();
}

/** Host-side gate for the bounded delegation reminder; prompt prose alone cannot suppress a follow-up. */
export function isSubstantiveScientificExecutionRequest(content: string): boolean {
  const normalized = intentText(content);
  if (
    !normalized
    || INFORMATIONAL_REQUEST.test(normalized)
    || LITERAL_OUTPUT_REQUEST.test(normalized)
  ) return false;
  const hasConcreteInput = CONCRETE_INPUT.test(normalized);
  if (CONCEPTUAL_REQUEST.test(normalized) && !hasConcreteInput) return false;
  return (DIRECT_EXECUTION_ACTION.test(normalized) && SCIENTIFIC_SCOPE.test(normalized))
    || (hasConcreteInput && INPUT_BOUND_ACTION.test(normalized));
}

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
  "This is an internal follow-up: do not repeat or revise the user-facing answer. End with exactly " +
  "<!--NO-RENDER-->workflow reminder handled<!--/NO-RENDER--> and no text outside that wrapper. " +
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
