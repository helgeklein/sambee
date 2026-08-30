"""V2-only route and capability contract checks."""

import json
import re
from pathlib import Path
from typing import Any

from fastapi.routing import APIRoute

from app.api.archive_operations import v2_router

WORKSPACE_ROOT = Path(__file__).resolve().parents[2]
ROUTE_BINDINGS_PATH = WORKSPACE_ROOT / "archive-contract" / "v2" / "route-bindings.json"
SCHEMA_PATH = WORKSPACE_ROOT / "archive-contract" / "v2" / "schema.json"
COMPANION_ROUTER_PATH = WORKSPACE_ROOT / "companion" / "src-tauri" / "src" / "server" / "mod.rs"
HTTP_METHODS = frozenset({"GET", "POST", "PUT", "DELETE"})
BACKEND_PREFIX = "/api/archive"


def _documented_routes(owner: str) -> set[tuple[str, str]]:
    fixture: dict[str, Any] = json.loads(ROUTE_BINDINGS_PATH.read_text(encoding="utf-8"))
    assert fixture["version"] == "v2"
    assert fixture["unknown_fields"] == "rejected"
    routes = fixture["routes"]
    assert isinstance(routes, list) and routes
    assert all(
        isinstance(route, dict)
        and route.get("owner") in {"backend", "companion"}
        and route.get("method") in HTTP_METHODS
        and isinstance(route.get("path"), str)
        and route["path"].startswith("/api/")
        and isinstance(route.get("operation"), str)
        and isinstance(route.get("durable"), bool)
        and isinstance(route.get("capability"), bool)
        and route.get("idempotency") in {"none", "revision", "delivery-id"}
        and (route.get("request_schema") is None or isinstance(route.get("request_schema"), str))
        and isinstance(route.get("response_schema"), str)
        for route in routes
    )
    return {(route["method"], route["path"]) for route in routes if route["owner"] == owner}


def _registered_backend_routes() -> set[tuple[str, str]]:
    return {
        (method, f"{BACKEND_PREFIX}{route.path}")
        for route in v2_router.routes
        if isinstance(route, APIRoute)
        for method in route.methods or set()
        if method in HTTP_METHODS
    }


def _registered_companion_routes() -> set[tuple[str, str]]:
    source = COMPANION_ROUTER_PATH.read_text(encoding="utf-8")
    pattern = re.compile(
        r'\.route\(\s*"(?P<path>/api/(?:browse|viewer)/\{drive\}/archive/v2[^\"]*)",\s*'
        r"axum::routing::(?P<method>get|post|put|delete)\(handlers::\w+\)\s*,?\s*\)",
        flags=re.DOTALL,
    )
    return {(match.group("method").upper(), match.group("path")) for match in pattern.finditer(source)}


def test_v2_route_bindings_cover_every_registered_archive_route() -> None:
    assert _documented_routes("backend") == _registered_backend_routes()
    assert _documented_routes("companion") == _registered_companion_routes()


def test_v2_route_bindings_reference_defined_schemas() -> None:
    fixture: dict[str, Any] = json.loads(ROUTE_BINDINGS_PATH.read_text(encoding="utf-8"))
    schema: dict[str, Any] = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    definitions = schema.get("$defs")

    assert isinstance(definitions, dict)
    assert fixture["capability_schema"] in definitions
    for route in fixture["routes"]:
        for schema_name in (route["request_schema"], route["response_schema"]):
            if schema_name is not None:
                assert schema_name in definitions, f"{route['method']} {route['path']} references undefined schema {schema_name}"


def test_v2_relay_routes_are_normalized_and_capability_bound() -> None:
    fixture: dict[str, Any] = json.loads(ROUTE_BINDINGS_PATH.read_text(encoding="utf-8"))
    relay_routes = [route for route in fixture["routes"] if "/relay/" in route["path"]]

    assert relay_routes
    assert all(route["path"].split("/relay/", maxsplit=1)[1].split("/", maxsplit=1)[0] in {"creation", "extraction"} for route in relay_routes)
    assert all(route["capability"] is True and route["durable"] is True for route in relay_routes)
    assert all("companion-relay" not in route["path"] for route in fixture["routes"])
    assert all("_to_" not in route["path"] and "_from_" not in route["path"] for route in relay_routes)


def test_v1_archive_routes_are_not_registered() -> None:
    backend_paths = {path for _method, path in _registered_backend_routes()}
    companion_paths = {path for _method, path in _registered_companion_routes()}

    assert all("/companion-relay/" not in path for path in backend_paths)
    assert all("/archive/v1" not in path for path in backend_paths | companion_paths)
