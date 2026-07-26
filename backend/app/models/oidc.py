import uuid
from datetime import datetime, timezone
from enum import StrEnum

from sqlalchemy import CheckConstraint, Column, UniqueConstraint
from sqlalchemy import Enum as SqlEnum
from sqlmodel import Field, SQLModel


class SignInMode(StrEnum):
    PASSWORD_ONLY = "password_only"
    OIDC_OR_PASSWORD = "oidc_or_password"
    OIDC_ONLY = "oidc_only"


class OidcAdmissionMode(StrEnum):
    SELECTED_GROUPS = "selected_groups"
    ALL_IDP_USERS = "all_idp_users"


class OidcFlowPurpose(StrEnum):
    LOGIN = "login"
    TEST = "test"


class OidcFlowIntent(StrEnum):
    CONFIGURE = "configure"
    REPLACE_IDENTITY_NAMESPACE = "replace_identity_namespace"


class OidcFlowStatus(StrEnum):
    STARTED = "started"
    CALLBACK_PROCESSING = "callback_processing"
    CALLBACK_VALIDATED = "callback_validated"
    FINALIZING = "finalizing"
    CONSUMED = "consumed"


def _enum_column(enum_type: type[StrEnum], default: StrEnum | None = None) -> Column:  # type: ignore[type-arg]
    return Column(
        SqlEnum(
            enum_type,
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
            native_enum=False,
            validate_strings=True,
        ),
        nullable=False,
        default=default,
    )


class OidcProviderConfiguration(SQLModel, table=True):
    __table_args__ = (CheckConstraint("id = 1", name="ck_oidc_provider_configuration_singleton"),)

    id: int = Field(default=1, primary_key=True)
    sign_in_mode: SignInMode = Field(
        default=SignInMode.PASSWORD_ONLY,
        sa_column=_enum_column(SignInMode, SignInMode.PASSWORD_ONLY),
    )
    display_name: str
    issuer_url: str
    client_id: str
    encrypted_client_secret: str | None = Field(default=None)
    scopes_json: str = Field(default='["openid","profile","email","groups"]')
    username_claim: str = Field(default="preferred_username")
    username_claim_uniqueness_confirmed: bool = Field(default=False)
    name_claim: str | None = Field(default="name")
    email_claim: str | None = Field(default="email")
    groups_claim: str | None = Field(default="groups")
    admission_mode: OidcAdmissionMode = Field(
        default=OidcAdmissionMode.SELECTED_GROUPS,
        sa_column=_enum_column(OidcAdmissionMode, OidcAdmissionMode.SELECTED_GROUPS),
    )
    admission_groups_json: str = Field(default="[]")
    role_mappings_json: str = Field(default='{"admin":[],"editor":[]}')
    configuration_revision: int = Field(default=0)
    identity_mapping_revision: int = Field(default=0)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_by_user_id: uuid.UUID | None = Field(default=None, foreign_key="user.id", index=True)


class OidcIdentity(SQLModel, table=True):
    __table_args__ = (
        UniqueConstraint("issuer", "subject", name="uq_oidc_identity_issuer_subject"),
        UniqueConstraint("user_id", "issuer", name="uq_oidc_identity_user_issuer"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: uuid.UUID = Field(foreign_key="user.id", index=True)
    issuer: str
    subject: str
    last_seen_username: str | None = Field(default=None)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    last_login_at: datetime | None = Field(default=None)


class OidcPendingIdentityMapping(SQLModel, table=True):
    __table_args__ = (
        UniqueConstraint(
            "provider_configuration_id",
            "expected_username",
            name="uq_oidc_pending_provider_username",
        ),
        UniqueConstraint(
            "provider_configuration_id",
            "target_user_id",
            name="uq_oidc_pending_provider_target",
        ),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    provider_configuration_id: int = Field(foreign_key="oidcproviderconfiguration.id", index=True)
    expected_username: str
    target_user_id: uuid.UUID = Field(foreign_key="user.id", index=True)
    created_by_user_id: uuid.UUID | None = Field(default=None, foreign_key="user.id", index=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class OidcFlow(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    purpose: OidcFlowPurpose = Field(sa_column=_enum_column(OidcFlowPurpose))
    intent: OidcFlowIntent | None = Field(default=None)
    status: OidcFlowStatus = Field(
        default=OidcFlowStatus.STARTED,
        sa_column=_enum_column(OidcFlowStatus, OidcFlowStatus.STARTED),
    )
    state_hash: str | None = Field(default=None, index=True)
    grant_hash: str | None = Field(default=None, index=True)
    encrypted_verifier: str | None = Field(default=None)
    encrypted_nonce: str | None = Field(default=None)
    initiating_admin_id: uuid.UUID | None = Field(default=None, foreign_key="user.id", index=True)
    user_id: uuid.UUID | None = Field(default=None, foreign_key="user.id", index=True)
    user_token_version: int | None = Field(default=None)
    encrypted_candidate_configuration: str | None = Field(default=None)
    encrypted_tested_identity: str | None = Field(default=None)
    configuration_revision: int | None = Field(default=None)
    return_path: str = Field(default="/browse")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    expires_at: datetime
    grant_expires_at: datetime | None = Field(default=None)
    finalized_at: datetime | None = Field(default=None)
    finalized_configuration_revision: int | None = Field(default=None)
    finalized_identity_mapping_revision: int | None = Field(default=None)
    finalized_reauthentication_required: bool | None = Field(default=None)
