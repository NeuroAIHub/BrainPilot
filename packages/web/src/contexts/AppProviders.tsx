import { ReactNode } from "react";
import { AuthProvider } from "./AuthContext";
import { PreferencesProvider } from "./PreferencesContext";
import { SandboxProvider } from "./SandboxContext";
import { SessionProvider } from "./SessionContext";
import { SSEProvider } from "./SSEContext";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <PreferencesProvider>
      <AuthProvider>
        <SandboxProvider>
          <SSEProvider>
            <SessionProvider>{children}</SessionProvider>
          </SSEProvider>
        </SandboxProvider>
      </AuthProvider>
    </PreferencesProvider>
  );
}
