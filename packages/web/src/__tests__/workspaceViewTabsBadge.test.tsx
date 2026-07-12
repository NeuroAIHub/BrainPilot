import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkspaceViewTabs } from "../components/shell/DesktopShell";

// Renders to static markup (no jsdom in this monorepo — see vitest.config.ts)
// and asserts the presence/absence of the hidden-error badge (#278) and the
// existing trace-updated badge (#134). The onSelect callback is a spy since
// we're only checking layout, not interaction.

function render(props: {
  currentView: "chat" | "agents" | "trace";
  hiddenErrorsUnread: boolean;
  traceUnread: boolean;
}) {
  return renderToStaticMarkup(
    <WorkspaceViewTabs
      currentView={props.currentView}
      onSelect={vi.fn()}
      hiddenErrorsUnread={props.hiddenErrorsUnread}
      traceUnread={props.traceUnread}
      // Passthrough translator — we only assert on structural markup + aria labels.
      t={(k: string) => k}
    />,
  );
}

// The badge span is unique in the markup; matching a leading substring is
// enough to disambiguate the agents vs. trace instances via their aria-labels.
const AGENTS_BADGE = 'aria-label="shell.view.agentsHasErrors"';
const TRACE_BADGE = 'aria-label="shell.view.traceUpdated"';

describe("WorkspaceViewTabs — hidden-errors badge (issue #278)", () => {
  it("shows the Agents-tab red dot when hiddenErrorsUnread && current view is not agents", () => {
    const html = render({ currentView: "chat", hiddenErrorsUnread: true, traceUnread: false });
    expect(html).toContain(AGENTS_BADGE);
    expect(html).not.toContain(TRACE_BADGE);
  });

  it("hides the dot once the user is on the Agents view (parent context will mark seen)", () => {
    // While already on the agents view the badge must not render even if
    // hiddenErrorsUnread is still true — the parent effect clears it on the
    // next tick, but during the same frame the tab hides its own dot to
    // avoid flashing.
    const html = render({ currentView: "agents", hiddenErrorsUnread: true, traceUnread: false });
    expect(html).not.toContain(AGENTS_BADGE);
  });

  it("hides the dot when there are no folded errors", () => {
    const html = render({ currentView: "chat", hiddenErrorsUnread: false, traceUnread: false });
    expect(html).not.toContain(AGENTS_BADGE);
  });

  it("renders both dots when trace has updates AND errors were folded", () => {
    const html = render({ currentView: "chat", hiddenErrorsUnread: true, traceUnread: true });
    expect(html).toContain(AGENTS_BADGE);
    expect(html).toContain(TRACE_BADGE);
  });

  it("still renders the Trace dot independently (regression guard for #134)", () => {
    const html = render({ currentView: "chat", hiddenErrorsUnread: false, traceUnread: true });
    expect(html).not.toContain(AGENTS_BADGE);
    expect(html).toContain(TRACE_BADGE);
  });
});
