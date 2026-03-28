import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider } from "@mui/material/styles";
import { lazy, Suspense, useRef } from "react";
import { Navigate, Route, BrowserRouter as Router, Routes } from "react-router-dom";
import AppUpdatePrompt from "./components/AppUpdatePrompt";
import ErrorBoundary from "./components/ErrorBoundary";
import { SettingsLayout } from "./components/Settings/SettingsLayout";
import { useFocusTrap } from "./hooks/useFocusTrap";
import { translate } from "./i18n";
import { CompanionLocalizationSync } from "./i18n/CompanionLocalizationSync";
import { LocalePreferencesProvider } from "./i18n/LocalePreferencesProvider";
import { AdvancedSettings } from "./pages/AdvancedSettings";
import { ConnectionsSettings } from "./pages/ConnectionsSettings";
import { FileBrowserSettings } from "./pages/FileBrowserSettings";
import { LocalDrivesSettings } from "./pages/LocalDrivesSettings";
import { AppearanceSettings } from "./pages/PreferencesSettings";
import { Settings } from "./pages/Settings";
import { UserManagementSettings } from "./pages/UserManagementSettings";
import { SambeeThemeProvider, useSambeeTheme } from "./theme";

// Lazy load route components for better code splitting
const Login = lazy(() => import("./pages/Login"));
const FileBrowser = lazy(() => import("./pages/FileBrowser"));

//
// AppContent
//

/**
 * Inner app component that uses the theme
 */
function AppContent() {
  const { muiTheme } = useSambeeTheme();
  const appRef = useRef<HTMLDivElement>(null);
  useFocusTrap(appRef);

  return (
    <ThemeProvider theme={muiTheme}>
      <CssBaseline />
      <AppUpdatePrompt />
      <CompanionLocalizationSync />
      <div ref={appRef}>
        <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Suspense fallback={<div>{translate("app.loading")}</div>}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/browse/:targetType/:targetId/*" element={<FileBrowser />} />
              <Route path="/browse" element={<FileBrowser />} />
              <Route path="/settings" element={<SettingsLayout />}>
                <Route index element={<Settings />} />
                <Route path="appearance" element={<AppearanceSettings />} />
                <Route path="file-browser" element={<FileBrowserSettings />} />
                <Route path="preferences" element={<Navigate to="/settings/appearance" replace />} />
                <Route path="connections" element={<ConnectionsSettings />} />
                <Route path="connections/local-drives" element={<LocalDrivesSettings />} />
                <Route path="connections/smb" element={<Navigate to="/settings/connections" replace />} />
                <Route path="admin/users" element={<UserManagementSettings />} />
                <Route path="admin/system" element={<AdvancedSettings />} />
              </Route>
              <Route path="/" element={<Navigate to="/browse" replace />} />
            </Routes>
          </Suspense>
        </Router>
      </div>
    </ThemeProvider>
  );
}

//
// App
//

function App() {
  return (
    <ErrorBoundary>
      <LocalePreferencesProvider>
        <SambeeThemeProvider>
          <AppContent />
        </SambeeThemeProvider>
      </LocalePreferencesProvider>
    </ErrorBoundary>
  );
}

export default App;
