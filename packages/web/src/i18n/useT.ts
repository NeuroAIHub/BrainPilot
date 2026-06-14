import { useCallback } from "react";
import { usePreferences } from "../contexts/PreferencesContext";
import { translate, TranslateVars } from "./translate";

/**
 * React hook returning a `t(key, vars?)` translator bound to the current
 * UI language (single source of truth: PreferencesContext.language).
 *
 * Components re-render and re-translate automatically when the user switches
 * language in Settings.
 */
export function useT() {
  const { language } = usePreferences();
  return useCallback((key: string, vars?: TranslateVars) => translate(language, key, vars), [language]);
}
