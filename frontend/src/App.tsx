import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider } from "@mui/material/styles";
import { lazy, Suspense, useRef } from "react";
import { Navigate, Route, BrowserRouter as Router, Routes } from "react-router-dom";
import ErrorBoundary from "./components/ErrorBoundary";
import { useFocusTrap } from "./hooks/useFocusTrap";
import { SambeeThemeProvider, useSambeeTheme } from "./theme";

// Lazy load route components for better code splitting
const Login = lazy(() => import("./pages/Login"));
const FileBrowser = lazy(() => import("./pages/FileBrowser"));
const SettingsLayout = lazy(() => import("./components/Settings/SettingsLayout").then((m) => ({ default: m.SettingsLayout })));
const Settings = lazy(() => import("./pages/Settings").then((m) => ({ default: m.Settings })));
const ConnectionSettings = lazy(() => import("./pages/ConnectionSettings").then((m) => ({ default: m.ConnectionSettings })));
const AppearanceSettings = lazy(() => import("./pages/AppearanceSettings").then((m) => ({ default: m.AppearanceSettings })));

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
      <div ref={appRef}>
        <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Suspense fallback={<div>Loading...</div>}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/browse/:connectionId/*" element={<FileBrowser />} />
              <Route path="/browse" element={<FileBrowser />} />
              <Route path="/settings" element={<SettingsLayout />}>
                <Route index element={<Settings />} />
                <Route path="connections" element={<ConnectionSettings />} />
                <Route path="appearance" element={<AppearanceSettings />} />
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
      <SambeeThemeProvider>
        <AppContent />
      </SambeeThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
