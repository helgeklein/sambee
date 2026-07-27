import { ContentCopy, ExpandMore, Visibility, VisibilityOff } from "@mui/icons-material";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Link,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { Trans } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { SettingsPage } from "../components/Settings/SettingsPage";
import { settingsPrimaryButtonSx } from "../components/Settings/settingsButtonStyles";
import { loadAuthenticationSettingsData, SETTINGS_DATA_CACHE_KEYS } from "../components/Settings/settingsDataSources";
import { getCachedAsyncData, primeCachedAsyncData } from "../hooks/useCachedAsyncData";
import api from "../services/api";
import { clearAuthConfigCache } from "../services/authConfig";
import { loginPath } from "../services/oidcAuth";
import {
  type AuthenticationMode,
  isApiError,
  type OidcAdminConfigurationRead,
  type OidcConfigurationCandidate,
  type OidcReviewedPolicy,
  type OidcTestedIdentity,
} from "../types";
import { getApiErrorMessage, getOidcMappingValidationErrors } from "../utils/apiErrors";

const DEFAULT_CANDIDATE: OidcConfigurationCandidate = {
  display_name: "",
  issuer_url: "",
  client_id: "",
  scopes: ["openid", "profile", "email", "groups"],
  username_claim: "preferred_username",
  name_claim: "name",
  email_claim: "email",
  groups_claim: "groups",
  sign_in_mode: "oidc_or_password",
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
const OIDC_SETUP_FLOW_STORAGE_KEY = "sambee.oidc.setupFlowId";
const OIDC_REVIEWED_POLICY_STORAGE_KEY = "sambee.oidc.reviewedPolicy";
const OIDC_PENDING_FINALIZATION_STORAGE_KEY = "sambee.oidc.pendingFinalization";
const OIDC_SETUP_GUIDE_URL = "https://sambee.net/mr/help-oidc-setup";
const REVIEWABLE_POLICY_KEYS = new Set<keyof OidcConfigurationCandidate>([
  "sign_in_mode",
  "admission_mode",
  "admission_groups",
  "role_mappings",
]);
const normalizedGroupKey = (value: string) => value.normalize("NFKC").trim().toLowerCase();
const duplicateGroupKeys = (values: string[]) => {
  const keys = values.map(normalizedGroupKey);
  return new Set(keys.filter((key, index) => key && keys.indexOf(key) !== index));
};
const editableCandidate = ({
  client_secret_configured: _,
  configuration_revision: __,
  identity_mapping_revision: ___,
  ...candidate
}: NonNullable<OidcAdminConfigurationRead["configuration"]>): OidcConfigurationCandidate => candidate;
const reviewedPolicyFor = (candidate: OidcConfigurationCandidate): OidcReviewedPolicy => ({
  sign_in_mode: candidate.sign_in_mode,
  admission_mode: candidate.admission_mode,
  admission_groups: candidate.admission_groups,
  role_mappings: candidate.role_mappings,
});
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((entry) => typeof entry === "string");
const isReviewedPolicy = (value: unknown): value is OidcReviewedPolicy => {
  if (typeof value !== "object" || value === null) return false;
  const policy = value as Record<string, unknown>;
  const roleMappings = policy["role_mappings"];
  return (
    (policy["sign_in_mode"] === "oidc_or_password" || policy["sign_in_mode"] === "oidc_only") &&
    (policy["admission_mode"] === "all_idp_users" || policy["admission_mode"] === "selected_groups") &&
    isStringArray(policy["admission_groups"]) &&
    typeof roleMappings === "object" &&
    roleMappings !== null &&
    isStringArray((roleMappings as Record<string, unknown>)["admin"]) &&
    isStringArray((roleMappings as Record<string, unknown>)["editor"])
  );
};
const storedReviewedPolicy = (): OidcReviewedPolicy | undefined => {
  const stored = sessionStorage.getItem(OIDC_REVIEWED_POLICY_STORAGE_KEY);
  if (!stored) return undefined;
  try {
    const policy: unknown = JSON.parse(stored);
    if (isReviewedPolicy(policy)) return policy;
  } catch {
    // Invalid persisted state is discarded below.
  }
  sessionStorage.removeItem(OIDC_REVIEWED_POLICY_STORAGE_KEY);
  return undefined;
};
interface PendingOidcFinalization {
  flow_id: string;
  reviewed_policy: OidcReviewedPolicy;
  replacement_mappings: Array<{ target_user_id: string; expected_username: string }>;
  expected_identity_mapping_revision: number | null;
  omitted_account_acknowledgements: string[];
}
type FinalizationFailureKind = "ambiguous" | "reauthentication" | "mapping_stale" | "configuration_changed" | "validation" | "other";
const isPendingOidcFinalization = (value: unknown): value is PendingOidcFinalization => {
  if (typeof value !== "object" || value === null) return false;
  const request = value as Record<string, unknown>;
  return (
    typeof request["flow_id"] === "string" &&
    request["flow_id"].length > 0 &&
    isReviewedPolicy(request["reviewed_policy"]) &&
    Array.isArray(request["replacement_mappings"]) &&
    request["replacement_mappings"].every(
      (mapping) =>
        typeof mapping === "object" &&
        mapping !== null &&
        typeof (mapping as Record<string, unknown>)["target_user_id"] === "string" &&
        typeof (mapping as Record<string, unknown>)["expected_username"] === "string"
    ) &&
    (request["expected_identity_mapping_revision"] === null ||
      (typeof request["expected_identity_mapping_revision"] === "number" &&
        Number.isInteger(request["expected_identity_mapping_revision"]) &&
        request["expected_identity_mapping_revision"] >= 0)) &&
    isStringArray(request["omitted_account_acknowledgements"])
  );
};
const storedPendingFinalization = (): PendingOidcFinalization | undefined => {
  const stored = sessionStorage.getItem(OIDC_PENDING_FINALIZATION_STORAGE_KEY);
  if (!stored) return undefined;
  try {
    const request: unknown = JSON.parse(stored);
    if (isPendingOidcFinalization(request)) return request;
  } catch {
    // Invalid persisted state is discarded below.
  }
  sessionStorage.removeItem(OIDC_PENDING_FINALIZATION_STORAGE_KEY);
  return undefined;
};
const finalizeOidcRequest = (request: PendingOidcFinalization) =>
  api.finalizeOidcConfiguration(
    request.flow_id,
    request.reviewed_policy,
    request.replacement_mappings,
    request.expected_identity_mapping_revision,
    request.omitted_account_acknowledgements
  );
const finalizeOidcRequestWithRetry = async (request: PendingOidcFinalization) => {
  try {
    return await finalizeOidcRequest(request);
  } catch (firstAttemptError: unknown) {
    if (!isApiError(firstAttemptError) || firstAttemptError.response !== undefined) throw firstAttemptError;
    return finalizeOidcRequest(request);
  }
};
const finalizationFailureKind = (error: unknown): FinalizationFailureKind => {
  if (!isApiError(error)) return "other";
  if (error.response === undefined) return "ambiguous";
  if (error.response.status === 401) return "reauthentication";
  const errorCode = getApiErrorMessage(error, "");
  if (errorCode === "oidc_mapping_review_stale") return "mapping_stale";
  if (errorCode === "oidc_configuration_changed") return "configuration_changed";
  if (getOidcMappingValidationErrors(error).length > 0) return "validation";
  return "other";
};
const mappingReviewFor = (identity: OidcTestedIdentity) =>
  Object.fromEntries(
    identity.replacement_mappings.map((mapping) => [
      mapping.target_user_id,
      {
        selected: mapping.selected_by_default,
        expectedUsername: mapping.selected_by_default ? mapping.suggested_username : "",
        omissionAcknowledged: false,
      },
    ])
  );

export function AuthenticationSettings() {
  const navigate = useNavigate();
  const [candidate, setCandidate] = useState<OidcConfigurationCandidate>(DEFAULT_CANDIDATE);
  const [configuration, setConfiguration] = useState<OidcAdminConfigurationRead | null>(() =>
    getCachedAsyncData<OidcAdminConfigurationRead>(SETTINGS_DATA_CACHE_KEYS.adminAuthentication)
  );
  const [authMode, setAuthMode] = useState<AuthenticationMode>("password_only");
  const [noAuthenticationAcknowledged, setNoAuthenticationAcknowledged] = useState(false);
  const [clientSecret, setClientSecret] = useState("");
  const [showClientSecret, setShowClientSecret] = useState(false);
  const [testedIdentity, setTestedIdentity] = useState<OidcTestedIdentity | null>(null);
  const [mappingReview, setMappingReview] = useState<
    Record<string, { selected: boolean; expectedUsername: string; omissionAcknowledged: boolean }>
  >({});
  const [mappingErrors, setMappingErrors] = useState<Record<string, string>>({});
  const [reviewPending, setReviewPending] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [finalizationUnresolved, setFinalizationUnresolved] = useState(() => storedPendingFinalization() !== undefined);
  const previewRequestSequence = useRef(0);
  const selectedMappings = testedIdentity?.replacement_mappings.filter((mapping) => mappingReview[mapping.target_user_id]?.selected) ?? [];
  const replacementUsernames = selectedMappings.map((mapping) => mappingReview[mapping.target_user_id]?.expectedUsername.trim() ?? "");
  const requiredOmissions =
    testedIdentity?.replacement_mappings.filter(
      (mapping) =>
        mapping.omission_acknowledgement_required &&
        !mappingReview[mapping.target_user_id]?.selected &&
        !mappingReview[mapping.target_user_id]?.omissionAcknowledged
    ) ?? [];
  const omittedPasswordlessMappings =
    testedIdentity?.replacement_mappings.filter(
      (mapping) =>
        mapping.target_state === "active" &&
        !mapping.has_local_password &&
        !mappingReview[mapping.target_user_id]?.selected &&
        testedIdentity.candidate.sign_in_mode === "oidc_or_password"
    ) ?? [];
  const replacementPlanInvalid =
    replacementUsernames.some((username) => !username || username === testedIdentity?.username.trim()) ||
    new Set(replacementUsernames).size !== replacementUsernames.length ||
    requiredOmissions.length > 0;
  const duplicateAdmissionGroups = duplicateGroupKeys(candidate.admission_groups);
  const duplicateAdminGroups = duplicateGroupKeys(candidate.role_mappings.admin);
  const duplicateEditorGroups = duplicateGroupKeys(candidate.role_mappings.editor);
  const adminGroupKeys = new Set(candidate.role_mappings.admin.map(normalizedGroupKey));
  const editorGroupKeys = new Set(candidate.role_mappings.editor.map(normalizedGroupKey));
  const crossRoleGroupKeys = new Set([...adminGroupKeys].filter((key) => editorGroupKeys.has(key)));
  const admissionGroupError =
    candidate.admission_mode === "selected_groups" && candidate.admission_groups.length === 0
      ? "Members of these groups can sign in. Enter at least one group name. Separate multiple groups by commas."
      : duplicateAdmissionGroups.size > 0
        ? "Admission groups must be unique after normalization."
        : "";
  const adminGroupError =
    duplicateAdminGroups.size > 0
      ? "Administrator groups must be unique after normalization."
      : crossRoleGroupKeys.size > 0
        ? "A group cannot grant both administrator and editor roles."
        : "";
  const editorGroupError =
    duplicateEditorGroups.size > 0
      ? "Editor groups must be unique after normalization."
      : crossRoleGroupKeys.size > 0
        ? "A group cannot grant both administrator and editor roles."
        : "";
  const groupConfigurationInvalid = Boolean(admissionGroupError || adminGroupError || editorGroupError);
  const testedIdentityCanAdminister = !reviewPending && testedIdentity?.admitted === true && testedIdentity.resulting_role === "admin";
  const isOidcMode = authMode === "oidc_or_password" || authMode === "oidc_only";

  useEffect(() => {
    let active = true;
    const restore = async () => {
      let recoveredFinalization = false;
      let replayFailure: FinalizationFailureKind | null = null;
      let replayValidationErrors: ReturnType<typeof getOidcMappingValidationErrors> = [];
      const fragmentFlowId = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("flow");
      if (fragmentFlowId) {
        sessionStorage.setItem(OIDC_SETUP_FLOW_STORAGE_KEY, fragmentFlowId);
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      }
      const pendingFinalization = storedPendingFinalization();
      if (pendingFinalization) {
        setFinalizationUnresolved(true);
        try {
          const result = await finalizeOidcRequestWithRetry(pendingFinalization);
          if (!active) return;
          clearAuthConfigCache();
          setFinalizationUnresolved(false);
          sessionStorage.removeItem(OIDC_PENDING_FINALIZATION_STORAGE_KEY);
          sessionStorage.removeItem(OIDC_SETUP_FLOW_STORAGE_KEY);
          sessionStorage.removeItem(OIDC_REVIEWED_POLICY_STORAGE_KEY);
          if (result.reauthentication_required) {
            localStorage.removeItem("access_token");
            navigate(loginPath(window.location.pathname + window.location.search), { replace: true });
            return;
          }
          setNotice("Authentication configuration activated.");
          recoveredFinalization = true;
        } catch (caught: unknown) {
          if (!active) return;
          replayFailure = finalizationFailureKind(caught);
          if (replayFailure === "validation") {
            replayValidationErrors = getOidcMappingValidationErrors(caught);
          }
          if (replayFailure === "ambiguous") {
            setError("Activation may have completed, but the server response was not received. Reload this page to confirm the result.");
            return;
          }
          if (replayFailure === "reauthentication") return;
          setFinalizationUnresolved(false);
          sessionStorage.removeItem(OIDC_PENDING_FINALIZATION_STORAGE_KEY);
          if (replayFailure === "configuration_changed") {
            sessionStorage.removeItem(OIDC_SETUP_FLOW_STORAGE_KEY);
            sessionStorage.removeItem(OIDC_REVIEWED_POLICY_STORAGE_KEY);
            setError("The OIDC configuration changed after this test. Connect and test the provider again.");
          }
        }
      }

      const response = await primeCachedAsyncData(SETTINGS_DATA_CACHE_KEYS.adminAuthentication, loadAuthenticationSettingsData);
      if (!active) return;
      setConfiguration(response);
      setAuthMode(response.auth_mode);
      if (response.configuration) setCandidate(editableCandidate(response.configuration));
      if (recoveredFinalization || replayFailure === "configuration_changed") return;
      const flowId = fragmentFlowId ?? sessionStorage.getItem(OIDC_SETUP_FLOW_STORAGE_KEY);
      if (!flowId) return;
      try {
        const identity = await api.getOidcTestResult(flowId, storedReviewedPolicy());
        if (!active) return;
        setCandidate(editableCandidate(identity.candidate));
        setTestedIdentity(identity);
        setMappingErrors(
          replayFailure === "validation"
            ? Object.fromEntries(
                replayValidationErrors
                  .filter((mappingError) => mappingError.target_user_id !== null)
                  .map((mappingError) => [mappingError.target_user_id, mappingError.message])
              )
            : {}
        );
        setMappingReview(mappingReviewFor(identity));
        sessionStorage.setItem(OIDC_REVIEWED_POLICY_STORAGE_KEY, JSON.stringify(reviewedPolicyFor(identity.candidate)));
        if (replayFailure === "mapping_stale") {
          setError("The account mapping review changed. Review the refreshed mappings before activating.");
        } else if (replayFailure === "validation") {
          setError("Correct the highlighted OIDC mapping errors before activating.");
        } else if (replayFailure === "other") {
          setError("The tested configuration could not be activated. Review it before trying again.");
        }
      } catch (caught: unknown) {
        if (!active) return;
        if (isApiError(caught) && caught.response?.status === 404) {
          sessionStorage.removeItem(OIDC_SETUP_FLOW_STORAGE_KEY);
          sessionStorage.removeItem(OIDC_REVIEWED_POLICY_STORAGE_KEY);
          setError("The saved OIDC test has expired. Connect and test the provider again.");
          return;
        }
        setError("The OIDC test result could not be loaded. Retry by reopening this page.");
      }
    };
    void restore()
      .catch(() => {
        if (active) setError("Authentication settings could not be loaded.");
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [navigate]);

  const update = <Key extends keyof OidcConfigurationCandidate>(key: Key, value: OidcConfigurationCandidate[Key]) => {
    if (finalizationUnresolved) return;
    const nextCandidate = {
      ...candidate,
      [key]: value,
    };
    setCandidate(nextCandidate);
    if (testedIdentity && REVIEWABLE_POLICY_KEYS.has(key)) {
      const requestSequence = ++previewRequestSequence.current;
      const reviewedPolicy = reviewedPolicyFor(nextCandidate);
      sessionStorage.setItem(OIDC_REVIEWED_POLICY_STORAGE_KEY, JSON.stringify(reviewedPolicy));
      setReviewPending(true);
      setError("");
      void api
        .getOidcTestResult(testedIdentity.flow_id, reviewedPolicy)
        .then((identity) => {
          if (requestSequence !== previewRequestSequence.current) return;
          setCandidate(editableCandidate(identity.candidate));
          setTestedIdentity(identity);
          setMappingErrors({});
          setMappingReview(mappingReviewFor(identity));
          setReviewPending(false);
        })
        .catch((caught: unknown) => {
          if (requestSequence !== previewRequestSequence.current) return;
          if (isApiError(caught) && caught.response?.status === 404) {
            sessionStorage.removeItem(OIDC_SETUP_FLOW_STORAGE_KEY);
            sessionStorage.removeItem(OIDC_REVIEWED_POLICY_STORAGE_KEY);
            setTestedIdentity(null);
            setMappingReview({});
            setError("The OIDC test expired. Connect and test the provider again.");
            return;
          }
          if (getApiErrorMessage(caught, "") === "oidc_configuration_changed") {
            sessionStorage.removeItem(OIDC_SETUP_FLOW_STORAGE_KEY);
            sessionStorage.removeItem(OIDC_REVIEWED_POLICY_STORAGE_KEY);
            setTestedIdentity(null);
            setMappingReview({});
            setError("The OIDC configuration changed after this test. Connect and test the provider again.");
            return;
          }
          setError("The reviewed access policy could not be evaluated. Change it or retry before activating.");
        });
      setNotice("");
      return;
    }
    ++previewRequestSequence.current;
    setReviewPending(false);
    setTestedIdentity(null);
    setMappingReview({});
    setMappingErrors({});
    sessionStorage.removeItem(OIDC_SETUP_FLOW_STORAGE_KEY);
    sessionStorage.removeItem(OIDC_REVIEWED_POLICY_STORAGE_KEY);
    setNotice("");
  };

  const startTest = async (remapAll = false) => {
    if (finalizationUnresolved) return;
    setBusy(true);
    setError("");
    try {
      const payload = { ...candidate };
      if (clientSecret.trim()) payload.client_secret = clientSecret;
      const result = await api.startOidcTest(payload, remapAll);
      sessionStorage.setItem(OIDC_SETUP_FLOW_STORAGE_KEY, result.flow_id);
      sessionStorage.setItem(OIDC_REVIEWED_POLICY_STORAGE_KEY, JSON.stringify(reviewedPolicyFor(candidate)));
      window.location.assign(result.authorization_url);
    } catch {
      setError("The OIDC configuration could not be validated.");
      setBusy(false);
    }
  };

  const activate = async () => {
    if (finalizationUnresolved || !testedIdentity || replacementPlanInvalid || !testedIdentityCanAdminister) return;
    const signInPath = testedIdentity.candidate.sign_in_mode === "oidc_only" ? "OIDC only" : "OIDC or password";
    const affectedAccountMessage =
      testedIdentity.affected_account_count === 0
        ? "No accounts will be signed out."
        : `${testedIdentity.affected_account_count} account${testedIdentity.affected_account_count === 1 ? "" : "s"} will be signed out.`;
    const actingAdministratorMessage = testedIdentity.acting_administrator_affected
      ? ` This includes your account. You must sign in through ${testedIdentity.candidate.display_name} to continue.`
      : "";
    const provisioningMessage =
      testedIdentity.candidate.admission_mode === "all_idp_users"
        ? " Any identity-provider user is admitted and a new local account is created on first sign-in when no mapping exists."
        : " Only members of the selected admission groups are admitted; an admitted user gets a new local account on first sign-in when no mapping exists.";
    if (
      !window.confirm(
        `Activate ${testedIdentity.candidate.display_name} in ${signInPath} mode? The tested identity ${testedIdentity.username} will be linked to your current administrator account. ${affectedAccountMessage}${actingAdministratorMessage}${provisioningMessage}`
      )
    )
      return;
    setBusy(true);
    setError("");
    const finalizationRequest: PendingOidcFinalization = {
      flow_id: testedIdentity.flow_id,
      reviewed_policy: reviewedPolicyFor(candidate),
      replacement_mappings: selectedMappings.map(({ target_user_id }) => ({
        target_user_id,
        expected_username: mappingReview[target_user_id]?.expectedUsername.trim() ?? "",
      })),
      expected_identity_mapping_revision: testedIdentity.expected_identity_mapping_revision,
      omitted_account_acknowledgements: testedIdentity.replacement_mappings
        .filter(
          (mapping) =>
            mapping.omission_acknowledgement_required &&
            !mappingReview[mapping.target_user_id]?.selected &&
            mappingReview[mapping.target_user_id]?.omissionAcknowledged
        )
        .map((mapping) => mapping.target_user_id),
    };
    sessionStorage.setItem(OIDC_PENDING_FINALIZATION_STORAGE_KEY, JSON.stringify(finalizationRequest));
    setFinalizationUnresolved(true);
    let result: Awaited<ReturnType<typeof finalizeOidcRequestWithRetry>>;
    try {
      result = await finalizeOidcRequestWithRetry(finalizationRequest);
    } catch (caught: unknown) {
      const failureKind = finalizationFailureKind(caught);
      if (failureKind !== "ambiguous" && failureKind !== "reauthentication") {
        setFinalizationUnresolved(false);
        sessionStorage.removeItem(OIDC_PENDING_FINALIZATION_STORAGE_KEY);
      }
      const validationErrors = getOidcMappingValidationErrors(caught);
      if (failureKind === "mapping_stale") {
        try {
          const refreshedIdentity = await api.getOidcTestResult(testedIdentity.flow_id, reviewedPolicyFor(candidate));
          setCandidate(editableCandidate(refreshedIdentity.candidate));
          setTestedIdentity(refreshedIdentity);
          setMappingErrors({});
          setMappingReview(mappingReviewFor(refreshedIdentity));
          setError("The account mapping review changed. Review the refreshed mappings before activating.");
        } catch (refreshError: unknown) {
          if (isApiError(refreshError) && refreshError.response?.status === 404) {
            sessionStorage.removeItem(OIDC_SETUP_FLOW_STORAGE_KEY);
            sessionStorage.removeItem(OIDC_REVIEWED_POLICY_STORAGE_KEY);
            setTestedIdentity(null);
            setMappingReview({});
            setMappingErrors({});
            setError("The OIDC test expired while refreshing mappings. Connect and test the provider again.");
          } else {
            setError("The current mapping review could not be loaded. Retry activation to refresh it.");
          }
        }
      } else if (failureKind === "configuration_changed") {
        sessionStorage.removeItem(OIDC_SETUP_FLOW_STORAGE_KEY);
        sessionStorage.removeItem(OIDC_REVIEWED_POLICY_STORAGE_KEY);
        setTestedIdentity(null);
        setMappingReview({});
        setMappingErrors({});
        setError("The OIDC configuration changed after this test. Connect and test the provider again.");
      } else if (failureKind === "validation") {
        setMappingErrors(
          Object.fromEntries(
            validationErrors
              .filter((mappingError) => mappingError.target_user_id !== null)
              .map((mappingError) => [mappingError.target_user_id, mappingError.message])
          )
        );
        setError("Correct the highlighted OIDC mapping errors before activating.");
      } else if (failureKind === "ambiguous") {
        setError("Activation may have completed, but the server response was not received. Reload this page to confirm the result.");
      } else {
        setError("The tested configuration could not be activated. Run the test again.");
      }
      setBusy(false);
      return;
    }

    clearAuthConfigCache();
    setFinalizationUnresolved(false);
    setTestedIdentity(null);
    setMappingReview({});
    sessionStorage.removeItem(OIDC_SETUP_FLOW_STORAGE_KEY);
    sessionStorage.removeItem(OIDC_REVIEWED_POLICY_STORAGE_KEY);
    sessionStorage.removeItem(OIDC_PENDING_FINALIZATION_STORAGE_KEY);
    setClientSecret("");
    setShowClientSecret(false);
    if (result.reauthentication_required) {
      localStorage.removeItem("access_token");
      navigate(loginPath(window.location.pathname + window.location.search), { replace: true });
      setBusy(false);
      return;
    }
    setNotice("Authentication configuration activated.");
    try {
      const refreshed = await primeCachedAsyncData(SETTINGS_DATA_CACHE_KEYS.adminAuthentication, loadAuthenticationSettingsData, true);
      setConfiguration(refreshed);
      if (refreshed.configuration) setCandidate(editableCandidate(refreshed.configuration));
    } catch {
      setError("Authentication was activated, but the current settings could not be reloaded. Reload this page to refresh them.");
    } finally {
      setBusy(false);
    }
  };

  const cancelTestFlow = async () => {
    if (finalizationUnresolved || !testedIdentity) return;
    setBusy(true);
    setError("");
    try {
      await api.cancelOidcTestFlow(testedIdentity.flow_id);
      sessionStorage.removeItem(OIDC_SETUP_FLOW_STORAGE_KEY);
      sessionStorage.removeItem(OIDC_REVIEWED_POLICY_STORAGE_KEY);
      setTestedIdentity(null);
      setMappingReview({});
      setMappingErrors({});
      setNotice("OIDC setup canceled.");
    } catch {
      setError("The OIDC setup flow could not be canceled. It may already have expired.");
    } finally {
      setBusy(false);
    }
  };

  const setPasswordOnly = async () => {
    if (finalizationUnresolved) return;
    const activeConfiguration = configuration?.configuration;
    if (!activeConfiguration) return;
    const passwordlessCount = configuration.active_passwordless_user_count;
    if (
      !window.confirm(
        `Switch to Password only and revoke all active sessions? ${passwordlessCount} active account${passwordlessCount === 1 ? "" : "s"} without a local password will lose sign-in access.`
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await api.setPasswordOnlyAuthentication(activeConfiguration.configuration_revision, passwordlessCount, passwordlessCount > 0);
      clearAuthConfigCache();
      setTestedIdentity(null);
      setClientSecret("");
      setShowClientSecret(false);
      localStorage.removeItem("access_token");
      navigate(loginPath(window.location.pathname + window.location.search), { replace: true });
    } catch (caught: unknown) {
      const errorCode = getApiErrorMessage(caught, "");
      if (errorCode === "oidc_configuration_changed" || errorCode === "passwordless_account_count_changed") {
        try {
          const refreshed = await primeCachedAsyncData(SETTINGS_DATA_CACHE_KEYS.adminAuthentication, loadAuthenticationSettingsData, true);
          setConfiguration(refreshed);
          if (refreshed.configuration) setCandidate(editableCandidate(refreshed.configuration));
          setError("Authentication settings changed. Review the current Password-only impact and confirm again.");
        } catch {
          setError("Authentication settings changed and could not be refreshed. Reload this page before trying again.");
        }
      } else if (errorCode === "passwordless_account_loss_not_acknowledged") {
        setError("Confirm that active accounts without local passwords will lose sign-in access.");
      } else {
        setError("Password-only mode requires an active administrator with a local password.");
      }
    } finally {
      setBusy(false);
    }
  };

  const activateNonOidcMode = async () => {
    if (finalizationUnresolved || isOidcMode) return;
    if (authMode === "password_only" && configuration?.configuration) {
      await setPasswordOnly();
      return;
    }
    if (authMode === "none" && !noAuthenticationAcknowledged) return;
    const confirmation =
      authMode === "none"
        ? "Activate No authentication and revoke all active sessions? Sambee will rely entirely on the reverse proxy or network perimeter."
        : "Activate Password-only mode and revoke all active sessions?";
    if (!window.confirm(confirmation)) return;
    setBusy(true);
    setError("");
    try {
      await api.activateAuthenticationMode(authMode, noAuthenticationAcknowledged);
      clearAuthConfigCache();
      localStorage.removeItem("access_token");
      navigate(loginPath(window.location.pathname + window.location.search), { replace: true });
    } catch (caught: unknown) {
      setError(getApiErrorMessage(caught, "Authentication mode could not be activated."));
      setBusy(false);
    }
  };

  return (
    <SettingsPage
      category="admin-authentication"
      description={
        <Trans
          i18nKey="settings.categories.adminAuthentication.descriptionWithGuide"
          components={{ guide: <Link href={OIDC_SETUP_GUIDE_URL} target="_blank" rel="noreferrer" /> }}
        />
      }
    >
      <Box sx={{ maxWidth: 820 }}>
        {busy && !configuration ? (
          <Box sx={{ display: "flex", justifyContent: "center", pt: 5 }}>
            <CircularProgress aria-label="Loading authentication settings" />
          </Box>
        ) : null}
        {!(busy && !configuration) && (
          <>
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
            {isOidcMode && configuration?.health.status === "unhealthy" && (
              <Alert severity="warning" sx={{ mb: 3 }}>
                {configuration.health.reasons.includes("public_url_missing")
                  ? "Set Sambee's externally reachable public URL in network settings."
                  : "Complete the required configuration before testing this provider."}
              </Alert>
            )}

            <Stack spacing={2.5}>
              <TextField
                select
                label="Authentication mode"
                value={authMode}
                onChange={(event) => {
                  const mode = event.target.value as AuthenticationMode;
                  setAuthMode(mode);
                  setNoAuthenticationAcknowledged(false);
                  if (mode === "oidc_or_password" || mode === "oidc_only") {
                    update("sign_in_mode", mode);
                    return;
                  }
                  ++previewRequestSequence.current;
                  setReviewPending(false);
                  setTestedIdentity(null);
                  setMappingReview({});
                  setMappingErrors({});
                  sessionStorage.removeItem(OIDC_SETUP_FLOW_STORAGE_KEY);
                  sessionStorage.removeItem(OIDC_REVIEWED_POLICY_STORAGE_KEY);
                }}
                disabled={finalizationUnresolved}
                helperText={
                  configuration?.auth_mode_source === "config_file"
                    ? "Currently inherited from the configuration file. Activating a mode here makes this page authoritative."
                    : undefined
                }
              >
                <MenuItem value="none">No authentication</MenuItem>
                <MenuItem value="password_only">Password only</MenuItem>
                <MenuItem value="oidc_or_password">OIDC or password</MenuItem>
                <MenuItem value="oidc_only">OIDC only</MenuItem>
              </TextField>

              {isOidcMode ? (
                <>
                  <Typography color="text.secondary">
                    {authMode === "oidc_only"
                      ? "Users are redirected to the identity provider when they sign in."
                      : "Users can sign in with the identity provider or a local password."}
                  </Typography>
                  <Typography variant="h6">Provider</Typography>
                  {configuration?.health.redirect_uri && (
                    <TextField
                      label="Redirect URI"
                      value={configuration.health.redirect_uri}
                      slotProps={{
                        input: {
                          readOnly: true,
                          endAdornment: (
                            <InputAdornment position="end">
                              <Tooltip title="Copy redirect URI">
                                <IconButton
                                  aria-label="Copy redirect URI"
                                  edge="end"
                                  onClick={() => {
                                    void navigator.clipboard
                                      .writeText(configuration.health.redirect_uri ?? "")
                                      .then(() => setNotice("Redirect URI copied."))
                                      .catch(() => setError("The redirect URI could not be copied."));
                                  }}
                                >
                                  <ContentCopy />
                                </IconButton>
                              </Tooltip>
                            </InputAdornment>
                          ),
                        },
                      }}
                    />
                  )}
                  <TextField
                    label="Provider name"
                    value={candidate.display_name}
                    onChange={(event) => update("display_name", event.target.value)}
                    disabled={finalizationUnresolved}
                    required
                  />
                  <TextField
                    label="Issuer URL"
                    value={candidate.issuer_url}
                    onChange={(event) => update("issuer_url", event.target.value)}
                    disabled={finalizationUnresolved}
                    required
                  />
                  <TextField
                    label="Client ID"
                    value={candidate.client_id}
                    onChange={(event) => update("client_id", event.target.value)}
                    disabled={finalizationUnresolved}
                    required
                  />
                  <TextField
                    label="Client secret"
                    type={showClientSecret ? "text" : "password"}
                    value={clientSecret}
                    disabled={finalizationUnresolved}
                    onChange={(event) => {
                      setClientSecret(event.target.value);
                      setTestedIdentity(null);
                    }}
                    helperText={
                      configuration?.configuration?.client_secret_configured
                        ? "Leave blank to keep the stored secret."
                        : "Required for the first test."
                    }
                    slotProps={{
                      input: {
                        endAdornment: (
                          <InputAdornment position="end">
                            <Tooltip title={showClientSecret ? "Hide client secret" : "Show client secret"}>
                              <IconButton
                                aria-label={showClientSecret ? "Hide client secret" : "Show client secret"}
                                edge="end"
                                onClick={() => setShowClientSecret((current) => !current)}
                                onMouseDown={(event) => event.preventDefault()}
                              >
                                {showClientSecret ? <VisibilityOff /> : <Visibility />}
                              </IconButton>
                            </Tooltip>
                          </InputAdornment>
                        ),
                      },
                    }}
                  />
                  <TextField
                    label="Scopes"
                    value={listValue(candidate.scopes)}
                    onChange={(event) => update("scopes", parseList(event.target.value))}
                    disabled={finalizationUnresolved}
                    helperText="Comma-separated; openid is required."
                  />

                  <Typography variant="h6">Access</Typography>
                  <TextField
                    select
                    label="Admission"
                    value={candidate.admission_mode}
                    onChange={(event) => update("admission_mode", event.target.value as OidcConfigurationCandidate["admission_mode"])}
                    disabled={finalizationUnresolved}
                  >
                    <MenuItem value="all_idp_users">All authenticated users</MenuItem>
                    <MenuItem value="selected_groups">Only selected groups</MenuItem>
                  </TextField>
                  {candidate.admission_mode === "selected_groups" && (
                    <TextField
                      label="Admission groups"
                      value={listValue(candidate.admission_groups)}
                      onChange={(event) => update("admission_groups", parseList(event.target.value))}
                      disabled={finalizationUnresolved}
                      error={Boolean(admissionGroupError)}
                      helperText={
                        admissionGroupError ||
                        "Only members of these identity-provider groups can sign in. Enter exact group names, separated by commas."
                      }
                    />
                  )}
                  <TextField
                    label="Administrator groups"
                    value={listValue(candidate.role_mappings.admin)}
                    onChange={(event) => update("role_mappings", { ...candidate.role_mappings, admin: parseList(event.target.value) })}
                    disabled={finalizationUnresolved}
                    error={Boolean(adminGroupError)}
                    helperText={
                      adminGroupError || "Members of these groups are Sambee administrators. Enter exact group names, separated by commas."
                    }
                    required
                  />
                  <TextField
                    label="Editor groups"
                    value={listValue(candidate.role_mappings.editor)}
                    onChange={(event) => update("role_mappings", { ...candidate.role_mappings, editor: parseList(event.target.value) })}
                    disabled={finalizationUnresolved}
                    error={Boolean(editorGroupError)}
                    helperText={
                      editorGroupError ||
                      "Members of these groups can edit content but cannot administer Sambee. Enter exact group names, separated by commas."
                    }
                  />
                  <Accordion disableGutters elevation={0} sx={{ "&::before": { display: "none" } }}>
                    <AccordionSummary
                      expandIcon={<ExpandMore />}
                      aria-controls="advanced-claims-content"
                      id="advanced-claims-header"
                      sx={{ px: 0 }}
                    >
                      <Box>
                        <Typography variant="h6">Advanced claims</Typography>
                        <Typography aria-hidden="true" color="text.secondary" variant="body2">
                          Optional claim names
                        </Typography>
                      </Box>
                    </AccordionSummary>
                    <AccordionDetails sx={{ px: 0 }}>
                      <Stack spacing={2}>
                        <Typography color="text.secondary">The default claim names work with most OpenID Connect providers.</Typography>
                        <TextField
                          label="Username claim"
                          value={candidate.username_claim}
                          onChange={(event) => update("username_claim", event.target.value)}
                          disabled={finalizationUnresolved}
                          required
                        />
                        <TextField
                          label="Name claim"
                          value={candidate.name_claim ?? ""}
                          onChange={(event) => update("name_claim", optionalClaim(event.target.value))}
                          disabled={finalizationUnresolved}
                        />
                        <TextField
                          label="Email claim"
                          value={candidate.email_claim ?? ""}
                          onChange={(event) => update("email_claim", optionalClaim(event.target.value))}
                          disabled={finalizationUnresolved}
                        />
                        <TextField
                          label="Groups claim"
                          value={candidate.groups_claim ?? ""}
                          onChange={(event) => update("groups_claim", optionalClaim(event.target.value))}
                          disabled={finalizationUnresolved}
                        />
                      </Stack>
                    </AccordionDetails>
                  </Accordion>
                  <Button
                    variant="contained"
                    sx={settingsPrimaryButtonSx}
                    disabled={busy || finalizationUnresolved || configuration?.health.status !== "healthy" || groupConfigurationInvalid}
                    onClick={() => void startTest()}
                  >
                    Connect and test
                  </Button>

                  {testedIdentity && (
                    <Box sx={{ borderLeft: 3, borderColor: "success.main", pl: 2, py: 1 }}>
                      <Typography variant="h6">Tested identity</Typography>
                      <Typography>Username: {testedIdentity.username}</Typography>
                      {testedIdentity.email && <Typography>Email: {testedIdentity.email}</Typography>}
                      <Typography>Groups: {testedIdentity.groups.join(", ") || "None"}</Typography>
                      <Typography>Admission: {testedIdentity.admitted ? "Allowed" : "Denied"}</Typography>
                      {testedIdentity.matching_admission_group && (
                        <Typography>Matching admission group: {testedIdentity.matching_admission_group}</Typography>
                      )}
                      <Typography>Resulting role: {testedIdentity.resulting_role ?? "None"}</Typography>
                      <Typography color="text.secondary">Account mapping does not override the admission policy.</Typography>
                      {!testedIdentityCanAdminister && (
                        <Alert severity="error" sx={{ mt: 1 }}>
                          The tested identity must be admitted as an administrator before this configuration can be activated.
                        </Alert>
                      )}
                      {testedIdentity.replacement_mappings.length > 0 && (
                        <Stack spacing={2} sx={{ mt: 2 }}>
                          <Typography variant="subtitle1">Review existing accounts</Typography>
                          {omittedPasswordlessMappings.length > 0 && (
                            <Alert severity="warning">
                              {omittedPasswordlessMappings.length} active passwordless account
                              {omittedPasswordlessMappings.length === 1 ? " is" : "s are"} omitted. These users cannot sign in until mapped.
                              An unmapped OIDC login may collide with an existing username or create a separate account.
                            </Alert>
                          )}
                          {testedIdentity.replacement_mappings
                            .filter((mapping) => mapping.selectable)
                            .map((mapping) => {
                              const review = mappingReview[mapping.target_user_id];
                              const serverError = mappingErrors[mapping.target_user_id];
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
                                        disabled={finalizationUnresolved}
                                        onChange={(event) => {
                                          if (!event.target.checked) {
                                            setMappingErrors((current) => {
                                              const next = { ...current };
                                              delete next[mapping.target_user_id];
                                              return next;
                                            });
                                          }
                                          setMappingReview((current) => ({
                                            ...current,
                                            [mapping.target_user_id]: {
                                              ...(current[mapping.target_user_id] ?? {
                                                selected: false,
                                                expectedUsername: "",
                                                omissionAcknowledged: false,
                                              }),
                                              selected: event.target.checked,
                                              expectedUsername:
                                                event.target.checked && !current[mapping.target_user_id]?.expectedUsername
                                                  ? mapping.suggested_username
                                                  : (current[mapping.target_user_id]?.expectedUsername ?? ""),
                                              omissionAcknowledged: false,
                                            },
                                          }));
                                        }}
                                      />
                                    }
                                    label={`Map ${mapping.local_username}`}
                                  />
                                  <TextField
                                    fullWidth
                                    label={`Provider username for ${mapping.local_username}`}
                                    value={expectedUsername}
                                    placeholder={mapping.suggested_username}
                                    helperText={serverError ?? `${hintLabel}: ${mapping.suggested_username}`}
                                    disabled={finalizationUnresolved || !review?.selected}
                                    error={
                                      Boolean(serverError) ||
                                      (Boolean(review?.selected) &&
                                        (!expectedUsername.trim() ||
                                          expectedUsername.trim() === testedIdentity.username.trim() ||
                                          replacementUsernames.filter((value) => value === expectedUsername.trim()).length > 1))
                                    }
                                    onChange={(event) => {
                                      setMappingErrors((current) => {
                                        const next = { ...current };
                                        delete next[mapping.target_user_id];
                                        return next;
                                      });
                                      setMappingReview((current) => ({
                                        ...current,
                                        [mapping.target_user_id]: {
                                          ...(current[mapping.target_user_id] ?? {
                                            selected: false,
                                            expectedUsername: "",
                                            omissionAcknowledged: false,
                                          }),
                                          expectedUsername: event.target.value,
                                        },
                                      }));
                                    }}
                                    required={review?.selected}
                                  />
                                  {mapping.omission_acknowledgement_required && !review?.selected && (
                                    <FormControlLabel
                                      control={
                                        <Checkbox
                                          checked={review?.omissionAcknowledged ?? false}
                                          disabled={finalizationUnresolved}
                                          onChange={(event) =>
                                            setMappingReview((current) => ({
                                              ...current,
                                              [mapping.target_user_id]: {
                                                ...(current[mapping.target_user_id] ?? {
                                                  selected: false,
                                                  expectedUsername: "",
                                                  omissionAcknowledged: false,
                                                }),
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
                      <Button
                        variant="contained"
                        sx={{ mt: 2 }}
                        disabled={busy || finalizationUnresolved || reviewPending || replacementPlanInvalid || !testedIdentityCanAdminister}
                        onClick={activate}
                      >
                        Activate configuration
                      </Button>
                      <Button
                        variant="text"
                        sx={{ mt: 2, ml: 1 }}
                        disabled={busy || finalizationUnresolved}
                        onClick={() => void cancelTestFlow()}
                      >
                        Cancel
                      </Button>
                    </Box>
                  )}

                  {configuration?.configuration && (
                    <>
                      <Typography variant="h6">Recovery</Typography>
                      <Button
                        variant="outlined"
                        disabled={busy || finalizationUnresolved || configuration.health.status !== "healthy"}
                        onClick={() => {
                          if (
                            window.confirm(
                              "Remap all OIDC accounts? Current OIDC links will be removed, affected users signed out, and local users and data preserved."
                            )
                          ) {
                            void startTest(true);
                          }
                        }}
                      >
                        Remap all OIDC accounts
                      </Button>
                    </>
                  )}
                </>
              ) : (
                <Stack spacing={2}>
                  {authMode === "none" ? (
                    <>
                      <Alert severity="warning">
                        Sambee will not authenticate users. Only activate this mode when a trusted reverse proxy or network perimeter
                        controls access.
                      </Alert>
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={noAuthenticationAcknowledged}
                            disabled={finalizationUnresolved}
                            onChange={(event) => setNoAuthenticationAcknowledged(event.target.checked)}
                          />
                        }
                        label="I understand that Sambee will rely on external systems for authentication."
                      />
                    </>
                  ) : (
                    <Alert severity="warning">
                      {configuration?.active_passwordless_user_count
                        ? `${configuration.active_passwordless_user_count} active account${configuration.active_passwordless_user_count === 1 ? "" : "s"} without a local password will lose sign-in access.`
                        : "Only local username and password sign-in will be available."}
                    </Alert>
                  )}
                  <Button
                    color={authMode === "none" ? "warning" : "primary"}
                    variant="contained"
                    sx={{ alignSelf: "flex-start" }}
                    disabled={busy || finalizationUnresolved || (authMode === "none" && !noAuthenticationAcknowledged)}
                    onClick={() => void activateNonOidcMode()}
                  >
                    {authMode === "none" ? "Activate No authentication" : "Activate Password-only mode"}
                  </Button>
                </Stack>
              )}
            </Stack>
          </>
        )}
      </Box>
    </SettingsPage>
  );
}
