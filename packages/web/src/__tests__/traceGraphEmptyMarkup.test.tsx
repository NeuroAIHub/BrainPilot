import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TraceGraphView } from "../components/session/TraceGraphView";

// No jsdom — assert empty-state markup via renderToStaticMarkup (#317).

describe("TraceGraphView empty markup (#317)", () => {
  it("renders the provided empty label when there are no nodes", () => {
    const html = renderToStaticMarkup(
      <TraceGraphView
        nodes={[]}
        direction="LR"
        selectedNodeId={null}
        onSelectNode={() => {}}
        zoom={1}
        onZoomChange={() => {}}
        emptyLabel={"This conversation has not produced any Trace nodes yet.\nSend a research message."}
      />,
    );
    expect(html).toContain("trace-empty");
    expect(html).toContain("This conversation has not produced any Trace nodes yet.");
    expect(html).toContain("Send a research message.");
  });

  it("renders filter no-match copy when that label is passed", () => {
    const html = renderToStaticMarkup(
      <TraceGraphView
        nodes={[]}
        direction="LR"
        selectedNodeId={null}
        onSelectNode={() => {}}
        zoom={1}
        onZoomChange={() => {}}
        emptyLabel="No trace nodes match the current filters."
      />,
    );
    expect(html).toContain("No trace nodes match the current filters.");
  });

  it("does not render the empty class when nodes are present", () => {
    const node = {
      id: "a",
      title: "Task A",
      type: "task",
      status: "completed",
      parents: [] as { id: string; title?: string }[],
      parentIds: [] as string[],
      childIds: [] as string[],
      artifacts: [] as { path: string }[],
      toolCalls: [] as string[],
    };
    const html = renderToStaticMarkup(
      <TraceGraphView
        nodes={[node as never]}
        direction="LR"
        selectedNodeId="a"
        onSelectNode={() => {}}
        zoom={1}
        onZoomChange={() => {}}
        emptyLabel="should not appear"
      />,
    );
    expect(html).not.toContain("trace-empty");
    expect(html).not.toContain("should not appear");
    expect(html).toContain("Task A");
  });

  it("shows the Episode name on a node card without exposing its ID", () => {
    const node = {
      id: "result-a",
      title: "No-dropout result",
      type: "result",
      status: "completed",
      primaryEpisodeId: "ep-private-id",
      parents: [] as { id: string; title?: string }[],
      parentIds: [] as string[],
      childIds: [] as string[],
      artifacts: [] as { path: string }[],
      toolCalls: [] as string[],
    };
    const html = renderToStaticMarkup(
      <TraceGraphView
        nodes={[node as never]}
        direction="LR"
        selectedNodeId="result-a"
        onSelectNode={() => {}}
        zoom={1}
        onZoomChange={() => {}}
        episodeTitles={new Map([["ep-private-id", "Ablation — dropout"]])}
      />,
    );
    expect(html).toContain("Ablation — dropout");
    expect(html).not.toContain("ep-private-id");
  });

  it("does not expose raw confidence or revoked enum labels on node cards", () => {
    const node = {
      id: "revoked-a",
      title: "Earlier step",
      type: "session_start",
      status: "completed",
      revoked: true,
      confidence: "high",
      parents: [] as { id: string; title?: string }[],
      parentIds: [] as string[],
      childIds: [] as string[],
      artifacts: [] as { path: string }[],
      toolCalls: [] as string[],
    };
    const html = renderToStaticMarkup(
      <TraceGraphView
        nodes={[node as never]}
        direction="LR"
        selectedNodeId="revoked-a"
        onSelectNode={() => {}}
        zoom={1}
        onZoomChange={() => {}}
        formatKind={() => "Session start"}
        revokedLabel="Undone"
      />,
    );
    expect(html).toContain("Undone");
    expect(html).not.toContain("Revoked");
    expect(html).not.toContain("high");
    expect(html).not.toContain(">session_start<");
  });
});
