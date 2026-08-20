import { describe, it, expect } from "vitest";
import {
  canSubmitProviderForm,
  providerFieldErrorKey,
  validateProviderForm,
} from "../components/settings/providerFormValidation";
import {
  resolveEscapeLayer,
  resolveFocusTrapTarget,
} from "../components/settings/settingsModalStack";

const emptyForm = {
  name: "",
  baseUrl: "",
  apiKey: "",
  models: [""],
};

const validCreate = {
  name: "Anthropic",
  baseUrl: "https://api.anthropic.com",
  apiKey: "sk-test",
  models: ["claude-sonnet-4-6"],
};

describe("validateProviderForm (#328)", () => {
  it("rejects empty name, baseUrl, apiKey (create), and models", () => {
    const r = validateProviderForm(emptyForm, { isEdit: false });
    expect(r.ok).toBe(false);
    expect(r.errors.name).toBe(true);
    expect(r.errors.baseUrl).toBe(true);
    expect(r.errors.apiKey).toBe(true);
    expect(r.errors.models).toBe(true);
  });

  it("allows blank apiKey on edit (keep existing key)", () => {
    const r = validateProviderForm(
      { ...validCreate, apiKey: "" },
      { isEdit: true },
    );
    expect(r.errors.apiKey).toBeUndefined();
    expect(r.ok).toBe(true);
  });

  it("requires apiKey on create", () => {
    const r = validateProviderForm({ ...validCreate, apiKey: "  " }, { isEdit: false });
    expect(r.ok).toBe(false);
    expect(r.errors.apiKey).toBe(true);
  });

  it("accepts a complete create form", () => {
    expect(validateProviderForm(validCreate, { isEdit: false }).ok).toBe(true);
    expect(canSubmitProviderForm(validCreate, { isEdit: false })).toBe(true);
  });

  it("maps fields to i18n error keys", () => {
    expect(providerFieldErrorKey("name")).toBe("settings.providerForm.error.name");
    expect(providerFieldErrorKey("apiKey")).toBe("settings.providerForm.error.apiKey");
  });
});

describe("resolveEscapeLayer (#328)", () => {
  it("closes MCP first, then Provider, then Settings", () => {
    expect(
      resolveEscapeLayer({
        isSettingsOpen: true,
        isProviderFormOpen: true,
        isMcpFormOpen: true,
      }),
    ).toBe("mcp");
    expect(
      resolveEscapeLayer({
        isSettingsOpen: true,
        isProviderFormOpen: true,
        isMcpFormOpen: false,
      }),
    ).toBe("provider");
    expect(
      resolveEscapeLayer({
        isSettingsOpen: true,
        isProviderFormOpen: false,
        isMcpFormOpen: false,
      }),
    ).toBe("settings");
  });

  it("returns null when settings is closed", () => {
    expect(
      resolveEscapeLayer({
        isSettingsOpen: false,
        isProviderFormOpen: true,
        isMcpFormOpen: false,
      }),
    ).toBe(null);
  });
});

describe("resolveFocusTrapTarget (#487)", () => {
  const controls = ["first", "middle", "last"] as const;

  it("wraps focus that lands on the dialog container", () => {
    expect(resolveFocusTrapTarget(controls, null, false)).toBe("first");
    expect(resolveFocusTrapTarget(controls, null, true)).toBe("last");
  });

  it("wraps at both control-list boundaries", () => {
    expect(resolveFocusTrapTarget(controls, "last", false)).toBe("first");
    expect(resolveFocusTrapTarget(controls, "first", true)).toBe("last");
  });

  it("leaves normal movement between interior controls to the browser", () => {
    expect(resolveFocusTrapTarget(controls, "middle", false)).toBeNull();
    expect(resolveFocusTrapTarget(controls, "middle", true)).toBeNull();
  });
});
