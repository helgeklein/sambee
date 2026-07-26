import { Alert, Box, Button, Container, Divider, Paper, TextField, Typography } from "@mui/material";
import type React from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { login } from "../services/api";
import { type AuthConfig, getAuthConfig } from "../services/authConfig";
import { logger } from "../services/logger";
import { completeAuthentication, OIDC_ATTEMPT_MARKER, OIDC_LOGOUT_MARKER, startOidcAuthorization } from "../services/oidcAuth";

const Login: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [authConfig, setAuthConfig] = useState<AuthConfig | null>(null);
  const [oidcOnlyState, setOidcOnlyState] = useState<"redirecting" | "failed" | "signed-out" | null>(null);

  // Check if authentication is required
  useEffect(() => {
    const checkAuthConfig = async () => {
      try {
        const config = await getAuthConfig();
        if (config.sign_in_mode === "none") {
          logger.info("Auth method is 'none' - redirecting to browse", {}, "auth");
          await logger.initializeBackendTracing();
          navigate("/browse", { replace: true });
          return;
        }
        setAuthConfig(config);
        if (config.sign_in_mode === "oidc_only" && config.oidc) {
          if (sessionStorage.getItem(OIDC_LOGOUT_MARKER)) {
            setOidcOnlyState("signed-out");
          } else if (sessionStorage.getItem(OIDC_ATTEMPT_MARKER)) {
            setOidcOnlyState("failed");
          } else {
            sessionStorage.setItem(OIDC_ATTEMPT_MARKER, "1");
            setOidcOnlyState("redirecting");
            startOidcAuthorization(config.oidc.authorization_path);
            return;
          }
        }
      } catch (error) {
        logger.error("Failed to check auth config", { error }, "auth");
        setError("Authentication is temporarily unavailable.");
      } finally {
        setIsLoading(false);
      }
    };

    checkAuthConfig();
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    try {
      const response = await login(username, password);
      const returnPath = await completeAuthentication(response);
      navigate(returnPath);
    } catch (_err) {
      setError(t("auth.login.invalidCredentials"));
    }
  };

  const startProviderLogin = () => {
    if (!authConfig?.oidc) return;
    sessionStorage.setItem(OIDC_ATTEMPT_MARKER, "1");
    sessionStorage.removeItem(OIDC_LOGOUT_MARKER);
    startOidcAuthorization(authConfig.oidc.authorization_path);
  };

  if (isLoading || oidcOnlyState === "redirecting") {
    if (oidcOnlyState === "redirecting") return null;
    return (
      <Container maxWidth="sm">
        <Box
          sx={{
            marginTop: 8,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <Typography>{t("app.loading")}</Typography>
        </Box>
      </Container>
    );
  }

  if (authConfig?.sign_in_mode === "oidc_only") {
    const signedOut = oidcOnlyState === "signed-out";
    return (
      <Container maxWidth="sm" sx={{ py: 10 }}>
        {!signedOut && <Alert severity="error">Sign in is temporarily unavailable.</Alert>}
        <Typography component="h1" variant="h5" sx={{ mt: 3 }}>
          {signedOut ? "Signed out" : "Sign in unavailable"}
        </Typography>
        <Button variant="contained" sx={{ mt: 3 }} onClick={startProviderLogin}>
          {signedOut ? "Sign in again" : "Try again"}
        </Button>
      </Container>
    );
  }

  return (
    <Container maxWidth="sm">
      <Box
        sx={{
          marginTop: 8,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <Paper elevation={3} sx={{ p: 4, width: "100%" }}>
          <Typography component="h1" variant="h5" align="center" gutterBottom>
            {t("auth.login.title")}
          </Typography>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          {authConfig?.sign_in_mode === "oidc_or_password" && authConfig.oidc && (
            <>
              <Button fullWidth variant="outlined" sx={{ mt: 2, mb: 3 }} onClick={startProviderLogin}>
                Sign in with {authConfig.oidc.display_name}
              </Button>
              <Divider>or</Divider>
            </>
          )}
          <form onSubmit={handleSubmit}>
            <TextField
              margin="normal"
              required
              fullWidth
              label={t("auth.login.usernameLabel")}
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <TextField
              margin="normal"
              required
              fullWidth
              label={t("auth.login.passwordLabel")}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Button type="submit" fullWidth variant="contained" sx={{ mt: 3, mb: 2 }}>
              {t("auth.login.submit")}
            </Button>
          </form>
        </Paper>
      </Box>
    </Container>
  );
};

export default Login;
