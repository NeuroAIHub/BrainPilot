import { describe, expect, it } from "vitest";

import {
  resolveAskUserKeyAction,
  resolveAskUserOptionClick,
} from "../components/chat/AskUserComposer";

describe("ask_user explicit-confirmation interaction (#484)", () => {
  it("selects an option on pointer activation without submitting", () => {
    expect(resolveAskUserOptionClick(1, 2)).toEqual({ kind: "select", index: 1 });
    expect(resolveAskUserOptionClick(2, 2)).toEqual({ kind: "none" });
  });

  it("uses number keys for selection only", () => {
    expect(resolveAskUserKeyAction({
      key: "2",
      active: 0,
      rowCount: 3,
      optionCount: 2,
      freeTextActive: false,
    })).toEqual({ kind: "select", index: 1 });
  });

  it("keeps number keys available as free-text input", () => {
    expect(resolveAskUserKeyAction({
      key: "2",
      active: 2,
      rowCount: 3,
      optionCount: 2,
      freeTextActive: true,
    })).toEqual({ kind: "none" });
  });

  it("moves with arrows and wraps without submitting", () => {
    expect(resolveAskUserKeyAction({
      key: "ArrowDown",
      active: 2,
      rowCount: 3,
      optionCount: 2,
      freeTextActive: true,
    })).toEqual({ kind: "select", index: 0 });
    expect(resolveAskUserKeyAction({
      key: "ArrowUp",
      active: 0,
      rowCount: 3,
      optionCount: 2,
      freeTextActive: false,
    })).toEqual({ kind: "select", index: 2 });
  });

  it("reserves Enter for explicit confirmation", () => {
    expect(resolveAskUserKeyAction({
      key: "Enter",
      active: 1,
      rowCount: 3,
      optionCount: 2,
      freeTextActive: false,
    })).toEqual({ kind: "submit" });
  });

  it("does nothing when navigation has no rows", () => {
    expect(resolveAskUserKeyAction({
      key: "ArrowDown",
      active: 0,
      rowCount: 0,
      optionCount: 0,
      freeTextActive: false,
    })).toEqual({ kind: "none" });
  });
});
