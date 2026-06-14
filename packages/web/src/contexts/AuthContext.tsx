import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { User } from "../contracts/backend";
import { api, clearStoredToken, getStoredToken, storeToken } from "../utils/api";
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

export function AuthProvider({ children }: { children: ReactNode }) {
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
