import { describe, expect, it, vi } from "vitest";
import {
  isSubstantiveScientificExecutionRequest,
  makePrincipalWorkflowGuardExt,
  renderPrincipalWorkflowBlock,
  WORKFLOW_TAG_OPEN,
} from "../extensions/principal-workflow-guard.js";

type ContextHandler = (event: { messages: Message[] }) => { messages: Message[] } | void;
type EndHandler = (event: { messages?: Array<{ role?: string; stopReason?: string }> }) => void | Promise<void>;
type Message = { role: string; content: Array<{ type: string; text?: string }> };

class FakePi {
  context?: ContextHandler;
  end?: EndHandler;
  followUps: string[] = [];

  on(event: string, handler: ContextHandler | EndHandler): void {
    if (event === "context") this.context = handler as ContextHandler;
    if (event === "agent_end") this.end = handler as EndHandler;
  }

  sendUserMessage(content: string): void {
    this.followUps.push(content);
  }
}

function setup(overrides: {
  required?: boolean;
  delegated?: boolean;
  claim?: () => boolean | Promise<boolean>;
} = {}) {
  let required = overrides.required ?? true;
  let delegated = overrides.delegated ?? false;
  const violation = vi.fn();
  const pi = new FakePi();
  makePrincipalWorkflowGuardExt({
    renderState: () => renderPrincipalWorkflowBlock(required && !delegated),
    hasQualifyingDelegation: () => delegated,
    claimReminder: overrides.claim ?? (() => true),
    onViolation: violation,
  })(pi as never);
  return {
    pi,
    violation,
    setRequired: (value: boolean) => { required = value; },
    setDelegated: (value: boolean) => { delegated = value; },
  };
}

describe("principal workflow guard", () => {
  it("requires the host guard only for explicit scientific execution requests", () => {
    expect(isSubstantiveScientificExecutionRequest("What is a confidence interval?")).toBe(false);
    expect(isSubstantiveScientificExecutionRequest("Explain how model training works.")).toBe(false);
    expect(isSubstantiveScientificExecutionRequest("Please explain how to train a model.")).toBe(false);
    expect(isSubstantiveScientificExecutionRequest("请介绍一下模型训练")).toBe(false);
    expect(isSubstantiveScientificExecutionRequest("Polish this document.")).toBe(false);
    expect(isSubstantiveScientificExecutionRequest("Compare regression and classification models.")).toBe(false);
    expect(isSubstantiveScientificExecutionRequest("比较这两种模型的原理。")).toBe(false);
    expect(isSubstantiveScientificExecutionRequest("Train a model on the dataset and evaluate it.")).toBe(true);
    expect(isSubstantiveScientificExecutionRequest("Design an experiment to compare treatments.")).toBe(true);
    expect(isSubstantiveScientificExecutionRequest("Find patterns in this dataset.")).toBe(true);
    expect(isSubstantiveScientificExecutionRequest("帮我看看这组数据，找出异常。")).toBe(true);
    expect(isSubstantiveScientificExecutionRequest("请分析这个数据集并训练模型")).toBe(true);
  });

  it("injects one fresh ephemeral state block and removes stale copies", () => {
    const { pi, setDelegated } = setup();
    const stale: Message = {
      role: "user",
      content: [{ type: "text", text: `${WORKFLOW_TAG_OPEN}\nstale` }],
    };
    const original: Message = { role: "user", content: [{ type: "text", text: "task" }] };
    const injected = pi.context!({ messages: [original, stale] });
    expect(injected?.messages).toHaveLength(2);
    expect(injected?.messages[1]?.content[0]?.text).toContain("only for substantive scientific execution");
    expect(injected?.messages[1]?.content[0]?.text).toContain("do not require Expert delegation");
    expect(injected?.messages[1]?.content[0]?.text).not.toContain("Do not perform or finalize");

    setDelegated(true);
    const stripped = pi.context!({ messages: injected!.messages });
    expect(stripped?.messages).toEqual([original]);
  });

  it("sends one follow-up, then records a violation without looping", async () => {
    const { pi, violation } = setup();
    await pi.end!({ messages: [{ role: "assistant", stopReason: "stop" }] });
    expect(pi.followUps).toHaveLength(1);
    expect(pi.followUps[0]).toContain("If the request involves substantive scientific execution");
    expect(pi.followUps[0]).toContain("consider dispatching a qualifying Expert task");
    expect(pi.followUps[0]).not.toContain("Do not perform or finalize");

    await pi.end!({ messages: [{ role: "assistant", stopReason: "stop" }] });
    expect(pi.followUps).toHaveLength(1);
    expect(violation).toHaveBeenCalledOnce();
  });

  it("does nothing for direct work, successful delegation, errors, or an already-claimed epoch", async () => {
    const direct = setup({ required: false });
    await direct.pi.end!({ messages: [{ role: "assistant", stopReason: "stop" }] });
    expect(direct.pi.followUps).toEqual([]);

    const delegated = setup({ delegated: true });
    await delegated.pi.end!({ messages: [{ role: "assistant", stopReason: "stop" }] });
    expect(delegated.pi.followUps).toEqual([]);

    const errored = setup();
    await errored.pi.end!({ messages: [{ role: "assistant", stopReason: "error" }] });
    expect(errored.pi.followUps).toEqual([]);

    const claimed = setup({ claim: () => false });
    await claimed.pi.end!({ messages: [{ role: "assistant", stopReason: "stop" }] });
    expect(claimed.pi.followUps).toEqual([]);
  });
});
