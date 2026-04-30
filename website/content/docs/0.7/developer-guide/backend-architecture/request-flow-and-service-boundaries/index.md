+++
title = "Request Flow And Service Boundaries"
description = "Understand how requests move through Sambee's backend layers and which responsibilities belong to API handlers, models, storage code, and long-running services."
+++

The backend is easiest to change safely when you treat it as layered coordination instead of one large request handler.

## The Main Boundaries

| Area | What it should own |
|---|---|
| `backend/app/api/` | HTTP and WebSocket entry points, request parsing, response shaping, and protocol-specific concerns |
| `backend/app/models/` | request and response models plus typed data contracts |
| `backend/app/storage/` | storage-facing behavior such as SMB operations and file handling |
| `backend/app/services/` | cross-request or longer-lived coordination such as directory monitoring or image conversion |
| `backend/app/db/` | persisted application state and database integration |

Contributors get into trouble when logic that belongs in one boundary starts leaking into another.

## Common Request Paths

### Standard Browser API Flow

For a typical browse or file-management request:

1. a handler in `backend/app/api/` receives the request
2. request data is validated against typed models
3. the handler calls storage or service logic
4. the backend returns a typed response for the frontend to consume

The handler should remain the HTTP-facing boundary, not the place where SMB implementation details accumulate.

### Viewer And Preview Flow

Preview-related requests are not just file streaming.

They can involve:

- MIME classification through the file-type registry
- conversion decisions for non-browser-native images
- streaming or materialized responses depending on the format

This is one reason preview behavior spans both `api/`, `utils/`, and `services/` code.

### Directory-Change Flow

Directory freshness is coordinated through a service boundary.

1. the WebSocket layer manages subscriptions
2. the directory monitor owns SMB-side watcher lifecycle
3. change notifications are pushed back to subscribed clients

That split matters because connection recovery and handle cleanup are not ordinary request work.

## Why The Layering Matters

### API Contracts

The frontend and companion depend on stable request and response shapes. If you change an API contract, you are changing a cross-boundary contract, not just moving code around.

### Storage Semantics

The storage layer is where SMB-specific behavior belongs. It should not be reimplemented ad hoc in handlers just because a feature needs a quick change.

### Long-Lived Coordination

Background coordination such as directory monitoring belongs in services because it outlives one request and needs explicit lifecycle management.

## Signs The Boundary Is Slipping

- request handlers know too much about SMB implementation details
- the same response-shaping logic is duplicated across endpoints
- storage helpers start taking HTTP-specific parameters
- service-level coordination is recreated inside one endpoint instead of reused

## Where To Continue

- Use [File Operations And Edit Locking](../file-operations-and-edit-locking/) when the change affects create, rename, copy, move, upload, or companion-assisted editing.
- Use [Frontend Overview](../../frontend-architecture/frontend-overview/) when the backend change alters browser-visible workflow behavior.
- Use [Test Strategy Overview](../../testing-and-quality-gates/test-strategy-overview/) when the changed boundary requires broader validation.
