"""Contract coverage tests for scoped archive relay routes."""

import json
import re
from pathlib import Path
from typing import Any

import yaml
from fastapi.routing import APIRoute

from app.api.archive_operations import router
from app.models.archive_operation import (
    ArchiveCompanionCreationMemberCompletion,
    ArchiveCompanionCreationSummary,
    ArchiveCompanionExtractionCollision,
    ArchiveCompanionExtractionMemberCompletion,
    ArchiveCompanionExtractionMemberError,
    ArchiveCompanionExtractionSummary,
    ArchiveCompanionFailure,
)
from app.services.archive.execution import ArchiveCompanionRelayPurpose

WORKSPACE_ROOT = Path(__file__).resolve().parents[2]
ARCHIVE_CONTRACT_PATH = WORKSPACE_ROOT / "archive-contract" / "v1" / "openapi.yaml"
RELAY_BINDINGS_PATH = WORKSPACE_ROOT / "archive-contract" / "v1" / "relay-bindings-v1.json"
RELAY_CONTROL_PAYLOADS_PATH = WORKSPACE_ROOT / "archive-contract" / "v1" / "relay-control-payloads-v1.json"
COMPANION_RELAY_BINDING_PATH = WORKSPACE_ROOT / "companion" / "src-tauri" / "src" / "server" / "handlers.rs"
ARCHIVE_API_PREFIX = "/api/archive"
CANONICAL_RELAY_PATH_SEGMENT = "/companion-relay/"
HTTP_OPERATION_METHODS = frozenset({"get", "post", "put"})


def _documented_relay_operations(contract: dict[str, Any]) -> set[tuple[str, str]]:
    paths = contract["paths"]
    assert isinstance(paths, dict)
    return {
        (method.upper(), path.replace("{operationId}", "{operation_id}"))
        for path, path_item in paths.items()
        if isinstance(path, str) and CANONICAL_RELAY_PATH_SEGMENT in path and isinstance(path_item, dict)
        for method in path_item
        if method in HTTP_OPERATION_METHODS
    }


def _registered_relay_operations() -> set[tuple[str, str]]:
    return {
        (method, f"{ARCHIVE_API_PREFIX}{route.path}")
        for route in router.routes
        if isinstance(route, APIRoute) and CANONICAL_RELAY_PATH_SEGMENT in route.path
        for method in route.methods or set()
        if method.lower() in HTTP_OPERATION_METHODS
    }


def _documented_relay_purposes(contract: dict[str, Any]) -> set[str]:
    paths = contract["paths"]
    assert isinstance(paths, dict)
    return {
        path.split(CANONICAL_RELAY_PATH_SEGMENT, maxsplit=1)[1].split("/", maxsplit=1)[0]
        for path in paths
        if isinstance(path, str) and CANONICAL_RELAY_PATH_SEGMENT in path
    }


def _companion_relay_purposes() -> set[str]:
    source = COMPANION_RELAY_BINDING_PATH.read_text(encoding="utf-8")
    binding_implementation = re.search(
        r"impl ArchiveRelayBinding \{(?P<body>.*?)\n\}\n\nimpl ArchiveRelayTransport",
        source,
        flags=re.DOTALL,
    )
    assert binding_implementation is not None
    return set(re.findall(r'Self::\w+ => "([a-z_]+)"', binding_implementation.group("body")))


def _v1_relay_bindings() -> set[tuple[str, str, str, str]]:
    with RELAY_BINDINGS_PATH.open(encoding="utf-8") as bindings_file:
        fixture = json.load(bindings_file)

    assert fixture["version"] == 1
    bindings = fixture["bindings"]
    assert isinstance(bindings, list)
    assert all(
        isinstance(binding, dict)
        and isinstance(binding.get("purpose"), str)
        and isinstance(binding.get("kind"), str)
        and isinstance(binding.get("source"), str)
        and isinstance(binding.get("destination"), str)
        for binding in bindings
    )
    return {(binding["purpose"], binding["kind"], binding["source"], binding["destination"]) for binding in bindings}


def _v1_relay_control_payloads() -> list[dict[str, Any]]:
    with RELAY_CONTROL_PAYLOADS_PATH.open(encoding="utf-8") as payloads_file:
        fixture = json.load(payloads_file)

    assert fixture["version"] == 1
    payloads = fixture["payloads"]
    assert isinstance(payloads, list)
    assert all(
        isinstance(payload, dict)
        and isinstance(payload.get("name"), str)
        and isinstance(payload.get("schema"), str)
        and isinstance(payload.get("required"), list)
        and all(isinstance(name, str) for name in payload["required"])
        and isinstance(payload.get("example"), dict)
        for payload in payloads
    )
    return payloads


def test_archive_contract_covers_canonical_relay_routes() -> None:
    """Keep the versioned relay contract aligned with the effective backend API."""

    with ARCHIVE_CONTRACT_PATH.open(encoding="utf-8") as contract_file:
        contract = yaml.safe_load(contract_file)

    assert isinstance(contract, dict)
    assert contract["openapi"] == "3.1.0"
    assert _documented_relay_operations(contract) == _registered_relay_operations()


