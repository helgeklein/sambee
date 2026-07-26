import { Alert, Box, Button, CircularProgress, Container, Typography } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { exchangeOidcGrant } from "../services/api";
import { completeAuthentication } from "../services/oidcAuth";

function readAndClearGrant(): string | null {
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const grant = fragment.get("grant");
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  return grant;
}

export default function OidcCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState(false);
  const exchangeStarted = useRef(false);

  useEffect(() => {
    if (exchangeStarted.current) return;
    exchangeStarted.current = true;
    const grant = readAndClearGrant();
    if (!grant) {
      setError(true);
      return;
    }
    let active = true;
    void exchangeOidcGrant(grant)
      .then(completeAuthentication)
      .then((returnPath) => {
        if (active) navigate(returnPath, { replace: true });
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [navigate]);

  if (!error) {
    return (
      <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <CircularProgress aria-label="Completing sign in" />
      </Box>
    );
  }

  return (
    <Container maxWidth="sm" sx={{ py: 10 }}>
      <Alert severity="error">Sign in could not be completed.</Alert>
      <Typography component="h1" variant="h5" sx={{ mt: 3 }}>
        Sign in unavailable
      </Typography>
      <Button variant="contained" sx={{ mt: 3 }} onClick={() => navigate("/login", { replace: true })}>
        Try again
      </Button>
    </Container>
  );
}
