"""Contract coverage tests for scoped archive relay routes."""

import json
import re
from pathlib import Path
from typing import Any

import yaml
from fastapi.routing import APIRoute

from app.api.archive_operations import router
from app.api.browser import router as browser_router
from app.api.viewer import router as viewer_router
from app.models.archive_operation import (
    ArchiveCompanionCreationMemberCompletion,
    ArchiveCompanionCreationSummary,
    ArchiveCompanionExtractionCollision,
    ArchiveCompanionExtractionMemberCompletion,
    ArchiveCompanionExtractionMemberError,
    ArchiveCompanionExtractionSourceManifest,
    ArchiveCompanionExtractionSummary,
    ArchiveCompanionFailure,
    ArchiveOperationKind,
)
from app.services.archive.execution import ArchiveCompanionRelayPurpose, resolve_archive_execution_topology

WORKSPACE_ROOT = Path(__file__).resolve().parents[2]
ARCHIVE_CONTRACT_PATH = WORKSPACE_ROOT / "archive-contract" / "v1" / "openapi.yaml"
RELAY_BINDINGS_PATH = WORKSPACE_ROOT / "archive-contract" / "v1" / "relay-bindings-v1.json"
RELAY_CONTROL_PAYLOADS_PATH = WORKSPACE_ROOT / "archive-contract" / "v1" / "relay-control-payloads-v1.json"
TOPOLOGY_OPERATION_MATRIX_PATH = WORKSPACE_ROOT / "archive-contract" / "v1" / "topology-operation-compatibility-matrix-v1.json"
COMPANION_ARCHIVE_ROUTE_BINDINGS_PATH = WORKSPACE_ROOT / "archive-contract" / "v1" / "companion-archive-route-bindings-v1.json"
COMPATIBILITY_READERS_PATH = WORKSPACE_ROOT / "archive-contract" / "v1" / "compatibility-readers-v1.json"
COMPANION_RELAY_BINDING_PATH = WORKSPACE_ROOT / "companion" / "src-tauri" / "src" / "server" / "handlers.rs"
COMPANION_ROUTER_PATH = WORKSPACE_ROOT / "companion" / "src-tauri" / "src" / "server" / "mod.rs"
ARCHIVE_API_PREFIX = "/api/archive"
CANONICAL_RELAY_PATH_SEGMENT = "/companion-relay/"
HTTP_OPERATION_METHODS = frozenset({"get", "post", "put", "delete"})


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


def _documented_backend_operations(contract: dict[str, Any]) -> set[tuple[str, str]]:
    paths = contract["paths"]
    assert isinstance(paths, dict)
    return {
        (method.upper(), path.replace("{operationId}", "{operation_id}"))
        for path, path_item in paths.items()
        if isinstance(path, str) and path.startswith(ARCHIVE_API_PREFIX) and isinstance(path_item, dict)
        for method in path_item
        if method in HTTP_OPERATION_METHODS
    }


def _registered_backend_operations() -> set[tuple[str, str]]:
    return {
        (method, f"{ARCHIVE_API_PREFIX}{route.path}")
        for route in router.routes
        if isinstance(route, APIRoute)
        for method in route.methods or set()
        if method.lower() in HTTP_OPERATION_METHODS
    }


def _registered_backend_inspection_operations() -> set[tuple[str, str]]:
    browser_routes = {
        (method, f"/api/browse{route.path}")
        for route in browser_router.routes
        if isinstance(route, APIRoute) and "/archive/" in route.path
        for method in route.methods or set()
        if method.lower() in HTTP_OPERATION_METHODS
    }
    viewer_routes = {
        (method, f"/api/viewer{route.path}")
        for route in viewer_router.routes
        if isinstance(route, APIRoute) and "/archive/" in route.path
        for method in route.methods or set()
        if method.lower() in HTTP_OPERATION_METHODS
    }
    return browser_routes | viewer_routes


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


def _v1_companion_archive_route_bindings() -> list[dict[str, str | None]]:
    fixture = json.loads(COMPANION_ARCHIVE_ROUTE_BINDINGS_PATH.read_text(encoding="utf-8"))
    assert fixture["version"] == 1
    routes = fixture["routes"]
    assert isinstance(routes, list)
    assert all(
        isinstance(route, dict)
        and route.get("method") in {"GET", "POST", "PUT", "DELETE"}
        and isinstance(route.get("path"), str)
        and isinstance(route.get("handler"), str)
        and route.get("semantic_operation") in {"inspection", "creation", "extraction", "execution"}
        and (route.get("request_model") is None or isinstance(route.get("request_model"), str))
        and (route.get("request_schema") is None or isinstance(route.get("request_schema"), str))
        and isinstance(route.get("response_model"), str)
        and isinstance(route.get("response_schema"), str)
        and isinstance(route.get("retirement_condition"), str)
        and route["retirement_condition"]
        for route in routes
    )
    return routes


