+++
title = "Backend Overview"
description = "Understand the FastAPI service boundaries, the SMB-facing responsibilities of the backend, and the contracts the frontend and companion rely on."
+++

The backend is the policy and integration layer between the browser-facing product and the storage systems Sambee works with.

## What The Backend Owns

The backend is responsible for:

- authentication and authorization
- API endpoints consumed by the browser app and companion flows
- SMB access and server-side file operations
- server-side preview and download behavior where the product needs it
- edit-lock and conflict-handling behavior for companion-assisted editing
- directory-change notification and other state that must stay authoritative on the server side

## Main Code Areas

The exact module layout evolves, but the backend is organized around a few stable concerns.

| Area | Responsibility |
|---|---|
| `backend/app/api/` | request handlers and HTTP-facing endpoints |
| `backend/app/models/` | API and domain models used across request and response boundaries |
| `backend/app/storage/` | storage backends and storage-facing behavior, including SMB access |
| `backend/app/services/` | longer-running or cross-cutting service behavior such as monitoring and background coordination |
| `backend/app/db/` | database setup and models for persisted application state |
| `backend/tests/` | pytest coverage for server behavior and contracts |

## Request And Storage Flow

For the common SMB flow:

1. The frontend issues an authenticated API request.
2. The backend validates input and permissions.
3. The backend performs the requested SMB operation through the storage layer.
4. The backend returns a typed response the frontend or companion can rely on.

This is why the backend, not the browser, is the source of truth for SMB semantics and conflict-sensitive operations.

If you need the detailed layer breakdown, continue to [Request Flow And Service Boundaries](../request-flow-and-service-boundaries/).

## Important Backend Contracts

### API Contract Stability

The frontend relies on typed request and response shapes. That is why contract testing guidance exists and why contributors should treat API shape changes as user-visible changes, not internal refactors.

### File-Type And Preview Behavior

The backend contributes to preview behavior through MIME detection, file-type classification, and conversion decisions for formats that are not natively browser-friendly. Those rules have to stay aligned with frontend expectations.

### Edit Locking And Companion Flows

For companion-assisted editing of SMB-backed files, the backend owns the server-side lock, heartbeat, upload, and conflict rules. A desktop-side improvement that ignores those rules can easily create data-loss regressions.

For the full lifecycle, continue to [File Operations And Edit Locking](../file-operations-and-edit-locking/).

### Change Notification

The backend also owns SMB-side change monitoring and the notifications that tell browser clients when directory state should refresh.

## What Usually Breaks When This Layer Changes

- frontend assumptions about response shape
- viewer or file-management behavior that depends on MIME or category detection
- companion editing flows that depend on lock or upload semantics
- directory freshness in the browser when change notifications stop matching product expectations

## Go Deeper

- [Request Flow And Service Boundaries](../request-flow-and-service-boundaries/): how API, models, storage, services, and WebSocket coordination fit together
- [File Operations And Edit Locking](../file-operations-and-edit-locking/): how ordinary file operations differ from companion-assisted SMB editing and lock handling

## Validation Expectations

When the backend changes, start with:

```bash
cd backend && pytest -v
cd backend && mypy app
```

Then add frontend or companion checks if the backend change affects a shared contract.

Use [Test Strategy Overview](../../testing-and-quality-gates/test-strategy-overview/) for the broader decision rule.
