import json

import pytest
from pydantic import ValidationError
from sqlalchemy.engine import Engine
from sqlmodel import Session, select

from app.models.audit import AuditEvent
from app.services.audit import (
    AuditDetails,
    AuditEventName,
    AuditResult,
    diagnostic_subject_hash,
    write_audit_event,
)


def test_audit_details_reject_arbitrary_or_raw_subject_fields() -> None:
    with pytest.raises(ValidationError):
        AuditDetails.model_validate({"subject": "raw-provider-subject"})

    with pytest.raises(ValidationError):
        AuditDetails.model_validate({"provider_payload": {"secret": "value"}})


def test_subject_hash_is_stable_and_issuer_qualified() -> None:
    first = diagnostic_subject_hash("https://one.example", "subject")
    assert first == diagnostic_subject_hash("https://one.example", "subject")
    assert first != diagnostic_subject_hash("https://two.example", "subject")
    assert "subject" not in first


def test_audit_writer_uses_caller_owned_transaction(engine: Engine) -> None:
    with Session(engine) as session:
        event = write_audit_event(
            session,
            event_name=AuditEventName.LOGIN_FAILED,
            result=AuditResult.FAILED,
            details=AuditDetails(failure_category="invalid_id_token"),
            correlation_id="request-id",
        )
        event_id = event.id
        session.flush()
        session.rollback()

    with Session(engine) as session:
        assert session.get(AuditEvent, event_id) is None


def test_audit_writer_serializes_only_present_safe_details(engine: Engine) -> None:
    with Session(engine) as session:
        event = write_audit_event(
            session,
            event_name=AuditEventName.CONFIG_UPDATED,
            result=AuditResult.SUCCEEDED,
            details=AuditDetails(changed_fields=("display_name", "sign_in_mode")),
        )
        session.commit()
        stored = session.exec(select(AuditEvent).where(AuditEvent.id == event.id)).one()

    assert json.loads(stored.safe_details_json) == {"changed_fields": ["display_name", "sign_in_mode"]}
