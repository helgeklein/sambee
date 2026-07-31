import { Alert, Box, Button, CircularProgress, List, ListItem, ListItemText, Typography, useMediaQuery, useTheme } from "@mui/material";
import { useEffect, useEffectEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SettingsCategoryDescription } from "../components/Settings/SettingsCategoryDescription";
import { SettingsGroup } from "../components/Settings/SettingsGroup";
import { SettingsSectionHeader } from "../components/Settings/SettingsSectionHeader";
import { getSettingsCategoryLabel } from "../components/Settings/settingsNavigation";
import apiService from "../services/api";
import { authSession } from "../services/authSession";
import type { OidcBrowserSession } from "../types";

function formatTimestamp(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "Never";
}

export function SessionSettings() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<OidcBrowserSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const loadSessions = useEffectEvent(async () => {
    setLoading(true);
    setError(null);
    try {
      setSessions((await apiService.getOidcBrowserSessions()).sessions);
    } catch {
      setError("Sessions could not be loaded.");
    } finally {
      setLoading(false);
    }
  });

  useEffect(() => {
    void loadSessions();
  }, []);

  const revokeSession = async (browserSession: OidcBrowserSession) => {
    setRevoking(browserSession.id);
    setError(null);
    try {
      await apiService.revokeOidcBrowserSession(browserSession.id);
      if (browserSession.current) {
        authSession.clear();
        navigate("/login", { replace: true });
        return;
      }
      await loadSessions();
    } catch {
      setError("The session could not be revoked.");
    } finally {
      setRevoking(null);
    }
  };

  const revokeOthers = async () => {
    setRevoking("others");
    setError(null);
    try {
      await apiService.revokeOtherOidcBrowserSessions();
      await loadSessions();
    } catch {
      setError("Other sessions could not be revoked.");
    } finally {
      setRevoking(null);
    }
  };

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column", bgcolor: "background.default", overflow: "hidden" }}>
      <SettingsSectionHeader
        title={getSettingsCategoryLabel("sessions")}
        description={<SettingsCategoryDescription category="sessions" />}
        showTitle={!isMobile}
      />
      <Box sx={{ flex: 1, overflow: "auto", px: { xs: 2, sm: 3, md: 4 }, pb: 3 }}>
        <SettingsGroup title="Browser sessions" description="Active OIDC sessions can be revoked immediately.">
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          {loading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
              <CircularProgress size={28} />
            </Box>
          ) : sessions.length === 0 ? (
            <Typography color="text.secondary">No renewable OIDC sessions are active.</Typography>
          ) : (
            <>
              <List disablePadding>
                {sessions.map((browserSession) => (
                  <ListItem
                    key={browserSession.id}
                    divider
                    secondaryAction={
                      <Button color="error" onClick={() => void revokeSession(browserSession)} disabled={revoking !== null}>
                        {browserSession.current ? "Sign out" : "Revoke"}
                      </Button>
                    }
                    sx={{ px: 0, pr: 12 }}
                  >
                    <ListItemText
                      primary={browserSession.current ? "This browser" : "Browser session"}
                      secondary={`Created ${formatTimestamp(browserSession.created_at)}. Last active ${formatTimestamp(browserSession.last_seen_at)}.`}
                    />
                  </ListItem>
                ))}
              </List>
              {sessions.some((browserSession) => !browserSession.current) && (
                <Button sx={{ mt: 2 }} color="error" onClick={() => void revokeOthers()} disabled={revoking !== null}>
                  Revoke all other sessions
                </Button>
              )}
            </>
          )}
        </SettingsGroup>
      </Box>
    </Box>
  );
}