def _registered_companion_archive_routes() -> set[tuple[str, str, str]]:
    router_source = COMPANION_ROUTER_PATH.read_text(encoding="utf-8")
    route_pattern = re.compile(
        r'\.route\(\s*"(?P<path>/api/(?:browse|viewer)/\{drive\}/archive[^\"]*)",\s*'
        r"axum::routing::(?P<method>get|post|put|delete)\(handlers::(?P<handler>\w+)\)\s*,?\s*\)",
        flags=re.DOTALL,
    )
    return {(match.group("method").upper(), match.group("path"), match.group("handler")) for match in route_pattern.finditer(router_source)}


def _v1_compatibility_readers() -> list[dict[str, str]]:
    fixture = json.loads(COMPATIBILITY_READERS_PATH.read_text(encoding="utf-8"))
    assert fixture["version"] == 1
    readers = fixture["readers"]
    assert isinstance(readers, list)
    assert all(
        isinstance(reader, dict)
        and reader.get("field") == "written_members"
        and reader.get("runtime") in {"backend", "companion"}
        and isinstance(reader.get("source"), str)
        and isinstance(reader.get("symbol"), str)
        and isinstance(reader.get("retirement_condition"), str)
        and reader["retirement_condition"]
        for reader in readers
    )
    return readers


def test_archive_contract_covers_every_active_backend_route() -> None:
    """Keep the versioned route contract aligned with every backend archive endpoint."""

    with ARCHIVE_CONTRACT_PATH.open(encoding="utf-8") as contract_file:
        contract = yaml.safe_load(contract_file)

    assert isinstance(contract, dict)
    assert contract["openapi"] == "3.1.0"
    assert _documented_backend_operations(contract) == _registered_backend_operations()


def test_archive_contract_covers_active_backend_inspection_routes() -> None:
    """Keep active SMB inspection route bindings explicit during V1 retention."""

    contract = yaml.safe_load(ARCHIVE_CONTRACT_PATH.read_text(encoding="utf-8"))
    documented_routes = {
        (method.upper(), path.replace("{connectionId}", "{connection_id}"))
        for path, path_item in contract["paths"].items()
        if isinstance(path, str) and path.startswith(("/api/browse/", "/api/viewer/")) and isinstance(path_item, dict)
        for method in path_item
        if method in HTTP_OPERATION_METHODS
    }
    assert documented_routes == _registered_backend_inspection_operations()


def test_local_to_smb_extraction_begin_request_matches_source_manifest_model() -> None:
    """Keep the optional local ZIP source manifest documented and model-backed."""

    contract = yaml.safe_load(ARCHIVE_CONTRACT_PATH.read_text(encoding="utf-8"))
    operation = contract["paths"]["/api/archive/operations/{operationId}/companion-relay/local_zip_to_smb_extract/begin"]["post"]
    schema_ref = operation["requestBody"]["content"]["application/json"]["schema"]["$ref"]
    assert operation["requestBody"]["required"] is False
    assert schema_ref == "#/components/schemas/ArchiveExtractionSourceManifest"

    schema = contract["components"]["schemas"]["ArchiveExtractionSourceManifest"]
    assert schema["required"] == ["entries"]
    assert schema["properties"]["entries"]["items"]["$ref"] == "#/components/schemas/ArchiveExtractionManifestEntry"
    payload = {"entries": [{"path": "notes.txt", "is_directory": False, "uncompressed_size": 5, "modified_at": None}]}
    assert ArchiveCompanionExtractionSourceManifest.model_validate(payload).model_dump(mode="json") == payload


def test_archive_contract_covers_backend_and_companion_relay_purposes() -> None:
    """Keep each hand-written purpose binding aligned with the versioned contract."""

    with ARCHIVE_CONTRACT_PATH.open(encoding="utf-8") as contract_file:
        contract = yaml.safe_load(contract_file)

    assert isinstance(contract, dict)
    documented_purposes = _documented_relay_purposes(contract)
    assert documented_purposes == {purpose.value for purpose in ArchiveCompanionRelayPurpose}
    assert documented_purposes == _companion_relay_purposes()


