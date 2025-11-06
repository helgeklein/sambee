import CssBaseline from "@mui/material/CssBaseline";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import { Navigate, Route, BrowserRouter as Router, Routes } from "react-router-dom";
import Browser from "./pages/Browser";
import Login from "./pages/Login";

const theme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: "#1976d2",
    },
    secondary: {
      main: "#dc004e",
    },
  },
});

function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/browse/:connectionId/*" element={<Browser />} />
          <Route path="/browse" element={<Browser />} />
          <Route path="/" element={<Navigate to="/browse" replace />} />
        </Routes>
      </Router>
    </ThemeProvider>
  );
}

export default App;
