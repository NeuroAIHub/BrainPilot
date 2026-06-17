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

// Where to send the browser when the upstream gateway reports we're not
// authenticated. Login/register/account live in the hosted shell, not here.
const HOSTED_LOGIN_PATH = "/account/login";

function redirectToHostedLogin() {
  const redirect = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.assign(`${HOSTED_LOGIN_PATH}?redirect=${redirect}`);
}

/**
 * Trust-front auth: the open-source frontend does NOT authenticate. The hosted
 * gateway owns auth and carries identity via an httpOnly cookie. We only read the
 * resolved identity (GET /api/auth/me) for display; on failure we hand off to the
 * hosted login page. There is no login/register/logout UI here.
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
        // Not authenticated upstream — defer to the hosted login. We still flip
        // isAuthReady so the shell stops showing the bootstrapping splash while
        // the navigation is in flight.
        setIsAuthReady(true);
        redirectToHostedLogin();
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
