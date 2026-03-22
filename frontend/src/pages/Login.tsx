import { Alert, Box, Button, Container, Paper, TextField, Typography } from "@mui/material";
import type React from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { login } from "../services/api";
import { isAuthRequired } from "../services/authConfig";
import { logger } from "../services/logger";

const Login: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  // Check if authentication is required
  useEffect(() => {
    const checkAuthConfig = async () => {
      try {
        const authRequired = await isAuthRequired();
        if (!authRequired) {
          logger.info("Auth method is 'none' - redirecting to browse", {}, "auth");
          // Initialize mobile logging for no-auth mode
          await logger.initializeBackendTracing();
          navigate("/browse", { replace: true });
          return;
        }
      } catch (error) {
        logger.error("Failed to check auth config", { error }, "auth");
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
      localStorage.setItem("access_token", response.access_token);

      // Initialize mobile logging after successful login
      await logger.initializeBackendTracing();

      navigate("/browse");
    } catch (_err) {
      setError(t("auth.login.invalidCredentials"));
    }
  };

  // Show loading while checking auth configuration
  if (isLoading) {
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
