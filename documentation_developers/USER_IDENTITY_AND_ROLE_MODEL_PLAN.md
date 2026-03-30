# User Identity And Role Model Plan

## Purpose

This document defines the implementation plan for expanding the user model with richer identity metadata and a clearer role system.

Requested scope:

- additional user properties:
  - name
  - email
  - expiration time
- user roles:
  - `admin` (existing)
  - `editor` (rename from existing `regular`)
  - `viewer` (new, read-only)

The plan is intentionally implementation-focused. It is meant to guide a staged code change across backend, frontend, migrations, authentication, authorization, and tests.

## Current State

### Backend

Current backend user modeling is centered on [backend/app/models/user.py](/workspace/backend/app/models/user.py):

- `UserRole` currently has only `regular` and `admin`
- `User` stores:
  - `username`
  - `password_hash`
  - `role`
  - `is_active`
  - `must_change_password`
  - `token_version`
  - timestamps
- there are no persisted `name`, `email`, or expiration fields
  - persisted legacy-role upgrades are handled in migrations; live model input no longer normalizes legacy role names

Admin user CRUD currently lives in [backend/app/api/admin.py](/workspace/backend/app/api/admin.py):

- list users
- create user
- update user
- reset password
- delete user

Authorization is role-to-capability based in [backend/app/core/authorization.py](/workspace/backend/app/core/authorization.py):

- `regular` has no admin capabilities
- `admin` has all current admin capabilities

Authentication currently rejects only users that are inactive or invalid for token/version reasons in [backend/app/core/security.py](/workspace/backend/app/core/security.py). There is no account-expiration enforcement yet.

### Frontend

Current frontend shared types live in [frontend/src/types/index.ts](/workspace/frontend/src/types/index.ts):

- `UserRole = "admin" | "regular"`
- `User`, `AdminUser`, `AdminUserCreateInput`, and `AdminUserUpdateInput` do not contain `name`, `email`, or expiration fields

Admin user management currently lives in [frontend/src/pages/UserManagementSettings.tsx](/workspace/frontend/src/pages/UserManagementSettings.tsx):

- form fields are limited to username, role, active state, password, and must-change-password
- role picker offers only `regular` and `admin`

## Target State

### New persisted user properties

Add the following first-class fields to the core user model:

- `display_name` or `name`: human-readable name
- `email`: canonical email address
- `expires_at`: optional UTC timestamp after which the account is no longer valid

Recommended naming decision:

- use `name` in API and frontend contracts for simplicity
- store it as `name` in the database model as well unless a conflicting field already exists elsewhere
- use `expires_at` for the timestamp field to match existing timestamp naming conventions

### New role model

Final role set:

- `admin`
- `editor`
- `viewer`

Role semantics:

- `admin`: current full admin behavior
- `editor`: standard non-admin product user with write capability where connection/session policy allows it
- `viewer`: non-admin read-only user whose product-level capabilities must never allow write actions

Recommended compatibility decision:

- treat existing stored `regular` users as `editor` during migration
- remove temporary backend input compatibility for `regular` once persisted-data migration is complete
- do not keep `regular` in new frontend contracts once implementation starts

### Legacy `is_admin` property removal

`is_admin` should be removed as part of this work.

Target rule:

- `role` is the only authorization source of truth
- `is_admin` is not persisted
- `is_admin` is not emitted by backend API responses
- frontend logic must not depend on `is_admin`

Rationale:

- keeping both `role` and `is_admin` creates two parallel authorization signals
- the new `admin` / `editor` / `viewer` model is clearer if all privilege checks flow from role and capabilities only
- removing `is_admin` now avoids dragging legacy compatibility into the new role model

## Design Decisions

### 1. Read-only for `viewer` must be product-level, not just UI-level

`viewer` is not only a label. It must result in backend-enforced read-only behavior.

That means:

- write endpoints must be rejected server-side for `viewer`
- frontend affordances must be suppressed or disabled for `viewer`
- connection-level read-only and user-level read-only must compose safely

Resulting policy model:

- a write is allowed only if both the user role and the target connection/session policy allow it
- `viewer` always loses that check

### 2. Expiration is an authentication and session-validity concern

`expires_at` should not just be an informational field in the admin UI.

Required behavior:

- expired users cannot authenticate
- already-issued bearer tokens for expired users must be rejected on subsequent requests
- expired users should be treated similarly to inactive users for access control purposes

Recommended implementation rule:

- do not run a background cleanup job for the first iteration
- instead, enforce expiration dynamically at auth time and token validation time
- optional future cleanup can deactivate or prune expired users later

