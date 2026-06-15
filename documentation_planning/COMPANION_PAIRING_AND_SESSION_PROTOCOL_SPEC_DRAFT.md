# Companion Pairing And Session Protocol Spec Draft

## Purpose

This document is the concrete Phase 2A protocol contract for the coordinated auth, lock, and renewal cutover.

It defines the backend-companion protocol that replaces the current implicit model where one exchanged bearer token is reused across the whole native edit lifecycle.

This draft is intended to be the implementation source of truth for:

- backend companion endpoints
- companion token exchange and edit-session state
- lock acquisition, heartbeat, release, and renewal behavior
- machine-readable error handling during the edit lifecycle
- developer and operational documentation updates describing the new protocol

Related planning documents:

- `documentation_planning/COMPANION_PAIRING_AND_SESSION_REMEDIATION_PLAN.md`
- `documentation_planning/COMPANION_PAIRING_AND_SESSION_IMPLEMENTATION_PLAN.md`

## Phase 1 Assumptions This Draft Builds On

This protocol draft is focused on the coordinated backend-companion auth and lock redesign in Phase 2, but it assumes the Phase 1 localhost pairing model is already in place.

In particular, it assumes:

- browser-to-companion local pairing is already origin-scoped and typed
- production pairing trust is established by exact-origin approval in the native companion UI
- typical loopback development origins are allowed without manual companion preconfiguration
- browser-visible pairing management is limited to the current origin
- pending pairing cancellation is explicit on both browser and native companion close paths

Those behaviors are not redefined in this document. They are prerequisites for the Phase 2 protocol work described below.

## Design Summary

The protocol uses three layers of authority:

1. a browser-obtained URI bootstrap token embedded in the deep link
2. a backend-issued companion bootstrap session used only to start the native edit flow
3. a backend-issued operation session bound to one edit operation and one lock lifecycle

The important change is that the companion no longer uses one broad session token for metadata lookup, lock acquisition, heartbeat, upload, and release indefinitely.

## Terms

- URI bootstrap token: short-lived token created by the backend and embedded in the `sambee://` link
- companion bootstrap session: short-lived backend-issued companion token used to begin the native flow
- operation session: renewable companion token bound to one edit operation
- operation ID: opaque server-generated identifier for one native edit lifecycle
- lock ID: opaque server-generated identifier for one active edit lock
- lock capability: opaque secret returned once at lock acquisition and required for strong lock control

## Protocol Invariants

- URI bootstrap tokens are single use.
- Companion tokens are structurally distinct from ordinary browser access tokens.
- Every companion token carries explicit token-class and purpose claims.
- Active edit authority is operation-scoped.
- Heartbeat, upload, release, and renewal all require lock identity.
- Lock ownership never depends on storing or returning a bearer token from lock state.
- Renewal is allowed only while the matching operation and lock are still valid.

## Token Contract

## 1. URI Bootstrap Token

### Issuer and transport

- Issued by: backend
- Requested by: browser
- Delivered to companion via: `sambee://` deep link
- Current endpoint shape retained: `POST /api/companion/uri-token`

### Claims

- `sub`: authenticated user identifier
- `token_class`: `uri_bootstrap`
- `purpose`: `open_in_companion`
- `jti`: unique single-use token ID
- `conn_id`: allowed connection ID
- `path`: allowed remote path
- `iat`: issued-at timestamp
- `exp`: expiry timestamp

### Lifetime

- TTL: 300 seconds
- Single use: mandatory
- Replay behavior: reject reuse even after backend restart

### Validation rules

- must have `token_class=uri_bootstrap`
- must not be expired
- `jti` must not already be consumed
- `conn_id` and `path` must be present

## 2. Companion Bootstrap Session

### Purpose

This token exists only to let the companion begin the native flow after deep-link launch.

It is valid for:

- file metadata lookup
- initial lock acquisition
- any one-time bootstrap checks explicitly allowed by the backend

It is not valid for:

