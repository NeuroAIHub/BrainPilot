/**
 * Pure validation for the Add/Edit Provider form (#328).
 */

export type ProviderFormFields = {
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
};

export type ProviderFieldError = "name" | "baseUrl" | "apiKey" | "models";

export type ProviderFormErrors = Partial<Record<ProviderFieldError, true>>;

export function validateProviderForm(
  form: ProviderFormFields,
  opts: { isEdit: boolean },
): { ok: boolean; errors: ProviderFormErrors } {
  const errors: ProviderFormErrors = {};

  if (!form.name.trim()) errors.name = true;
  if (!form.baseUrl.trim()) errors.baseUrl = true;
  if (!opts.isEdit && !form.apiKey.trim()) errors.apiKey = true;

  const models = form.models.map((m) => m.trim()).filter(Boolean);
  if (models.length === 0) errors.models = true;

  return { ok: Object.keys(errors).length === 0, errors };
}

/** Whether the submit control may be enabled (same rules as validate). */
export function canSubmitProviderForm(
  form: ProviderFormFields,
  opts: { isEdit: boolean },
): boolean {
  return validateProviderForm(form, opts).ok;
}

export function providerFieldErrorKey(
  field: ProviderFieldError,
):
  | "settings.providerForm.error.name"
  | "settings.providerForm.error.baseUrl"
  | "settings.providerForm.error.apiKey"
  | "settings.providerForm.error.models" {
  switch (field) {
    case "name":
      return "settings.providerForm.error.name";
    case "baseUrl":
      return "settings.providerForm.error.baseUrl";
    case "apiKey":
      return "settings.providerForm.error.apiKey";
    case "models":
      return "settings.providerForm.error.models";
  }
}
