import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("../i18n/useT", () => ({
  useT: () => (k: string, vars?: Record<string, string | number>) => {
    if (!vars) return k;
    return `${k}:${JSON.stringify(vars)}`;
  },
}));

import {
  canCommitRename,
  isCancelKey,
  renameValidation,
  renameValidationKey,
} from "../components/sidebar/sessionListActions";
import { SessionList } from "../components/sidebar/SessionList";
import type { Session } from "../contracts/backend";

const baseSession: Session = {
  id: "sess-1",
  title: "Hello research",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

function renderList(sessions: Session[] = [baseSession]) {
  return renderToStaticMarkup(
    <SessionList
      sessions={sessions}
      currentId={sessions[0]?.id}
      isLoading={false}
      onSelect={() => {}}
      onRename={() => {}}
      onDelete={() => {}}
      onOpenSearch={() => {}}
    />,
  );
}

describe("canCommitRename / renameValidation (#325)", () => {
  it("disallows empty and whitespace-only titles", () => {
    expect(canCommitRename("Hello", "")).toBe(false);
    expect(canCommitRename("Hello", "   ")).toBe(false);
    expect(renameValidation("Hello", "")).toBe("empty");
    expect(renameValidationKey("empty")).toBe("sidebar.rename.validation.empty");
  });

  it("disallows unchanged titles (including trim-equal)", () => {
    expect(canCommitRename("Hello", "Hello")).toBe(false);
    expect(canCommitRename("Hello", "  Hello  ")).toBe(false);
    expect(renameValidation("Hello", "Hello")).toBe("unchanged");
    expect(renameValidationKey("unchanged")).toBe("sidebar.rename.validation.unchanged");
  });

  it("allows a real title change", () => {
    expect(canCommitRename("Hello", "Hello world")).toBe(true);
    expect(renameValidation("Hello", "Hello world")).toBe("ok");
    expect(renameValidationKey("ok")).toBe(null);
  });
});

describe("isCancelKey", () => {
  it("recognizes Escape", () => {
    expect(isCancelKey("Escape")).toBe(true);
    expect(isCancelKey("Esc")).toBe(true);
    expect(isCancelKey("Enter")).toBe(false);
  });
});

describe("SessionList default markup (#325)", () => {
  it("exposes named rename and delete controls on each row", () => {
    const html = renderList();
    expect(html).toContain("sidebar.aria.rename");
    expect(html).toContain("sidebar.aria.delete");
    expect(html).toContain("Hello research");
  });

  it("does not leave an unlabeled free-text rename input in the idle list", () => {
    const html = renderList();
    expect(html).not.toContain("conversation-edit");
  });
});