### 3. Email should be unique when present

Recommended behavior:

- `email` is optional for the first implementation step unless product policy wants to require it for all users
- when present, it must be normalized and unique case-insensitively

If case-insensitive uniqueness is awkward in SQLite without larger refactoring, the minimum acceptable first step is:

- trim whitespace
- lowercase before persistence
- enforce unique values at application level
- add a database unique index on the normalized stored value

### 4. Name is descriptive metadata, not identity

`username` remains the login identity for now.

Recommended behavior:

- `name` is optional at the schema level but should be strongly encouraged in the admin UI
- keep auth and ownership logic keyed to `username` and `id`, not `name`

### 5. `is_admin` should be fully removed, not retained as a convenience field

Recommended behavior:

- remove `is_admin` from backend response DTOs
- remove `is_admin` compatibility normalization from backend models once rollout is complete
- replace direct `user.is_admin` checks with role/capability checks
- remove `is_admin` from frontend types, mocks, fixtures, and tests

Compatibility note:

- temporary tolerance for inbound legacy payloads is acceptable only during the backend rollout window
- no new frontend code should read or emit `is_admin`

## Backend Implementation Plan

### Phase A: core model and migration

Update [backend/app/models/user.py](/workspace/backend/app/models/user.py):

- rename `UserRole.REGULAR` to `UserRole.EDITOR`
- add `UserRole.VIEWER`
- add fields to `User`:
  - `name: str | None`
  - `email: str | None`
  - `expires_at: datetime | None`
- update create/read/update DTO models:
  - `CurrentUserRead`
  - `AdminUserRead`
  - `AdminUserCreate`
  - `AdminUserUpdate`
  - `build_current_user_read`
  - `build_admin_user_read`
- remove `is_admin` from response DTOs once callers are migrated

Migration work in [backend/app/db/migrations.py](/workspace/backend/app/db/migrations.py):

- add columns:
  - `name`
  - `email`
  - `expires_at`
- transform persisted roles:
  - `regular` -> `editor`
- add supporting indexes:
  - role index remains valid but may need rebuild if role enum constraints are strict
  - unique index for normalized email if email uniqueness is implemented at DB level

Compatibility rule during migration:

- migrations may continue translating persisted legacy `regular` values to `editor`, but live request/model validation should reject `regular`
- temporary legacy `is_admin` input compatibility may remain only long enough to avoid mixed-version rollout failures
- any temporary `is_admin` normalization must map to `admin` vs `editor`, never to `viewer`
- the end state is full removal of `is_admin` from model compatibility paths

### Phase B: authorization model

Update [backend/app/core/authorization.py](/workspace/backend/app/core/authorization.py):

- replace `regular` with `editor`
- add `viewer`
- keep current admin capabilities unchanged
- replace any direct `is_admin` logic with role/capability checks
- decide whether to introduce an explicit write capability now or rely on role checks in existing write guards

Recommended implementation choice:

- do not invent a broad write capability enum unless it clearly simplifies current code
- instead, add a small reusable helper such as `user_is_read_only(user)` or `can_user_write(user)`
- use that helper where write access is enforced

### Phase C: authentication and expiration enforcement

Update [backend/app/core/security.py](/workspace/backend/app/core/security.py):

- reject users with `expires_at <= now`
- apply that check in both:
  - login/auth token issuance path
  - token resolution path for already-issued tokens
- remove response-building or logging dependencies on `is_admin`

Required behavior:

- expired user receives `401` for auth validation failures
- admin-only routes and standard API routes should behave consistently because they rely on current-user resolution

Recommended helper:

- add a single `is_user_account_valid(user, now)` or equivalent internal helper
- centralize `is_active` and `expires_at` checks there

### Phase D: admin API contract updates

Update [backend/app/api/admin.py](/workspace/backend/app/api/admin.py):

- allow create/update payloads to carry:
  - `name`
  - `email`
  - `expires_at`
- return those fields in list/create/update responses
- stop returning `is_admin`
- validate email uniqueness and normalization
- prevent invalid expiration formats or impossible values

Recommended validation rules:

- trim `username`, `name`, and `email`
- lowercase `email` before persistence
- reject duplicate email
- allow `expires_at = null` for non-expiring users
- reject expiration timestamps in the past on create
- allow past expiration on update only if the product wants immediate expiry via edit; otherwise reject and require deactivate instead

Recommended policy choice:

- allow setting `expires_at` in the past on update because that provides a direct “expire now” operator action