- heartbeat
- upload finalization
- lock release after the operation session is established
- long-running edit continuity

### Issuer and transport

- Issued by: backend
- Requested by: companion
- Exchange endpoint retained in principle: `POST /api/companion/token`

### Claims

- `sub`: authenticated user identifier
- `token_class`: `companion_session`
- `purpose`: `bootstrap`
- `jti`: unique token ID
- `tv`: user token-version or equivalent revocation version
- `conn_id`: allowed connection ID
- `path`: allowed remote path
- `iat`: issued-at timestamp
- `exp`: expiry timestamp

### Lifetime

- TTL: 300 seconds
- Non-renewable

### Validation rules

- accepted only on endpoints that explicitly allow `purpose=bootstrap`
- must pass normal revocation or token-version checks
- `conn_id` must match the target connection
- `path` must match the target file when the endpoint acts on one file

## 3. Operation Session

### Purpose

This token represents active edit authority for one native edit operation.

It is valid for:

- operation-bound download
- lock heartbeat
- upload
- lock release
- operation-session renewal

### Issuer and transport

- Issued by: backend
- Delivered to companion in the successful lock-acquisition response

### Claims

- `sub`: authenticated user identifier
- `token_class`: `companion_session`
- `purpose`: `edit_operation`
- `jti`: unique token ID
- `tv`: user token-version or equivalent revocation version
- `conn_id`: allowed connection ID
- `op_id`: allowed operation ID
- `lock_id`: allowed lock ID
- `path`: allowed remote path
- `iat`: issued-at timestamp
- `exp`: expiry timestamp

### Lifetime

- TTL: 15 minutes
- Renewable: yes
- Renewal window: only while the operation and lock remain valid

### Validation rules

- accepted only on endpoints that explicitly require `purpose=edit_operation`
- must pass revocation or token-version checks
- `conn_id`, `op_id`, and `lock_id` must match the target request
- if the endpoint acts on one file, `path` must also match

## Endpoint Contract

## 1. Browser To Backend URI Token

### `POST /api/companion/uri-token`

### Request

```json
{
  "connection_id": "uuid",
  "path": "/docs/report.docx"
}
```

### Response

```json
{
  "uri_token": "jwt",
  "expires_in": 300
}
```

### Notes

- The browser then embeds `uri_token` in the `sambee://` deep link.
- The browser never receives a companion bootstrap session or operation session directly.

## 2. Companion Token Exchange

### `POST /api/companion/token`

### Request

```json
{
  "token": "uri-bootstrap-jwt"
}
```

### Response

```json
{
  "token": "companion-bootstrap-jwt",
  "expires_in": 300,
  "token_class": "companion_session",
  "purpose": "bootstrap",
  "connection_id": "uuid",
  "path": "/docs/report.docx"
}
```

### Server behavior

- Validate URI bootstrap token claims.
- Enforce single-use JTI consumption.
- Mint a companion bootstrap session.
- Do not create lock or operation state yet.

## 3. File Metadata Lookup

### `GET /api/companion/{connection_id}/file-info`

This endpoint name may stay as-is if an existing metadata endpoint already exists. The contract requirement is what matters.

### Auth

- `Authorization: Bearer <companion-bootstrap-session>`

### Allowed token

- `token_class=companion_session`
- `purpose=bootstrap`

### Validation rules

- `conn_id` must match path parameter
- `path` must match requested file path

## 4. Lock Acquisition

### `POST /api/companion/{connection_id}/lock`

### Auth

- `Authorization: Bearer <companion-bootstrap-session>`

### Request

```json
{
  "path": "/docs/report.docx"
}
```

### Response

```json
{
  "lock_id": "lock_opaque_id",
  "lock_capability": "lock_secret_if_enabled",
  "operation_id": "op_opaque_id",
  "operation_token": "operation-session-jwt",
  "operation_expires_in": 900,
  "renew_after_seconds": 600
}
```

### Server behavior

