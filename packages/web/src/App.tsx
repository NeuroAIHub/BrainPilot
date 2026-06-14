import { DesktopShell } from "./components/shell/DesktopShell";
import { AppProviders } from "./contexts/AppProviders";

export function App() {
  return (
    <AppProviders>
      <DesktopShell />
    </AppProviders>
  );
}
