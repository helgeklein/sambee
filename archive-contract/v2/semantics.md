# Archive Semantics V2

V2 is the only active archive contract. Creation and extraction are durable
operations. Inspection and member reads are request-scoped and non-durable.

## Versioning

Every durable operation, direct-local session, frontend recovery handle, and
Companion capability has `contract_version: "v2"`. A missing, different, or
invalid version is rejected before checkpoint parsing or archive I/O. There is
no V1 fallback or migration path.

## Extraction checkpoint

An extraction checkpoint is one JSON object with exactly these keys:

- `version`: integer `2`
- `manifest`: immutable array of members (`path`, `is_directory`,
  `uncompressed_size`, `modified_at`)
- `source_snapshot`: immutable object containing `size` and `modified_at`
- `member_outcomes`: object keyed by canonical member path
- `decisions`: object with `collision_actions`, `rename_targets`,
  `ignored_members`, and `retry_members`
- `pending_decision`: object or `null`

No aggregate counters are persisted. Terminal summaries are derived solely from
`member_outcomes`. Unknown keys, `written_members`, unversioned checkpoint
objects, and V1 checkpoint keys are invalid.

Member paths are UTF-8, forward-slash-separated relative paths with no empty,
`.` or `..` segment, colon, NUL, or leading slash. Timestamps are RFC 3339 UTC
strings ending in `Z`, or `null` where a source timestamp is unavailable.

## Idempotency and security

A control delivery identity is scoped to one operation and one command. An
identical replay is a no-op; reuse with a different command/payload fails.
Companion capabilities are signed and bind the operation ID, contract version,
operation kind, resolved topology, relay binding, and source/destination scope.

## V2 routes

All durable routes are rooted at `/api/archive/v2/operations`. Inspection routes
are rooted at `/api/archive/v2/inspection`; they receive an explicit V2 request
schema and never create an operation record.
