import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AgentStatus, ChatMessage } from "../contracts/backend";
import { DetailsSection } from "../components/primitives/DetailsSection";
import { GlobalOverview } from "../components/session/GlobalOverview";
import { formatModified } from "../components/files/filePreview";

vi.mock("../i18n/useT", () => ({ useT: () => (key: string) => key }));

const overview = (agents: AgentStatus[] = [], messages: ChatMessage[] = []) => renderToStaticMarkup(
  <GlobalOverview agents={agents} messages={messages} edges={[]} totalNodes={agents.length} liveCount={agents.length} now={0} />,
);

describe("optional information", () => {
  it("uses a closed native disclosure and preserves its full contents", () => {
    const html = renderToStaticMarkup(<DetailsSection summary="Details"><p>Complete diagnostic</p></DetailsSection>);
    expect(html).toContain("<summary>Details</summary>");
    expect(html).not.toMatch(/<details[^>]*\sopen/);
    expect(html).toContain("Complete diagnostic");
  });
  it("shows the current state before secondary overview metrics", () => {
    const html = overview();
    expect(html.indexOf("overview.idleSummary")).toBeLessThan(html.indexOf("<details"));
    expect(html).toContain("overview.avgResponse");
    expect(html).not.toMatch(/<details[^>]*\sopen/);
  });
  it.each(["running", "in_progress"])("surfaces active agents (%s)", (status) => {
    expect(overview([{ name: "principal", status } as AgentStatus])).toContain("overview.activeSummary");
  });
  it("surfaces failed agents", () => {
    expect(overview([{ name: "principal", status: "error" } as AgentStatus])).toContain("overview.attentionSummary");
  });
  it("does not call a completed single-agent conversation idle just because there are no network edges", () => {
    expect(overview([], [{ id: "m", kind: "text", role: "assistant", content: "Done", createdAt: "2026-09-16T00:00:00Z" } as ChatMessage])).toContain("overview.finishedSummary");
  });
  it("prioritizes waiting for user input, but not an answered request", () => {
    const message = { id: "ask", kind: "ask_user", askUser: { question: "Continue?", status: "pending" } } as ChatMessage;
    expect(overview([], [message])).toContain("overview.waitingSummary");
    expect(overview([], [{ ...message, askUser: { ...message.askUser!, status: "answered" } }])).not.toContain("overview.waitingSummary");
  });
});

describe("file metadata localization", () => {
  const timestamp = Date.parse("2026-09-16T04:05:00Z") / 1000;
  it.each(["zh-CN", "en-US"])("uses the selected %s language", (locale) => {
    expect(formatModified(timestamp, locale)).toBe(new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp * 1000)));
  });
  it.each([0, NaN, Infinity, -Infinity, 1e20])("does not throw for unavailable/invalid timestamps (%s)", (value) => {
    expect(formatModified(value, "zh-CN")).toBe("-");
  });
});
