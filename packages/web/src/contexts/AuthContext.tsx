import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { User } from "../contracts/backend";
import { api, clearStoredToken, getStoredToken, storeToken } from "../utils/api";
import { runtimeConfig } from "../config";
import { tg } from "../i18n/translate";

interface AuthContextValue {
  user: User | null;
  token: string | null;
  isBootstrapping: boolean;
  isSubmitting: boolean;
  error: string | null;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Single-user bypass identity (auth disabled). Kept stable so `token` —
// which other contexts use as a "ready to connect" gate — is always truthy
// and the login overlay (gated on `!user`) never renders.
const LOCAL_USER: User = {
  id: "local",
  username: "local",
  createdAt: "1970-01-01T00:00:00.000Z",
};
const LOCAL_TOKEN = "local";

/**
 * AuthProvider has two modes, selected at build time by VITE_AUTH_ENABLED:
 *
 * - auth DISABLED (default, this single-user repo): a bypass that reports an
 *   always-signed-in local user with a fixed token. No login screen, no
 *   network calls; login/register/logout are no-ops.
 * - auth ENABLED (downstream multi-user deployment, VITE_AUTH_ENABLED=1):
 *   the real bootstrap/login/register/logout flow in RealAuthProvider.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  if (!runtimeConfig.authEnabled) {
    return <BypassAuthProvider>{children}</BypassAuthProvider>;
  }
  return <RealAuthProvider>{children}</RealAuthProvider>;
}

function BypassAuthProvider({ children }: { children: ReactNode }) {
  const value = useMemo<AuthContextValue>(
    () => ({
      user: LOCAL_USER,
      token: LOCAL_TOKEN,
      isBootstrapping: false,
      isSubmitting: false,
      error: null,
      login: async () => {},
      register: async () => {},
      logout: () => {},
    }),
    [],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function RealAuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => getStoredToken());
  const [user, setUser] = useState<User | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      if (!token) {
        setIsBootstrapping(false);
        return;
      }

      try {
        const currentUser = await api.auth.me();
        if (!cancelled) {
          setUser(currentUser);
        }
      } catch (err) {
        if (!cancelled) {
          clearStoredToken();
          setToken(null);
          setUser(null);
          setError(err instanceof Error ? err.message : tg("ctx.auth.sessionExpired"));
        }
      } finally {
        if (!cancelled) {
          setIsBootstrapping(false);
        }
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const commitToken = useCallback((nextToken: string, nextUser: User) => {
    storeToken(nextToken);
    setToken(nextToken);
    setUser(nextUser);
    setError(null);
  }, []);

  const login = useCallback(
    async (username: string, password: string) => {
      setIsSubmitting(true);
      setError(null);
      try {
        const result = await api.auth.login(username, password);
        commitToken(result.accessToken, result.user);
      } catch (err) {
        setError(err instanceof Error ? err.message : tg("ctx.auth.loginFailed"));
        throw err;
      } finally {
        setIsSubmitting(false);
      }
    },
    [commitToken],
  );

  const register = useCallback(
    async (username: string, password: string) => {
      setIsSubmitting(true);
      setError(null);
      try {
        const result = await api.auth.register(username, password);
        commitToken(result.accessToken, result.user);
      } catch (err) {
        setError(err instanceof Error ? err.message : tg("ctx.auth.registerFailed"));
        throw err;
      } finally {
        setIsSubmitting(false);
      }
    },
    [commitToken],
  );

  const logout = useCallback(() => {
    clearStoredToken();
    setToken(null);
    setUser(null);
    setError(null);
  }, []);

  const value = useMemo(
    () => ({ user, token, isBootstrapping, isSubmitting, error, login, register, logout }),
    [user, token, isBootstrapping, isSubmitting, error, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return value;
}
