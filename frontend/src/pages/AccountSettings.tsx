import {
  Alert,
  Box,
  Button,
  CircularProgress,
  ListItem,
  ListItemText,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { useEffect, useEffectEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SettingsCategoryDescription } from "../components/Settings/SettingsCategoryDescription";
import { SettingsGroup } from "../components/Settings/SettingsGroup";
import { SettingsList } from "../components/Settings/SettingsList";
import { SettingsSectionHeader } from "../components/Settings/SettingsSectionHeader";
import { SettingsSectionList } from "../components/Settings/SettingsSectionList";
import { getSettingsCategoryLabel } from "../components/Settings/settingsNavigation";
import { signOutCurrentBrowser } from "../services/accountSession";
import api from "../services/api";
import type { CurrentAccount, OidcBrowserSession } from "../types";
import { getApiErrorMessage } from "../utils/apiErrors";

const PASSWORD_CHANGED_MARKER = "sambee_password_changed";

function formatTimestamp(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "Never";
}

interface PasswordForm {
  currentPassword: string;
  newPassword: string;
  confirmation: string;
}

const EMPTY_PASSWORD_FORM: PasswordForm = {
  currentPassword: "",
  newPassword: "",
  confirmation: "",
};

export function AccountSettings({ dialogSafe = false }: { dialogSafe?: boolean }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const navigate = useNavigate();
  const [account, setAccount] = useState<CurrentAccount | null>(null);
  const [sessions, setSessions] = useState<OidcBrowserSession[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [passwordForm, setPasswordForm] = useState<PasswordForm>(EMPTY_PASSWORD_FORM);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const loadAccount = useEffectEvent(async () => {
    setLoading(true);
    setError(null);
    setAccount(null);
    setSessions(null);
    try {
      const currentAccount = await api.getCurrentAccount();
      setAccount(currentAccount);
      if (!currentAccount.browser_session_management_available) {
        setSessions([]);
        return;
      }
      try {
        setSessions((await api.getOidcBrowserSessions()).sessions);
      } catch (sessionLoadError) {
        setError(getApiErrorMessage(sessionLoadError, "Browser sessions could not be loaded."));
      }
    } catch (accountLoadError) {
      setError(getApiErrorMessage(accountLoadError, "Account information could not be loaded."));
    } finally {
      setLoading(false);
    }
  });

  useEffect(() => {
    void loadAccount();
  }, []);

  const signOut = async () => {
    setSigningOut(true);
    try {
      await signOutCurrentBrowser();
      navigate("/login", { replace: true });
    } finally {
      setSigningOut(false);
    }
  };

  const revokeSession = async (browserSession: OidcBrowserSession) => {
    setRevoking(browserSession.id);
    setError(null);
    try {
      await api.revokeOidcBrowserSession(browserSession.id);
      if (browserSession.current) {
        await signOut();
        return;
      }
      await loadAccount();
    } catch (revokeError) {
      setError(getApiErrorMessage(revokeError, "The session could not be revoked."));
    } finally {
      setRevoking(null);
    }
  };

  const revokeOtherSessions = async () => {
    setRevoking("others");
    setError(null);
    try {
      await api.revokeOtherOidcBrowserSessions();
      await loadAccount();
    } catch (revokeError) {
      setError(getApiErrorMessage(revokeError, "Other sessions could not be revoked."));
    } finally {
      setRevoking(null);
    }
  };

  const submitPasswordChange = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmation) {
      setPasswordError("Complete all password fields.");
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmation) {
      setPasswordError("The new password and confirmation do not match.");
      return;
    }

    setPasswordSubmitting(true);
    setPasswordError(null);
    try {
      await api.changePassword(passwordForm.currentPassword, passwordForm.newPassword);
      sessionStorage.setItem(PASSWORD_CHANGED_MARKER, "1");
      await signOut();
    } catch (changeError) {
      setPasswordError(getApiErrorMessage(changeError, "The password could not be changed."));
    } finally {
      setPasswordSubmitting(false);
    }
  };

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column", bgcolor: "background.default", overflow: "hidden" }}>
      <SettingsSectionHeader
        title={getSettingsCategoryLabel("account")}
        description={<SettingsCategoryDescription category="account" />}
        dialogSafe={dialogSafe}
        showTitle={!isMobile}
      />
      <Box sx={{ flex: 1, overflow: "auto", px: { xs: 2, sm: 3, md: 4 }, pb: 3 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {error}
          </Alert>
        )}
        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress aria-label="Loading account" size={28} />
          </Box>
        ) : account === null ? (
          <Box>
            <Button variant="outlined" onClick={() => void loadAccount()}>
              Try again
            </Button>
          </Box>
        ) : (
          <SettingsSectionList>
            {account.must_change_password && account.password_change_available && (
              <Alert severity="warning">Your administrator requires you to change your local password.</Alert>
            )}
            <SettingsGroup title="Your identity" contentSpacing="compact">
              <SettingsList>
                <ListItem divider disableGutters>
                  <ListItemText primary="Username" secondary={account.username} />
                </ListItem>
                {account.name && (
                  <ListItem divider disableGutters>
                    <ListItemText primary="Name" secondary={account.name} />
                  </ListItem>
                )}
                {account.email && (
                  <ListItem divider disableGutters>
                    <ListItemText primary="Email" secondary={account.email} />
                  </ListItem>
                )}
                <ListItem disableGutters>
                  <ListItemText primary="Role" secondary={account.role} />
                </ListItem>
              </SettingsList>
            </SettingsGroup>

            {account.password_change_available && (
              <SettingsGroup title="Password">
                <Box
                  component="form"
                  onSubmit={(event) => void submitPasswordChange(event)}
                  sx={{ display: "grid", gap: 2, maxWidth: 440 }}
                >
                  {passwordError && <Alert severity="error">{passwordError}</Alert>}
                  <TextField
                    label="Current password"
                    type="password"
                    autoComplete="current-password"
                    value={passwordForm.currentPassword}
                    onChange={(event) => setPasswordForm((current) => ({ ...current, currentPassword: event.target.value }))}
                    disabled={passwordSubmitting}
                  />
                  <TextField
                    label="New password"
                    type="password"
                    autoComplete="new-password"
                    value={passwordForm.newPassword}
                    onChange={(event) => setPasswordForm((current) => ({ ...current, newPassword: event.target.value }))}
                    disabled={passwordSubmitting}
                  />
                  <TextField
                    label="Confirm new password"
                    type="password"
                    autoComplete="new-password"
                    value={passwordForm.confirmation}
                    onChange={(event) => setPasswordForm((current) => ({ ...current, confirmation: event.target.value }))}
                    disabled={passwordSubmitting}
                  />
                  <Box>
                    <Button type="submit" variant="contained" disabled={passwordSubmitting}>
                      {passwordSubmitting ? "Changing password" : "Change password"}
                    </Button>
                  </Box>
                </Box>
              </SettingsGroup>
            )}

            {account.browser_session_management_available && (
              <SettingsGroup title="Browser sessions">
                {sessions === null ? (
                  <Box>
                    <Typography color="text.secondary">Browser sessions could not be loaded.</Typography>
                    <Button sx={{ mt: 2 }} variant="outlined" onClick={() => void loadAccount()} disabled={revoking !== null || signingOut}>
                      Try again
                    </Button>
                  </Box>
                ) : sessions.length === 0 ? (
                  <Typography color="text.secondary">No renewable OIDC sessions are active.</Typography>
                ) : (
                  <>
                    <SettingsList>
                      {sessions.map((browserSession) => (
                        <ListItem
                          key={browserSession.id}
                          divider
                          secondaryAction={
                            <Button
                              color="error"
                              onClick={() => void revokeSession(browserSession)}
                              disabled={revoking !== null || signingOut}
                            >
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
                    </SettingsList>
                    {sessions.some((browserSession) => !browserSession.current) && (
                      <Button
                        sx={{ mt: 2 }}
                        color="error"
                        onClick={() => void revokeOtherSessions()}
                        disabled={revoking !== null || signingOut}
                      >
                        Revoke all other sessions
                      </Button>
                    )}
                  </>
                )}
              </SettingsGroup>
            )}

            <Box>
              <Button color="error" variant="outlined" onClick={() => void signOut()} disabled={signingOut || passwordSubmitting}>
                {signingOut ? "Signing out" : "Sign out"}
              </Button>
            </Box>
          </SettingsSectionList>
        )}
      </Box>
    </Box>
  );
}