### Phase E: backend write-path enforcement for `viewer`

The existing read-only work for connections already blocks many write routes. Extend that model so `viewer` users are also blocked.

Likely touchpoints:

- browser write endpoints
- connection management APIs if non-admins can reach any of them
- companion edit-lock or write-related flows
- any future or existing file mutation endpoints

Recommended implementation shape:

- centralize user-role-based write denial in one helper near existing connection access enforcement
- combine it with connection-level read-only checks rather than duplicating messages in each route
- use role/capability checks only; do not preserve `is_admin` shortcuts

Example effective policy:

- deny if user role is `viewer`
- deny if connection is read-only
- otherwise allow if route-specific permissions pass

## Frontend Implementation Plan

### Phase F: shared types and API client

Update [frontend/src/types/index.ts](/workspace/frontend/src/types/index.ts):

- change `UserRole` to:
  - `"admin" | "editor" | "viewer"`
- extend user contracts with:
  - `name?: string | null`
  - `email?: string | null`
  - `expires_at?: string | null`
- remove `is_admin` from shared user/admin contracts

Update API normalization in [frontend/src/services/api.ts](/workspace/frontend/src/services/api.ts):

- ensure normalized user objects preserve the new fields
- stop depending on `regular` in type-level assumptions
- stop deriving or storing `is_admin`; use `role` only

### Phase G: user-management UI

Update [frontend/src/pages/UserManagementSettings.tsx](/workspace/frontend/src/pages/UserManagementSettings.tsx):

- create/edit dialog fields:
  - username
  - name
  - email
  - role
  - active state
  - expiration time
  - password / must-change-password on create
- show user metadata in the list:
  - display name if present
  - email if present
  - expiration state if present
- rename visible role label from “Regular” to “Editor”
- add visible role label for “Viewer”

Recommended UX decisions:

- expiration field should be nullable with a clear “Never expires” default
- use a datetime-local input in the first iteration if the existing admin settings UI does not already have a better shared datetime control
- render expired accounts with a clear warning chip or status label

### Phase H: frontend role-aware affordances

Existing connection read-only work already suppresses write actions in the browser and viewers. Extend that logic so user role also affects affordances.

Required behavior:

- `viewer` should see the same effective no-write affordances even on writable connections
- admin/editor behavior should remain subject to connection-level access mode

Recommended implementation shape:

- add a frontend helper expressing effective write access from:
  - current user role
  - current connection access mode
- feed that helper into the existing file-browser and viewer affordance suppression code
- update admin-access helpers to rely only on `role === "admin"`

## API Contract Changes

### Current user response

Extend current-user payloads to include:

- `name`
- `email`
- `expires_at`
- new role values

And remove:

- `is_admin`

### Admin user list/create/update responses

Extend admin user payloads to include:

- `name`
- `email`
- `expires_at`

And remove:

- `is_admin`

### Admin create/update requests

Accept:

- `name`
- `email`
- `expires_at`
- new role values `editor` and `viewer`

Compatibility recommendation:

- backend may temporarily accept `regular` in requests and normalize to `editor`
- frontend should not emit `regular` once this work lands
- backend may temporarily accept inbound `is_admin` only during rollout if strictly necessary
- frontend should neither emit nor require `is_admin`

## Migration Strategy

### Database migration order

1. add new columns
2. normalize legacy role values from `regular` to `editor`
3. add or rebuild indexes
4. update model validators and enums

### Deployment safety rules

To avoid mixed-version breakage:

- deploy backend support for both `regular` and `editor` input before or together with the frontend change
- only after the backend is tolerant should the frontend begin sending `editor`
- if temporary `is_admin` compatibility is kept, restrict it to a short backend-only rollout window and remove it immediately after frontend migration

### Existing users

Migration expectations:

- all existing `admin` users stay `admin`
- all existing `regular` users become `editor`
- existing users get `name = null`, `email = null`, `expires_at = null`

## Test Plan

### Backend tests

Add or update tests for:

- user model serialization/deserialization with new fields
- migration from `regular` to `editor`
- removal of `is_admin` from current-user and admin-user response contracts
- admin user create/update/list with `name`, `email`, and `expires_at`
- duplicate email rejection
- expired user login rejection
- expired token validation rejection for an already-authenticated expired user
- `viewer` blocked on write routes
- `editor` allowed where current `regular` users were allowed
- replacement of direct `is_admin` checks with role/capability checks

Likely files:

