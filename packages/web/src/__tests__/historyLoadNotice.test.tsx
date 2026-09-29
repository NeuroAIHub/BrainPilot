import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { HistoryLoadNotice } from "../components/chat/PromptComposer";
import { translate } from "../i18n/translate";
import type { Locale } from "../i18n/types";

function renderNotice(locale: Locale, localMode: boolean, updateRequired = true, busy = false) {
  const onRetry = vi.fn();
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <HistoryLoadNotice
        error="The server returned incomplete history."
        updateRequired={updateRequired}
        hasMessages={false}
        isRefreshingMessages={busy}
        localMode={localMode}
        onRetry={onRetry}
        t={(key) => translate(locale, key)}
      />,
    );
  });
  return { renderer, onRetry, output: JSON.stringify(renderer.toJSON()) };
}

describe("history load recovery notice", () => {
  it("tells hosted users to finish work, rebuild the sandbox, then retry", () => {
    const { renderer, onRetry, output } = renderNotice("en-US", false);
    expect(output).toContain("Finish active work");
    expect(output).toContain("Sandbox status");
    expect(output).toContain("Rebuild");
    expect(output).toContain("Retry after update");
    expect(renderer.root.findByType("details").props.open).toBeUndefined();
    act(() => renderer.root.findByProps({ "data-testid": "history-load-retry" }).props.onClick());
    expect(onRetry).toHaveBeenCalledOnce();
    act(() => renderer.unmount());
  });

  it("gives local update/restart guidance in Chinese and preserves details", () => {
    const { renderer, output } = renderNotice("zh-CN", true);
    expect(output).toContain("更新并重启本地 BrainPilot");
    expect(output).toContain("已显示的消息会保留");
    expect(output).toContain("更新后重试");
    expect(output).toContain("The server returned incomplete history.");
    act(() => renderer.unmount());
  });

  it("keeps the generic failure notice and prevents duplicate retry while busy", () => {
    const { renderer, onRetry, output } = renderNotice("en-US", false, false, true);
    expect(output).toContain("history could not be loaded");
    expect(output).not.toContain("Rebuild");
    expect(output).toContain("Retrying");
    act(() => renderer.root.findByProps({ "data-testid": "history-load-retry" }).props.onClick());
    expect(onRetry).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });
});
