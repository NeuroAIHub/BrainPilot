import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { User } from "../contracts/backend";
import { api } from "../utils/api";

interface AuthContextValue {
  /** The current identity, resolved from the upstream gateway via GET /api/auth/me. */
  user: User | null;
  /** True once the identity bootstrap has settled (success or redirect-in-flight). */
  isAuthReady: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Trust-front auth: the open-source frontend does NOT authenticate. The hosted
 * gateway owns auth and carries identity via an httpOnly cookie. We only read the
 * resolved identity (GET /api/auth/me) for display. There is no login/register/
 * logout UI here.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const currentUser = await api.auth.me();
        if (!cancelled) {
          setUser(currentUser);
          setIsAuthReady(true);
        }
      } catch {
        if (cancelled) return;
        // No identity resolved. In self-hosted `bp --up` there is no hosted
        // gateway/login to hand off to, so redirecting here would loop (#38).
        // Fall back to a local anonymous identity and let the app render.
        setUser({ id: "local", username: "local", createdAt: new Date(0).toISOString() });
        setIsAuthReady(true);
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<AuthContextValue>(() => ({ user, isAuthReady }), [user, isAuthReady]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return value;
}
