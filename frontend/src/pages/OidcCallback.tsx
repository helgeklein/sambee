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
  const exchangePromise = useRef<Promise<string> | null>(null);
  const mounted = useRef(false);
  const navigationCompleted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    if (!exchangePromise.current) {
      const grant = readAndClearGrant();
      if (!grant) {
        setError(true);
        return;
      }
      exchangePromise.current = exchangeOidcGrant(grant).then(completeAuthentication);
    }
    void exchangePromise.current
      .then((returnPath) => {
        if (mounted.current && !navigationCompleted.current) {
          navigationCompleted.current = true;
          navigate(returnPath, { replace: true });
        }
      })
      .catch(() => {
        if (mounted.current) setError(true);
      });
    return () => {
      mounted.current = false;
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