- [backend/tests/test_connections.py](/workspace/backend/tests/test_connections.py) if role-sensitive behavior reaches connection management
- [backend/tests/test_browser.py](/workspace/backend/tests/test_browser.py) for viewer write blocking
- new or existing auth/admin tests around user CRUD and current-user responses

### Frontend tests

Add or update tests for:

- shared types and API normalization expectations
- removal of `is_admin` from frontend user contracts and mocks
- user-management settings:
  - create user with editor/viewer
  - edit name/email/expiry
  - display role labels `Admin`, `Editor`, `Viewer`
  - show expiration state
- file-browser affordance suppression for `viewer`
- current-user access helpers with the new roles

Likely files:

- [frontend/src/pages/__tests__/UserManagementSettings.test.tsx](/workspace/frontend/src/pages/__tests__/UserManagementSettings.test.tsx)
- [frontend/src/services/__tests__/api.test.ts](/workspace/frontend/src/services/__tests__/api.test.ts)
- browser/viewer interaction tests that currently rely only on connection read-only state

## Recommended Implementation Sequence

### Slice 1: model and migration

- add roles and new fields to backend models
- add database migration
- add backend compatibility normalization for `regular`
- remove `is_admin` from backend response models or add a short-lived deprecation shim if rollout sequencing requires it

### Slice 2: admin API contracts

- extend backend admin CRUD payloads
- add backend tests for new fields and role values

### Slice 3: auth expiration enforcement

- add expiration validation to current-user resolution and login
- add auth tests

### Slice 4: frontend types and admin UI

- update shared TS contracts
- update user management settings UI
- update mocks and fixtures
- remove `is_admin` from frontend access helpers and tests

### Slice 5: viewer role enforcement

- backend write-path blocking for `viewer`
- frontend affordance suppression for `viewer`
- integration/regression tests

### Slice 6: cleanup

- remove temporary `regular` compatibility paths if no longer needed
- remove any temporary inbound `is_admin` compatibility if it was retained during rollout
- align copy, labels, and docs everywhere to `editor`

## Implementation Status

Completed in the repository:

- backend user model stores `name`, `email`, `expires_at`, and the `admin` / `editor` / `viewer` role set
- database migration support exists for the user identity and role refresh
- backend auth responses and admin user CRUD expose the new identity fields and role values
- expiration is enforced both at login and during current-user/token validation
- backend write enforcement blocks `viewer` users in the connection/browser/companion-connected write flows
- backend live request/model validation no longer accepts legacy `regular` role input
- connection management test endpoints now also require writable user access, so `viewer` cannot test draft or persisted connections
- backend source code no longer depends on `is_admin` outside legacy migration handling
- frontend shared runtime logic uses `role` as the only privilege signal
- frontend user management supports the new fields and role labels
- frontend file-browser and connection-management UI honor effective read-only access for `viewer`
- frontend source contracts no longer expose `is_admin`

Still remaining or intentionally retained:

- legacy migration logic still references `is_admin` only for upgrading old persisted schemas
- self-service account writes such as password changes and per-user settings remain intentionally allowed for non-admin roles, including `viewer`

## Risks And Notes

### Role rename risk

The `regular` -> `editor` rename touches:

- database data
- backend enums
- frontend types
- tests, fixtures, and mocks
- localized UI copy

This is the highest-risk part of the change because it is broad and contract-visible.

### Expiration semantics risk

If expiration is enforced only at login but not token validation, the system will behave incorrectly for already-issued tokens. The plan explicitly requires both checks.

### Viewer scope risk

If `viewer` is implemented only in the admin UI and not in backend write enforcement, it will be a cosmetic role rather than a real security boundary. That is not acceptable.

### Dual-signal authorization risk

If both `role` and `is_admin` remain in circulation, the system will have two overlapping privilege signals during the most complex part of the migration.

That increases the chance of:

- inconsistent frontend admin detection
- stale test fixtures masking contract drift
- backend call sites silently continuing to bypass the new role model

## Definition Of Done

This work is complete when all of the following are true:

- backend persists `name`, `email`, and `expires_at`
- role values are `admin`, `editor`, and `viewer`
- existing `regular` users are migrated safely to `editor`
- legacy `is_admin` has been removed from backend and frontend contracts
- current-user and admin-user APIs expose the new fields
- expired users are rejected consistently at auth and token-validation time
- `viewer` users are blocked from write operations server-side
- frontend admin UI supports viewing and editing the new fields
- frontend uses `Editor` instead of `Regular`
- tests cover migration, auth expiry, admin CRUD, and viewer read-only enforcement
