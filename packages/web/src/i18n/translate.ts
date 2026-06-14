import type { Locale } from "./types";
import { messages, DEFAULT_LOCALE } from "./messages";

export type TranslateVars = Record<string, string | number>;

/**
 * Pure translation function — safe to call outside of React (e.g. inside
 * context callbacks that hold the current locale in a ref).
 *
 * Resolution order: requested locale → DEFAULT_LOCALE → the raw key.
 * Supports `{var}` interpolation.
 */
export function translate(locale: Locale, key: string, vars?: TranslateVars): string {
  const table = messages[locale] ?? messages[DEFAULT_LOCALE];
  let str = table[key] ?? messages[DEFAULT_LOCALE][key];

  if (str === undefined) {
    if (import.meta.env.DEV) {
      console.warn(`[i18n] missing translation key: "${key}"`);
    }
    return key;
  }

  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      str = str.replace(new RegExp(`\\{${name}\\}`, "g"), String(value));
    }
  }
  return str;
}

/**
 * Module-level "active locale", kept in sync by PreferencesContext. Lets code
 * outside the React tree (context callbacks producing error strings) translate
 * without holding a hook. Reactive UI should still use useT().
 */
let activeLocale: Locale = DEFAULT_LOCALE;

export function setActiveLocale(locale: Locale): void {
  activeLocale = locale;
}

/** Translate against the current active locale (non-reactive). */
export function tg(key: string, vars?: TranslateVars): string {
  return translate(activeLocale, key, vars);
}
