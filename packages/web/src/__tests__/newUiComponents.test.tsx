import { describe, it, expect, vi } from "vitest";

// No jsdom/@testing-library in the monorepo (deps not installable here), so we
// render to static markup with react-dom/server and assert on the output. This
// covers the level→class mapping for the bubble and the structural shape of the
// ask_user card and auto-retry indicator. Interaction (submit/cancel) is covered
// by the pure helpers in newUiEvents.test.ts (resolveAskUserSubmission etc.),
// which are the exact functions these components call.
vi.mock("../i18n/useT", () => ({
  useT: () => (k: string, v?: Record<string, unknown>) => (v ? `${k}:${JSON.stringify(v)}` : k),
}));

import { renderToStaticMarkup } from "react-dom/server";
import { SystemMessageBubble } from "../components/chat/SystemMessageBubble";
import { AskUserCard } from "../components/chat/AskUserCard";
import { AutoRetryIndicator } from "../components/chat/AutoRetryIndicator";

describe("SystemMessageBubble — 4 levels", () => {
  for (const level of ["info", "warning", "error", "fatal"] as const) {
    it(`renders the ${level} bubble`, () => {
      const html = renderToStaticMarkup(
        <SystemMessageBubble
          view={{ level, message: `${level} text`, recoverable: level !== "fatal" }}
        />,
      );
      expect(html).toContain(`system-message--${level}`);
      expect(html).toContain(`${level} text`);
      expect(html).toContain(`data-level="${level}"`);
    });
  }

  it("fatal gets the emphasis modifier + alert role", () => {
    const html = renderToStaticMarkup(
      <SystemMessageBubble view={{ level: "fatal", message: "boom", recoverable: false }} />,
    );
    expect(html).toContain("system-message--emphasis");
    expect(html).toContain('role="alert"');
  });

  it("renders an expandable details block when details present", () => {
    const html = renderToStaticMarkup(
      <SystemMessageBubble
        view={{ level: "error", message: "oops", details: "stack-trace-here", recoverable: true }}
      />,
    );
    expect(html).toContain("<details");
    expect(html).toContain("stack-trace-here");
  });
});

describe("AskUserCard — structure", () => {
  it("renders option buttons + free-text input when open", () => {
    const html = renderToStaticMarkup(
      <AskUserCard
        view={{ requestId: "r1", agent: "principal", question: "Pick", options: ["A", "B"], allowFreeText: true }}
        onSubmit={() => {}}
      />,
    );
    expect(html).toContain("ask-user");
    expect(html).toContain('data-request-id="r1"');
    expect(html).toContain(">A<");
    expect(html).toContain(">B<");
    expect(html).toContain("ask-user__input");
  });

  it("renders the answered state once resolved", () => {
    const html = renderToStaticMarkup(
      <AskUserCard
        view={{ requestId: "r1", agent: "principal", question: "Pick", answer: "A" }}
        onSubmit={() => {}}
      />,
    );
    expect(html).toContain("ask-user--answered");
    expect(html).not.toContain("ask-user__option");
  });
});

describe("AutoRetryIndicator — structure", () => {
  it("renders countdown + cancel button while active", () => {
    const html = renderToStaticMarkup(
      <AutoRetryIndicator
        view={{ attempt: 2, maxAttempts: 5, delayMs: 3000 }}
        onCancel={() => {}}
      />,
    );
    expect(html).toContain("auto-retry");
    expect(html).toContain("auto-retry__cancel");
    expect(html).toContain("chat.retry.attempt");
  });

  it("hides the cancel button once cancelled", () => {
    const html = renderToStaticMarkup(
      <AutoRetryIndicator
        view={{ attempt: 2, maxAttempts: 5, delayMs: 3000, cancelled: true }}
        onCancel={() => {}}
      />,
    );
    expect(html).toContain("auto-retry--cancelled");
    expect(html).not.toContain("auto-retry__cancel");
  });
});
