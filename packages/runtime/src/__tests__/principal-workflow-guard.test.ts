import { describe, expect, it, vi } from "vitest";
import {
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
  it("injects one fresh ephemeral state block and removes stale copies", () => {
    const { pi, setDelegated } = setup();
    const stale: Message = {
      role: "user",
      content: [{ type: "text", text: `${WORKFLOW_TAG_OPEN}\nstale` }],
    };
    const original: Message = { role: "user", content: [{ type: "text", text: "task" }] };
    const injected = pi.context!({ messages: [original, stale] });
    expect(injected?.messages).toHaveLength(2);
    expect(injected?.messages[1]?.content[0]?.text).toContain("requires a qualifying Expert delegation");

    setDelegated(true);
    const stripped = pi.context!({ messages: injected!.messages });
    expect(stripped?.messages).toEqual([original]);
  });

  it("sends one follow-up, then records a violation without looping", async () => {
    const { pi, violation } = setup();
    await pi.end!({ messages: [{ role: "assistant", stopReason: "stop" }] });
    expect(pi.followUps).toHaveLength(1);
    expect(pi.followUps[0]).toContain("Dispatch a qualifying Expert task now");

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