- Validate companion bootstrap session.
- Acquire the lock.
- Create the operation ID.
- Mint the operation session bound to that operation and lock.
- Return the lock ID and lock capability exactly once.

### Notes

- `lock_capability` is required in the final target design.
- If delivery uses a temporary bridge first, the backend may enforce strict owner binding before full capability enforcement, but the protocol target remains capability-based lock control.

## 5. Operation Download

### `GET /api/companion/{connection_id}/download`

### Auth

- `Authorization: Bearer <operation-session>`

### Required parameters

- `operation_id`
- `lock_id`
- `path`

### Validation rules

- token must have `purpose=edit_operation`
- token `conn_id`, `op_id`, `lock_id`, and `path` must all match

## 6. Lock Heartbeat

### `POST /api/companion/{connection_id}/lock/heartbeat`

### Auth

- `Authorization: Bearer <operation-session>`

### Request

```json
{
  "operation_id": "op_opaque_id",
  "lock_id": "lock_opaque_id",
  "lock_capability": "lock_secret_if_enabled"
}
```

### Response

```json
{
  "ok": true,
  "lock_expires_in": 90,
  "operation_expires_in": 540
}
```

### Validation rules

- token must have `purpose=edit_operation`
- `conn_id`, `op_id`, and `lock_id` must match
- if lock capability is enabled, it must match

## 7. Upload Finalization

### `POST /api/companion/{connection_id}/upload`

### Auth

- `Authorization: Bearer <operation-session>`

### Request

Must include:

- `operation_id`
- `lock_id`
- `lock_capability` if enabled
- the file payload or upload reference

### Validation rules

- same operation-session validation as heartbeat
- upload must fail if the operation is expired, the lock is lost, or capability validation fails

## 8. Lock Release

### `DELETE /api/companion/{connection_id}/lock`

### Auth

- `Authorization: Bearer <operation-session>`

### Request

```json
{
  "operation_id": "op_opaque_id",
  "lock_id": "lock_opaque_id",
  "lock_capability": "lock_secret_if_enabled"
}
```

### Response

```json
{
  "released": true
}
```

### Validation rules

- same operation-session validation as heartbeat
- lock must belong to the authenticated operation context

## 9. Operation Session Renewal

### `POST /api/companion/{connection_id}/session/renew`

### Auth

- `Authorization: Bearer <operation-session>`

### Request

```json
{
  "operation_id": "op_opaque_id",
  "lock_id": "lock_opaque_id",
  "lock_capability": "lock_secret_if_enabled"
}
```

### Response

```json
{
  "token": "new-operation-session-jwt",
  "expires_in": 900,
  "renew_after_seconds": 600
}
```

### Renewal rules

- renewal is allowed only when:
  - the operation is still active
  - the lock is still held
  - the lock capability matches if enabled
  - the current operation session is still within its renewable window
- renewal issues a fresh operation session with the same `conn_id`, `op_id`, `lock_id`, and `path`
- renewal does not change lock ownership

## 10. Lock Status

### `GET /api/companion/{connection_id}/lock-status`

### Contract requirements

- must not return any bearer token or session-equivalent value
- may return lock metadata such as:
  - `lock_id`
  - `locked_by_current_user`
  - `operation_id`
  - `expires_in`
- must not be used as a side channel for token recovery

## Error Contract

All companion-facing JSON errors in the new protocol should use this shape:

```json
{
  "error": {
    "code": "OPERATION_SESSION_RENEWAL_REQUIRED",
    "message": "Operation session must be renewed before retrying this request.",
    "retryable": true,
    "state": "renewal_required"
  }
}
```

### Required error codes

#### `COMPANION_TOKEN_INVALID`

- HTTP status: 401
- Meaning: token malformed, wrong class, wrong purpose, missing required claim, or signature invalid
- Companion behavior: stop and surface auth failure

#### `COMPANION_TOKEN_REVOKED`

- HTTP status: 401
- Meaning: token version no longer valid because of revocation event
- Companion behavior: stop and require fresh browser-initiated bootstrap