def test_archive_contract_binds_companion_archive_routes_to_their_concrete_models() -> None:
    """Keep retained V1 Companion routes bound to their concrete schema and handler models."""

    contract = yaml.safe_load(ARCHIVE_CONTRACT_PATH.read_text(encoding="utf-8"))
    bindings = _v1_companion_archive_route_bindings()
    assert {(route["method"], route["path"], route["handler"]) for route in bindings} == _registered_companion_archive_routes()

    schemas = contract["components"]["schemas"]
    handler_source = COMPANION_RELAY_BINDING_PATH.read_text(encoding="utf-8")
    for route in bindings:
        request_schema = route["request_schema"]
        if request_schema is not None:
            assert request_schema in schemas
        assert route["response_schema"] in schemas

        handler_match = re.search(
            rf"pub async fn {re.escape(str(route['handler']))}\((?P<parameters>.*?)\)\s*->\s*Result<(?P<response>[^,]+), ApiError>",
            handler_source,
            flags=re.DOTALL,
        )
        assert handler_match is not None
        assert handler_match.group("response").replace(" ", "") == route["response_model"]
        request_model_match = re.search(r"(?:Json|Query)\(\w+\):\s*(?:Json|Query)<(?P<model>\w+)>", handler_match.group("parameters"))
        expected_request_model = route["request_model"]
        if expected_request_model is None:
            assert request_model_match is None
        else:
            assert request_model_match is not None
            assert request_model_match.group("model") == expected_request_model


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


def test_v1_topology_operation_matrix_tracks_current_operation_support() -> None:
    """Keep the V1 inventory complete without implying a unified inspection operation."""

    matrix = json.loads(TOPOLOGY_OPERATION_MATRIX_PATH.read_text(encoding="utf-8"))
    assert matrix["version"] == 1
    operations = matrix["operations"]
    assert isinstance(operations, list)
    expected_cells = {
        (topology, operation)
        for topology in {"smb_to_smb", "local_to_local", "smb_to_local", "local_to_smb"}
        for operation in {"inspection", "creation", "extraction"}
    }
    assert {(entry["topology"], entry["operation"]) for entry in operations} == expected_cells

    for entry in operations:
        assert isinstance(entry["retirement_condition"], str) and entry["retirement_condition"]
        if entry["operation"] == "inspection":
            assert entry["status"] == "legacy_source_only"
            assert "driver" not in entry
            assert "relay_purpose" not in entry
            continue

        source_connection_id = "local-drive:c" if entry["topology"].startswith("local_") else "connection-1"
        destination_connection_id = "local-drive:c" if entry["topology"].endswith("_local") else "connection-1"
        kind = ArchiveOperationKind.CREATE if entry["operation"] == "creation" else ArchiveOperationKind.EXTRACT
        topology = resolve_archive_execution_topology(
            kind=kind,
            source_connection_id=source_connection_id,
            destination_connection_id=destination_connection_id,
        )
        assert entry["status"] == "supported"
        assert entry["driver"] == topology.driver.value
        assert entry.get("relay_purpose") == (topology.companion_purpose.value if topology.companion_purpose is not None else None)


def test_v1_written_members_readers_are_named_compatibility_boundaries() -> None:
    """Prevent new production uses of the V1 checkpoint member list."""

    readers = _v1_compatibility_readers()
    expected_sources = {reader["source"] for reader in readers}
    production_sources = {
        source.relative_to(WORKSPACE_ROOT).as_posix()
        for root in (WORKSPACE_ROOT / "backend" / "app", WORKSPACE_ROOT / "companion" / "src-tauri" / "src")
        for source in root.rglob("*.py")
        if source.suffix == ".py"
    } | {
        source.relative_to(WORKSPACE_ROOT).as_posix()
        for root in (WORKSPACE_ROOT / "backend" / "app", WORKSPACE_ROOT / "companion" / "src-tauri" / "src")
        for source in root.rglob("*.rs")
        if source.suffix == ".rs"
    }
    written_member_sources = {
        source for source in production_sources if "written_members" in (WORKSPACE_ROOT / source).read_text(encoding="utf-8")
    }
    assert written_member_sources == expected_sources

    python_reader = WORKSPACE_ROOT / "backend" / "app" / "services" / "archive" / "coordinator.py"
    rust_reader = WORKSPACE_ROOT / "companion" / "src-tauri" / "src" / "server" / "archive.rs"
    assert "def legacy_v1_written_member_paths" in python_reader.read_text(encoding="utf-8")
    assert "fn legacy_v1_completed_members" in rust_reader.read_text(encoding="utf-8")


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
