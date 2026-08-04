import uuid
from datetime import datetime
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, SecretStr
from sqlmodel import Field, SQLModel

from app.core.auth_methods import AuthenticationMode
from app.models.oidc import OidcAdmissionMode, OidcRoleAssignmentMode, SignInMode
from app.models.user import UserRole


class AuthenticationHealthStatus(StrEnum):
    HEALTHY = "healthy"
    UNHEALTHY = "unhealthy"


class AuthenticationHealthReason(StrEnum):
    OIDC_SECRET_DECRYPTION_FAILED = "oidc_secret_decryption_failed"
    PUBLIC_URL_MISSING = "public_url_missing"
    PUBLIC_URL_INVALID = "public_url_invalid"
    NO_ACTIVE_ADMINISTRATOR = "no_active_administrator"


class PublicOidcConfiguration(SQLModel):
    display_name: str = Field(min_length=1, max_length=200)
    authorization_path: str = Field(default="/api/auth/oidc/authorize")


class PublicAuthConfiguration(SQLModel):
    sign_in_mode: AuthenticationMode
    oidc: PublicOidcConfiguration | None = None


class AuthenticationHealth(SQLModel):
    public_url_configured: bool
    public_url: str | None
    redirect_uri: str | None
    status: AuthenticationHealthStatus
    reasons: list[AuthenticationHealthReason]


class OidcRoleMappings(SQLModel):
    admin: list[str] = Field(default_factory=list, max_length=500)
    editor: list[str] = Field(default_factory=list, max_length=500)
    viewer: list[str] = Field(default_factory=list, max_length=500)


class OidcConfigurationCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    display_name: str = Field(default="", max_length=200)
    issuer_url: str = Field(min_length=1, max_length=2048)
    client_id: str = Field(min_length=1, max_length=500)
    client_secret: SecretStr | None = Field(default=None, exclude=True, repr=False)
    scopes: list[str] = Field(default_factory=lambda: ["openid", "profile", "email", "offline_access"], max_length=100)
    username_claim: str = Field(default="preferred_username", min_length=1, max_length=200)
    name_claim: str | None = Field(default="name", max_length=200)
    email_claim: str | None = Field(default="email", max_length=200)
    groups_claim: str | None = Field(default="groups", max_length=200)
    sign_in_mode: SignInMode = SignInMode.PASSWORD_ONLY
    interactive_reauthentication_max_age_days: int = Field(default=30, ge=1, le=365)
    admission_mode: OidcAdmissionMode = OidcAdmissionMode.ALL_IDP_USERS
    admission_groups: list[str] = Field(default_factory=list, max_length=500)
    role_assignment_mode: OidcRoleAssignmentMode = OidcRoleAssignmentMode.UNIFORM
    uniform_role: UserRole = UserRole.EDITOR
    role_mappings: OidcRoleMappings = Field(default_factory=OidcRoleMappings)


class RedactedOidcConfiguration(SQLModel):
    display_name: str
    issuer_url: str
    client_id: str
    client_secret_configured: bool
    scopes: list[str]
    username_claim: str
    name_claim: str | None
    email_claim: str | None
    groups_claim: str | None
    sign_in_mode: SignInMode
    interactive_reauthentication_max_age_days: int
    admission_mode: OidcAdmissionMode
    admission_groups: list[str]
    role_assignment_mode: OidcRoleAssignmentMode
    uniform_role: UserRole
    role_mappings: OidcRoleMappings
    configuration_revision: int
    identity_mapping_revision: int


class OidcGrantExchangeRequest(SQLModel):
    grant: str = Field(min_length=32, max_length=500)


class OidcBrowserSessionRead(SQLModel):
    id: uuid.UUID
    status: str
    created_at: datetime
    authenticated_at: datetime
    last_seen_at: datetime | None
    last_refreshed_at: datetime | None
    current: bool


class OidcBrowserSessionListRead(SQLModel):
    sessions: list[OidcBrowserSessionRead]