def test_archive_contract_covers_backend_and_companion_relay_purposes() -> None:
    """Keep each hand-written purpose binding aligned with the versioned contract."""

    with ARCHIVE_CONTRACT_PATH.open(encoding="utf-8") as contract_file:
        contract = yaml.safe_load(contract_file)

    assert isinstance(contract, dict)
    documented_purposes = _documented_relay_purposes(contract)
    assert documented_purposes == {purpose.value for purpose in ArchiveCompanionRelayPurpose}
    assert documented_purposes == _companion_relay_purposes()


def test_v1_relay_binding_fixture_covers_backend_contract_and_companion() -> None:
    """Keep relay direction metadata synchronized without duplicating it in endpoint tests."""

    bindings = _v1_relay_bindings()
    assert bindings == {
        (
            purpose.value,
            purpose.kind.value,
            "local" if purpose.source_is_local else "smb",
            "local" if purpose.destination_is_local else "smb",
        )
        for purpose in ArchiveCompanionRelayPurpose
    }
    assert {purpose for purpose, _kind, _source, _destination in bindings} == _documented_relay_purposes(
        yaml.safe_load(ARCHIVE_CONTRACT_PATH.read_text(encoding="utf-8"))
    )
    assert {purpose for purpose, _kind, _source, _destination in bindings} == _companion_relay_purposes()


def test_v1_relay_control_payload_fixture_matches_contract_and_backend_models() -> None:
    """Keep hand-written control payloads aligned with their versioned contract schemas."""

    contract = yaml.safe_load(ARCHIVE_CONTRACT_PATH.read_text(encoding="utf-8"))
    assert isinstance(contract, dict)
    schemas = contract["components"]["schemas"]
    models = {
        "ArchiveExtractionMemberCompletion": ArchiveCompanionExtractionMemberCompletion,
        "ArchiveExtractionCollision": ArchiveCompanionExtractionCollision,
        "ArchiveExtractionMemberError": ArchiveCompanionExtractionMemberError,
        "ArchiveExtractionSummary": ArchiveCompanionExtractionSummary,
        "ArchiveCreationMemberCompletion": ArchiveCompanionCreationMemberCompletion,
        "ArchiveCreationSummary": ArchiveCompanionCreationSummary,
        "ArchiveFailure": ArchiveCompanionFailure,
    }

    for payload in _v1_relay_control_payloads():
        schema = schemas[payload["schema"]]
        assert schema["required"] == payload["required"]
        assert set(payload["example"]).issubset(schema["properties"])
        assert models[payload["schema"]].model_validate(payload["example"]).model_dump(mode="json") == payload["example"]


def test_archive_contract_defines_normalized_v1_extraction_outcomes() -> None:
    """Keep the common result vocabulary explicit beyond compact relay payloads."""

    with ARCHIVE_CONTRACT_PATH.open(encoding="utf-8") as contract_file:
        contract = yaml.safe_load(contract_file)

    schemas = contract["components"]["schemas"]
    result = schemas["ArchiveExtractionMemberResultV1"]
    assert result["required"] == [
        "member_path",
        "status",
        "target_path",
        "directories_created",
        "extracted_bytes",
        "replaced",
        "renamed",
    ]
    assert result["properties"]["status"]["enum"] == ["directory", "extracted", "skipped", "ignored"]
    compact_completion = schemas["ArchiveExtractionMemberCompletion"]
    assert compact_completion["required"] == [
        "member_path",
        "status",
        "target_path",
        "directories_created",
        "extracted_bytes",
        "replaced",
        "renamed",
    ]
    assert schemas["ArchiveExtractionSummary"]["required"] == ["destination_root_created"]
    assert schemas["ArchiveExtractionProgressV1"]["required"] == [
        "files_extracted",
        "directories_created",
        "extracted_bytes",
        "files_skipped",
        "files_replaced",
        "files_failed",
        "partial_members",
    ]
    assert schemas["ArchiveExtractionMemberErrorV1"]["allOf"][0]["$ref"] == ("#/components/schemas/ArchiveExtractionPartialMemberV1")


def test_archive_contract_defines_normalized_v1_creation_outcomes() -> None:
    """Keep creation result and progress vocabulary explicit beyond relay payloads."""

    with ARCHIVE_CONTRACT_PATH.open(encoding="utf-8") as contract_file:
        contract = yaml.safe_load(contract_file)

    schemas = contract["components"]["schemas"]
    result = schemas["ArchiveCreationMemberResultV1"]
    assert result["required"] == ["archive_path", "status", "source_bytes"]
    assert result["properties"]["status"]["enum"] == ["directory", "created"]
    assert schemas["ArchiveCreationProgressV1"]["required"] == ["files_created", "directories_created", "source_bytes"]
    assert schemas["ArchiveCreationMemberCompletion"]["required"] == result["required"]
    assert schemas["ArchiveCreationSummary"]["required"] == schemas["ArchiveCreationProgressV1"]["required"]
    assert schemas["ArchiveCreationSourceManifestEntry"]["required"] == ["archive_path", "is_directory", "source_size"]
    assert (
        contract["paths"]["/api/archive/operations/{operationId}/companion-relay/local_to_smb_zip_create/begin"]["post"]["requestBody"][
            "content"
        ]["application/json"]["schema"]["$ref"]
        == "#/components/schemas/ArchiveCreationSourceManifest"
    )
    assert (
        contract["paths"]["/api/archive/operations/{operationId}/companion-relay/local_to_smb_zip_create/member"]["put"]["parameters"][1][
            "$ref"
        ]
        == "#/components/parameters/ArchivePath"
    )
