import { describe, expect, it } from "vitest";
import { SessionManager } from "../session-manager.js";
import { mockAgentFactory } from "../agent-factory.js";
import type { AgentSessionFactory } from "../types.js";

async function waitFor(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("Auditor recent user context", () => {
  it("resets on a new epoch, retains ask_user answers, and injects only Auditor", async () => {
    type Params = Parameters<AgentSessionFactory>[0];
    const captured = new Map<string, Params>();
    const factory: AgentSessionFactory = async (params) => {
      captured.set(params.agentName, params);
      return mockAgentFactory(params);
    };
    const manager = new SessionManager({ persist: false, agentFactory: factory });
    const session = await manager.createSession({});

    await manager.sendMessage(session.id, "obsolete request");
    await waitFor(() => manager.getSessionState(session.id)?.workState.status === "idle");
    await manager.sendMessage(session.id, "current request");
    await waitFor(() => manager.getSessionState(session.id)?.workState.status === "idle");

    const principal = captured.get("principal")!;
    const askUser = principal.systemTools.find((tool) => tool.name === "ask_user")!;
    let requestId = "";
    manager.subscribe(session.id, (event) => {
      if (event.type === "user_input_request") {
        requestId = String(event.request_id ?? "");
      }
    });
    const pendingAnswer = askUser.execute({ question: "Continue?", options: ["yes", "no"] });
    await waitFor(() => Boolean(requestId));
    await expect(manager.answerInput(session.id, requestId, "yes")).resolves.toBe("ok");
    await pendingAnswer;

    const dispatch = principal.systemTools.find((tool) => tool.name === "dispatch_task")!;
    await dispatch.execute({ to: "auditor", content: "audit candidate" });
    await dispatch.execute({ to: "librarian", content: "inspect sources" });
    await waitFor(() => captured.has("auditor") && captured.has("librarian"));

    const auditorContext = captured.get("auditor")!.renderTaskContext?.() ?? "";
    const librarianContext = captured.get("librarian")!.renderTaskContext?.() ?? "";
    expect(auditorContext).toContain("<recent_user_messages>");
    expect(auditorContext).toContain("current request");
    expect(auditorContext).toContain("yes");
    expect(auditorContext).not.toContain("obsolete request");
    expect(librarianContext).not.toContain("<recent_user_messages>");
  });
});
