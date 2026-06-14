import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { setActiveLocale } from "../i18n/translate";

type ThemePreference = "light" | "dark" | "system";

interface PreferencesState {
  theme: ThemePreference;
  resolvedTheme: "light" | "dark";
  language: "zh-CN" | "en-US";
  security: {
    confirmDangerousActions: boolean;
    rememberSession: boolean;
  };
  notifications: {
    agentDone: boolean;
    errors: boolean;
  };
}

interface PreferencesContextValue extends PreferencesState {
  setTheme: (theme: ThemePreference) => void;
  setLanguage: (language: PreferencesState["language"]) => void;
  setSecurity: (security: PreferencesState["security"]) => void;
  setNotifications: (notifications: PreferencesState["notifications"]) => void;
}

const STORAGE_KEY = "new-ui-preferences";

const defaultPreferences: PreferencesState = {
  theme: "light",
  resolvedTheme: "light",
  language: "zh-CN",
  security: {
    confirmDangerousActions: true,
    rememberSession: true,
  },
  notifications: {
    agentDone: true,
    errors: true,
  },
};

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

function loadPreferences(): PreferencesState {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    return defaultPreferences;
  }
  try {
    const parsed = JSON.parse(stored) as Partial<PreferencesState>;
    return {
      ...defaultPreferences,
      ...parsed,
      security: { ...defaultPreferences.security, ...parsed.security },
      notifications: { ...defaultPreferences.notifications, ...parsed.notifications },
      resolvedTheme: defaultPreferences.resolvedTheme,
    };
  } catch {
    return defaultPreferences;
  }
}

function resolveTheme(theme: ThemePreference): "light" | "dark" {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return theme;
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<PreferencesState>(() => {
    const loaded = loadPreferences();
    return { ...loaded, resolvedTheme: resolveTheme(loaded.theme) };
  });

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = preferences.resolvedTheme;
    root.lang = preferences.language;
    setActiveLocale(preferences.language);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...preferences, resolvedTheme: undefined }));
  }, [preferences]);

  useEffect(() => {
    if (preferences.theme !== "system") {
      return;
    }
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => setPreferences((current) => ({ ...current, resolvedTheme: resolveTheme(current.theme) }));
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [preferences.theme]);

  const setTheme = useCallback((theme: ThemePreference) => {
    setPreferences((current) => ({ ...current, theme, resolvedTheme: resolveTheme(theme) }));
  }, []);

  const setLanguage = useCallback((language: PreferencesState["language"]) => {
    setPreferences((current) => ({ ...current, language }));
  }, []);

  const setSecurity = useCallback((security: PreferencesState["security"]) => {
    setPreferences((current) => ({ ...current, security }));
  }, []);

  const setNotifications = useCallback((notifications: PreferencesState["notifications"]) => {
    setPreferences((current) => ({ ...current, notifications }));
  }, []);

  const value = useMemo(
    () => ({ ...preferences, setTheme, setLanguage, setSecurity, setNotifications }),
    [preferences, setTheme, setLanguage, setSecurity, setNotifications],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
  const value = useContext(PreferencesContext);
  if (!value) {
    throw new Error("usePreferences must be used within PreferencesProvider");
  }
  return value;
}
