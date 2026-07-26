import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Divider,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";
import { clearAuthConfigCache } from "../services/authConfig";
import type { OidcAdminConfigurationRead, OidcConfigurationCandidate, OidcTestedIdentity } from "../types";

const DEFAULT_CANDIDATE: OidcConfigurationCandidate = {
  display_name: "",
  issuer_url: "",
  client_id: "",
  scopes: ["openid", "profile", "email", "groups"],
  username_claim: "preferred_username",
  username_claim_uniqueness_confirmed: false,
  name_claim: "name",
  email_claim: "email",
  groups_claim: "groups",
  sign_in_mode: "password_only",
  admission_mode: "selected_groups",
  admission_groups: [],
  role_mappings: { admin: [], editor: [] },
};

const listValue = (values: string[]) => values.join(", ");
const parseList = (value: string) =>
  value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
const optionalClaim = (value: string) => value.trim() || null;
const editableCandidate = ({
  client_secret_configured: _,
  configuration_revision: __,
  identity_mapping_revision: ___,
  ...candidate
}: NonNullable<OidcAdminConfigurationRead["configuration"]>): OidcConfigurationCandidate => candidate;

export function AuthenticationSettings() {
  const navigate = useNavigate();
  const [candidate, setCandidate] = useState<OidcConfigurationCandidate>(DEFAULT_CANDIDATE);
  const [configuration, setConfiguration] = useState<OidcAdminConfigurationRead | null>(null);
  const [clientSecret, setClientSecret] = useState("");
  const [testedIdentity, setTestedIdentity] = useState<OidcTestedIdentity | null>(null);
  const [mappingReview, setMappingReview] = useState<
    Record<string, { selected: boolean; expectedUsername: string; omissionAcknowledged: boolean }>
  >({});
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const selectedMappings = testedIdentity?.replacement_mappings.filter((mapping) => mappingReview[mapping.target_user_id]?.selected) ?? [];
  const replacementUsernames = selectedMappings.map((mapping) => mappingReview[mapping.target_user_id].expectedUsername.trim());
  const requiredOmissions =
    testedIdentity?.replacement_mappings.filter(
      (mapping) =>
        mapping.omission_acknowledgement_required &&
        !mappingReview[mapping.target_user_id]?.selected &&
        !mappingReview[mapping.target_user_id]?.omissionAcknowledged
    ) ?? [];
  const replacementPlanInvalid =
    replacementUsernames.some((username) => !username || username === testedIdentity?.username.trim()) ||
    new Set(replacementUsernames).size !== replacementUsernames.length ||
    requiredOmissions.length > 0;

  useEffect(() => {
    let active = true;
    void api
      .getOidcConfiguration()
      .then((response) => {
        if (!active) return;
        setConfiguration(response);
        if (response.configuration) {
          setCandidate(editableCandidate(response.configuration));
        }
        const flowId = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("flow");
        if (!flowId) return;
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
        return api.getOidcTestResult(flowId).then((identity) => {
          if (active) {
            setCandidate(editableCandidate(identity.candidate));
            setTestedIdentity(identity);
            setMappingReview(
              Object.fromEntries(
                identity.replacement_mappings.map((mapping) => [
                  mapping.target_user_id,
                  {
                    selected: mapping.selected_by_default,
                    expectedUsername: mapping.selected_by_default ? mapping.suggested_username : "",
                    omissionAcknowledged: false,
                  },
                ])
              )
            );
          }
        });
      })
      .catch(() => {
        if (active) setError("Authentication settings could not be loaded.");
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const update = <Key extends keyof OidcConfigurationCandidate>(key: Key, value: OidcConfigurationCandidate[Key]) => {
    setCandidate((current) => ({
      ...current,
      [key]: value,
      ...(["issuer_url", "client_id", "username_claim"].includes(key) ? { username_claim_uniqueness_confirmed: false } : {}),
    }));
    setTestedIdentity(null);
    setMappingReview({});
    setNotice("");
  };

  const startTest = async () => {
    setBusy(true);
    setError("");
    try {
      const payload = { ...candidate };
      if (clientSecret.trim()) payload.client_secret = clientSecret;
      const result = await api.startOidcTest(payload);
      window.location.assign(result.authorization_url);
    } catch {
      setError("The OIDC configuration could not be validated.");
      setBusy(false);
    }
  };

  const activate = async () => {
    if (!testedIdentity || replacementPlanInvalid) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.finalizeOidcConfiguration(
        testedIdentity.flow_id,
        selectedMappings.map(({ target_user_id }) => ({
          target_user_id,
          expected_username: mappingReview[target_user_id].expectedUsername.trim(),
        })),
        testedIdentity.expected_identity_mapping_revision,
        testedIdentity.replacement_mappings
          .filter(
            (mapping) =>
              mapping.omission_acknowledgement_required &&
              !mappingReview[mapping.target_user_id]?.selected &&
              mappingReview[mapping.target_user_id]?.omissionAcknowledged
          )
          .map((mapping) => mapping.target_user_id)
      );
      clearAuthConfigCache();
      setTestedIdentity(null);
      setMappingReview({});
      setClientSecret("");
      if (result.reauthentication_required) {
        localStorage.removeItem("access_token");
        navigate("/login", { replace: true });
        return;
      }
      setNotice("Authentication configuration activated.");
      const refreshed = await api.getOidcConfiguration();
      setConfiguration(refreshed);
      if (refreshed.configuration) setCandidate(editableCandidate(refreshed.configuration));
    } catch {
      setError("The tested configuration could not be activated. Run the test again.");
    } finally {
      setBusy(false);
    }
  };

  const setPasswordOnly = async () => {
    if (!window.confirm("Switch to Password only and revoke all active sessions?")) return;
    setBusy(true);
    setError("");
    try {
      await api.setPasswordOnlyAuthentication();
      clearAuthConfigCache();
      setTestedIdentity(null);
      setClientSecret("");
      localStorage.removeItem("access_token");
      navigate("/login", { replace: true });
    } catch {
      setError("Password-only mode requires an active administrator with a local password.");
    } finally {
      setBusy(false);
    }
  };

  if (busy && !configuration) return <CircularProgress aria-label="Loading authentication settings" />;

  return (
    <Box sx={{ width: "100%", maxWidth: 820 }}>
      <Typography variant="h5" component="h1">
        Authentication
      </Typography>
      <Typography color="text.secondary" sx={{ mt: 1, mb: 3 }}>
        Configure local password and OpenID Connect sign-in.
      </Typography>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {notice && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {notice}
        </Alert>
      )}
      {configuration?.health.status === "unhealthy" && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          Complete the server prerequisites before testing: {configuration.health.reasons.join(", ")}.
          {configuration.health.redirect_uri && ` Redirect URI: ${configuration.health.redirect_uri}`}
        </Alert>
      )}

      <Stack spacing={2.5}>
        <Typography variant="h6">Provider</Typography>
        <TextField
          label="Provider name"
          value={candidate.display_name}
          onChange={(event) => update("display_name", event.target.value)}
          required
        />
        <TextField
          label="Issuer URL"
          value={candidate.issuer_url}
          onChange={(event) => update("issuer_url", event.target.value)}
          required
        />
        <TextField label="Client ID" value={candidate.client_id} onChange={(event) => update("client_id", event.target.value)} required />
        <TextField
          label="Client secret"
          type="password"
          value={clientSecret}
          onChange={(event) => {
            setClientSecret(event.target.value);
            setTestedIdentity(null);
          }}
          helperText={
            configuration?.configuration?.client_secret_configured
              ? "Leave blank to keep the stored secret."
              : "Required for the first test."
          }
        />
        <TextField
          label="Scopes"
          value={listValue(candidate.scopes)}
          onChange={(event) => update("scopes", parseList(event.target.value))}
          helperText="Comma-separated; openid is required."
        />

        <Divider />
        <Typography variant="h6">Claims and access</Typography>
        <TextField
          label="Username claim"
          value={candidate.username_claim}
          onChange={(event) => update("username_claim", event.target.value)}
          required
        />
        <FormControlLabel
          control={
            <Checkbox
              checked={candidate.username_claim_uniqueness_confirmed}
              onChange={(event) => update("username_claim_uniqueness_confirmed", event.target.checked)}
            />
          }
          label="I confirmed this claim is stable and unique for every user"
        />
        <TextField
          label="Name claim"
          value={candidate.name_claim ?? ""}
          onChange={(event) => update("name_claim", optionalClaim(event.target.value))}
        />
        <TextField
          label="Email claim"
          value={candidate.email_claim ?? ""}
          onChange={(event) => update("email_claim", optionalClaim(event.target.value))}
        />
        <TextField
          label="Groups claim"
          value={candidate.groups_claim ?? ""}
          onChange={(event) => update("groups_claim", optionalClaim(event.target.value))}
        />
        <TextField
          select
          label="Admission"
          value={candidate.admission_mode}
          onChange={(event) => update("admission_mode", event.target.value as OidcConfigurationCandidate["admission_mode"])}
        >
          <MenuItem value="all_idp_users">All authenticated users</MenuItem>
          <MenuItem value="selected_groups">Only selected groups</MenuItem>
        </TextField>
        {candidate.admission_mode === "selected_groups" && (
          <TextField
            label="Admission groups"
            value={listValue(candidate.admission_groups)}
            onChange={(event) => update("admission_groups", parseList(event.target.value))}
            helperText="Comma-separated, exact group names."
          />
        )}
        <TextField
          label="Administrator groups"
          value={listValue(candidate.role_mappings.admin)}
          onChange={(event) => update("role_mappings", { ...candidate.role_mappings, admin: parseList(event.target.value) })}
          required
        />
        <TextField
          label="Editor groups"
          value={listValue(candidate.role_mappings.editor)}
          onChange={(event) => update("role_mappings", { ...candidate.role_mappings, editor: parseList(event.target.value) })}
        />
        <TextField
          select
          label="Sign-in mode"
          value={candidate.sign_in_mode}
          onChange={(event) => update("sign_in_mode", event.target.value as OidcConfigurationCandidate["sign_in_mode"])}
        >
          <MenuItem value="password_only">Password only</MenuItem>
          <MenuItem value="oidc_or_password">OIDC or password</MenuItem>
          <MenuItem value="oidc_only">OIDC only</MenuItem>
        </TextField>

        <Button variant="outlined" disabled={busy || configuration?.health.status !== "healthy"} onClick={startTest}>
          Connect and test
        </Button>

        {testedIdentity && (
          <Box sx={{ borderLeft: 3, borderColor: "success.main", pl: 2, py: 1 }}>
            <Typography variant="h6">Tested identity</Typography>
            <Typography>Username: {testedIdentity.username}</Typography>
            {testedIdentity.email && <Typography>Email: {testedIdentity.email}</Typography>}
            <Typography>Groups: {testedIdentity.groups.join(", ") || "None"}</Typography>
            {testedIdentity.replacement_mappings.length > 0 && (
              <Stack spacing={2} sx={{ mt: 2 }}>
                <Typography variant="subtitle1">Review existing accounts</Typography>
                {testedIdentity.replacement_mappings
                  .filter((mapping) => mapping.selectable)
                  .map((mapping) => {
                    const review = mappingReview[mapping.target_user_id];
                    const expectedUsername = review?.expectedUsername ?? "";
                    const hintLabel =
                      mapping.prefill_source === "pending"
                        ? "Previous pending"
                        : mapping.prefill_source === "last_seen"
                          ? "Last seen"
                          : "Unverified";
                    return (
                      <Box key={mapping.target_user_id} sx={{ borderBottom: 1, borderColor: "divider", pb: 2 }}>
                        <FormControlLabel
                          control={
                            <Checkbox
                              checked={review?.selected ?? false}
                              onChange={(event) =>
                                setMappingReview((current) => ({
                                  ...current,
                                  [mapping.target_user_id]: {
                                    ...current[mapping.target_user_id],
                                    selected: event.target.checked,
                                    expectedUsername:
                                      event.target.checked && !current[mapping.target_user_id]?.expectedUsername
                                        ? mapping.suggested_username
                                        : (current[mapping.target_user_id]?.expectedUsername ?? ""),
                                    omissionAcknowledged: false,
                                  },
                                }))
                              }
                            />
                          }
                          label={`Map ${mapping.local_username}`}
                        />
                        <TextField
                          fullWidth
                          label={`Provider username for ${mapping.local_username}`}
                          value={expectedUsername}
                          placeholder={mapping.suggested_username}
                          helperText={`${hintLabel}: ${mapping.suggested_username}`}
                          disabled={!review?.selected}
                          error={
                            Boolean(review?.selected) &&
                            (!expectedUsername.trim() ||
                              expectedUsername.trim() === testedIdentity.username.trim() ||
                              replacementUsernames.filter((value) => value === expectedUsername.trim()).length > 1)
                          }
                          onChange={(event) =>
                            setMappingReview((current) => ({
                              ...current,
                              [mapping.target_user_id]: {
                                ...current[mapping.target_user_id],
                                expectedUsername: event.target.value,
                              },
                            }))
                          }
                          required={review?.selected}
                        />
                        {mapping.omission_acknowledgement_required && !review?.selected && (
                          <FormControlLabel
                            control={
                              <Checkbox
                                checked={review?.omissionAcknowledged ?? false}
                                onChange={(event) =>
                                  setMappingReview((current) => ({
                                    ...current,
                                    [mapping.target_user_id]: {
                                      ...current[mapping.target_user_id],
                                      omissionAcknowledged: event.target.checked,
                                    },
                                  }))
                                }
                              />
                            }
                            label={`I understand ${mapping.local_username} cannot use a local password in OIDC only mode`}
                          />
                        )}
                      </Box>
                    );
                  })}
                {testedIdentity.replacement_mappings.some((mapping) => !mapping.selectable) && (
                  <Box>
                    <Typography variant="subtitle2">Inactive or expired accounts</Typography>
                    {testedIdentity.replacement_mappings
                      .filter((mapping) => !mapping.selectable)
                      .map((mapping) => (
                        <Typography key={mapping.target_user_id} color="text.secondary">
                          {mapping.local_username} ({mapping.target_state}) must be reactivated before mapping.
                        </Typography>
                      ))}
                  </Box>
                )}
              </Stack>
            )}
            <Button variant="contained" sx={{ mt: 2 }} disabled={busy || replacementPlanInvalid} onClick={activate}>
              Activate configuration
            </Button>
          </Box>
        )}

        {configuration?.configuration && (
          <>
            <Divider />
            <Typography variant="h6">Recovery</Typography>
            <Button color="warning" variant="outlined" disabled={busy} onClick={setPasswordOnly}>
              Switch to Password only
            </Button>
          </>
        )}
      </Stack>
    </Box>
  );
}
