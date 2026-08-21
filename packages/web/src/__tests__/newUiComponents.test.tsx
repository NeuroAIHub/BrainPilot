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
import { AskUserComposer } from "../components/chat/AskUserComposer";
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

  it("renders a localized workspace restore summary without internal paths", () => {
    const html = renderToStaticMarkup(
      <SystemMessageBubble
        view={{
          level: "info",
          message: "fallback",
          recoverable: true,
          code: "workspace_restored",
          workspaceRestore: {
            mode: "checkpoint",
            checkpointId: "checkpoint_abcdef123456",
            restoredAt: "2026-08-21T01:02:03.000Z",
            files: ["reports/result.md"],
            fileCount: 1,
          },
        }}
      />,
    );
    expect(html).toContain("chat.restore.title");
    expect(html).toContain("chat.restore.checkpointSuccess");
    expect(html).toContain("result.md");
    expect(html).not.toContain("reports/result.md");
  });
});

describe("AskUserCard — structure", () => {
  it("renders a record (options listed, no live inputs) when open", () => {
    // #272: the card is a record only; interaction moved to the composer
    // takeover. Options are listed for context but there are no buttons/inputs.
    const html = renderToStaticMarkup(
      <AskUserCard
        view={{ requestId: "r1", agent: "principal", question: "Pick", options: ["A", "B"], allowFreeText: true }}
      />,
    );
    expect(html).toContain("ask-user");
    expect(html).toContain('data-request-id="r1"');
    expect(html).toContain(">A<");
    expect(html).toContain(">B<");
    // no interactive controls in the stream card anymore
    expect(html).not.toContain("ask-user__input");
    expect(html).not.toContain("<button");
    expect(html).toContain("ask-user__pending");
  });

  it("renders the answered state once resolved", () => {
    const html = renderToStaticMarkup(
      <AskUserCard view={{ requestId: "r1", agent: "principal", question: "Pick", answer: "A" }} />,
    );
    expect(html).toContain("ask-user--answered");
    expect(html).not.toContain("ask-user__option-record");
  });

  it("renders a cancelled request as a read-only expired record", () => {
    const html = renderToStaticMarkup(
      <AskUserCard
        view={{
          requestId: "r1",
          agent: "principal",
          question: "Pick",
          status: "cancelled",
          cancellationReason: "interrupted",
        }}
      />,
    );
    expect(html).toContain("ask-user--cancelled");
    expect(html).toContain("chat.ask.cancelled");
    expect(html).not.toContain("ask-user__pending");
  });

  it("renders submitting separately from answered", () => {
    const html = renderToStaticMarkup(
      <AskUserCard
        view={{
          requestId: "r1",
          agent: "principal",
          question: "Pick",
          answer: "A",
          status: "submitting",
        }}
      />,
    );
    expect(html).toContain("ask-user--submitting");
    expect(html).toContain("chat.ask.submitting");
    expect(html).not.toContain("ask-user--answered");
  });
});

describe("AskUserComposer — takeover picker (#272)", () => {
  it("renders numbered options + submit when options are present", () => {
    const html = renderToStaticMarkup(
      <AskUserComposer
        view={{ requestId: "r1", agent: "principal", question: "Pick", options: ["Walk", "Coffee"] }}
        onSubmit={() => {}}
      />,
    );
    expect(html).toContain("ask-user-composer");
    expect(html).toContain('data-request-id="r1"');
    expect(html).toContain(">Walk<");
    expect(html).toContain(">Coffee<");
    // numbered (1-indexed) + submit control
    expect(html).toContain(">1<");
    expect(html).toContain(">2<");
    expect(html).toContain("ask-user-composer__submit");
    // #272: no escape hatch — there is no "ignore/dismiss" control.
    expect(html).not.toContain("ask-user-composer__ignore");
    // Free text defaults to enabled when the tool omits the flag.
    expect(html).toContain("ask-user-composer__input");
    expect(html).toContain("ask-user-composer__option--free");
  });

  it("renders a free-text row when there are no options", () => {
    const html = renderToStaticMarkup(
      <AskUserComposer
        view={{ requestId: "r3", agent: "principal", question: "Free?" }}
        onSubmit={() => {}}
      />,
    );
    expect(html).toContain("ask-user-composer__input");
  });

  it("hides the free-text row when the tool disables it", () => {
    const html = renderToStaticMarkup(
      <AskUserComposer
        view={{
          requestId: "r4",
          agent: "principal",
          question: "Pick",
          options: ["A", "B"],
          allowFreeText: false,
        }}
        onSubmit={() => {}}
      />,
    );
    expect(html).toContain(">A<");
    expect(html).not.toContain("ask-user-composer__input");
    expect(html).not.toContain("ask-user-composer__option--free");
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