class OidcBrowserSessionRevokeRead(SQLModel):
    revoked_count: int


class OidcSessionCipherKeyRotationRead(SQLModel):
    active_key_id: str


class OidcAdminConfigurationRead(SQLModel):
    configuration: RedactedOidcConfiguration | None
    health: AuthenticationHealth
    active_passwordless_user_count: int
    auth_mode: AuthenticationMode
    auth_enforcement_disabled: bool


class AuthenticationModeActivationRequest(SQLModel):
    mode: AuthenticationMode
    acknowledge_no_authentication: bool = False


class AuthenticationModeActivationResponse(SQLModel):
    auth_mode: AuthenticationMode
    reauthentication_required: bool


class OidcTestStartResponse(SQLModel):
    flow_id: uuid.UUID
    authorization_url: str


class OidcReplacementMappingRead(SQLModel):
    target_user_id: uuid.UUID
    local_username: str
    local_role: UserRole
    has_local_password: bool
    target_state: Literal["active", "inactive", "expired"]
    mapping_state: Literal["unmapped", "pending", "established"]
    suggested_username: str
    prefill_source: Literal["pending", "last_seen", "local"]
    selected_by_default: bool
    selectable: bool
    omission_acknowledgement_required: bool


class OidcReplacementMappingInput(SQLModel):
    target_user_id: uuid.UUID
    expected_username: str = Field(min_length=1)


class OidcReviewedPolicy(SQLModel):
    sign_in_mode: SignInMode
    interactive_reauthentication_max_age_days: int = Field(default=30, ge=1, le=365)
    admission_mode: OidcAdmissionMode
    admission_groups: list[str] = Field(default_factory=list, max_length=500)
    role_assignment_mode: OidcRoleAssignmentMode = OidcRoleAssignmentMode.UNIFORM
    uniform_role: UserRole = UserRole.EDITOR
    role_mappings: OidcRoleMappings = Field(default_factory=OidcRoleMappings)


class OidcTestPreviewRequest(SQLModel):
    reviewed_policy: OidcReviewedPolicy | None = None


class OidcTestedIdentityRead(SQLModel):
    flow_id: uuid.UUID
    candidate: RedactedOidcConfiguration
    replacement_mappings: list[OidcReplacementMappingRead]
    expected_identity_mapping_revision: int | None
    username: str
    name: str | None
    email: str | None
    groups: list[str]
    admitted: bool
    matching_admission_group: str | None
    affected_account_count: int
    acting_administrator_affected: bool
    expires_at: datetime


class OidcFinalizeRequest(SQLModel):
    flow_id: uuid.UUID
    reviewed_policy: OidcReviewedPolicy
    replacement_mappings: list[OidcReplacementMappingInput] = Field(default_factory=list)
    expected_identity_mapping_revision: int | None = None
    omitted_account_acknowledgements: list[uuid.UUID] = Field(default_factory=list)


class OidcPendingMappingBatchRequest(SQLModel):
    expected_identity_mapping_revision: int
    mappings: list[OidcReplacementMappingInput]


class OidcMappingMutationRequest(SQLModel):
    expected_identity_mapping_revision: int


class OidcMappingChangeRequest(OidcMappingMutationRequest):
    expected_username: str = Field(min_length=1)


class OidcIdentityMoveRequest(OidcMappingMutationRequest):
    target_user_id: uuid.UUID


class OidcMappingMutationResponse(SQLModel):
    identity_mapping_revision: int
    pending_mappings: list["OidcPendingMappingRead"]


class OidcPendingMappingRead(SQLModel):
    target_user_id: uuid.UUID
    expected_username: str
    created_at: datetime


class PasswordOnlyActivationRequest(SQLModel):
    expected_configuration_revision: int
    expected_active_passwordless_user_count: int = Field(ge=0)
    acknowledge_passwordless_account_loss: bool


class OidcFinalizeResponse(SQLModel):
    configuration_revision: int
    identity_mapping_revision: int
    reauthentication_required: bool