#### `OPERATION_SESSION_EXPIRED`

- HTTP status: 401
- Meaning: operation token is expired and no longer renewable
- Companion behavior: stop and surface recovery-required state

#### `OPERATION_SESSION_RENEWAL_REQUIRED`

- HTTP status: 409
- Meaning: operation token is near or at expiry and the caller must renew before retrying
- Companion behavior: call renewal endpoint, then retry the interrupted action once

#### `LOCK_LOST`

- HTTP status: 409
- Meaning: lock no longer exists or no longer belongs to this operation context
- Companion behavior: stop edit flow and surface lock-lost state

#### `LOCK_CAPABILITY_MISMATCH`

- HTTP status: 403
- Meaning: supplied lock capability does not match the active lock
- Companion behavior: stop and treat as unrecoverable for the current operation

#### `URI_TOKEN_REPLAYED`

- HTTP status: 409
- Meaning: URI bootstrap token JTI was already consumed
- Companion behavior: fail token exchange and require a new browser-initiated open action

#### `SCOPE_MISMATCH`

- HTTP status: 403
- Meaning: token connection, path, operation, or lock scope does not match the requested resource
- Companion behavior: stop and treat as protocol or state corruption

## Companion State Model

For one native edit operation, the companion should track at least:

- `connection_id`
- `remote_path`
- `bootstrap_token`
- `operation_id`
- `operation_token`
- `operation_token_expires_at`
- `lock_id`
- `lock_capability`
- `status`

Recommended status values:

- `starting`
- `lock_acquired`
- `editing`
- `renewal_required`
- `uploading`
- `completed`
- `lock_lost`
- `auth_failed`
- `recovery_required`

## Required Behavioral Rules

### Backend

- never accept a normal browser access token where a companion token is required
- never accept a bootstrap companion session on heartbeat, upload, release, or renew
- never return any session-equivalent value from lock-status responses
- never log raw token or lock-capability values

### Companion

- renew proactively before operation token expiry
- do not retry forever after auth, renewal, or lock-loss failures
- retry exactly once after a successful renewal for the interrupted operation request
- clear operation state after release, lock loss, or unrecoverable auth failure

### Frontend

- browser remains responsible only for initiating the backend URI bootstrap flow
- browser does not receive operation tokens or lock capabilities
- browser UI should be able to represent companion-side renewal or recovery failure states if surfaced back to it

## Staging Validation Checklist

1. Browser requests URI bootstrap token and launches deep link.
2. Companion exchanges URI token for bootstrap session.
3. Companion acquires lock and receives lock ID, capability, operation ID, and operation session.
4. Companion downloads file using operation session.
5. Companion heartbeats successfully through at least one renewal cycle.
6. Companion uploads successfully with operation-scoped authority.
7. Companion releases lock successfully.
8. Lock-status endpoint never exposes token material during or after the operation.
9. Reusing the URI token fails with `URI_TOKEN_REPLAYED`.
10. Releasing with the wrong lock capability fails with `LOCK_CAPABILITY_MISMATCH`.

## Required Documentation Updates

The protocol cutover is not complete until the docs are updated alongside the code.

Required docs outputs:

1. Developer docs describing the three-layer authority model: URI bootstrap token, companion bootstrap session, and operation session.
2. Developer docs describing the lock ID and lock capability model, including the fact that lock status no longer exposes bearer-equivalent state.
3. Operational docs describing how to diagnose token exchange failures, replay rejection, renewal-required states, lock loss, and capability mismatches.
4. End-user or support docs describing the user-visible recovery states that may surface during native edit flows.
5. Release notes documenting that backend, companion, and frontend must be upgraded together for the coordinated cutover.

Documentation source expectations:

- end-user, admin, developer, and troubleshooting docs should live under `website/content/docs/`
- structural docs edits should use `website/scripts/docs-editor.py`
- changed docs should be validated with `cd /workspace/website && npm run docs:validate`
