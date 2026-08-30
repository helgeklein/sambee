# Archive Semantics V2

V2 is the only archive contract. Creation and extraction are durable operation
resources. Inspection and member reads are request-scoped and non-durable.
There is no V1 route, payload, checkpoint, capability, migration, or recovery
fallback.

## Versioning And Encoding

Every durable operation, direct-local session, frontend recovery handle, and
Companion capability is pinned to `contract_version: "v2"`. A missing,
different, expired, or tampered version is rejected before lifecycle processing,
checkpoint parsing, or archive I/O.

JSON object members use the schema names in `schema.json`. Unknown object keys
are rejected unless the schema explicitly permits map entries. Member paths are
UTF-8, forward-slash-separated relative paths, at most 4096 characters, with no
leading slash, empty, `.` or `..` segment, colon, backslash, or NUL. Timestamps
are RFC 3339 UTC strings ending in `Z`, or `null` only where a source timestamp
is unavailable. Counts and byte sizes are non-negative integers. Routes that
accept a member manifest allow at most 100000 entries; inspection pages contain
1 through 500 items.

## Durable Operations

`operation` is the prepare request and `operationRead` is the durable resource
representation. Only `create` and `extract` kinds exist. The lifecycle phase is
one of `prepared`, `accepted`, `streaming`, `awaiting_user_decision`,
`verifying`, `completed`, `cancelled`, or `failed`; the final three states are
terminal. A revision-bound transition, decision, or cancellation must match its
expected revision when supplied.

Terminal summaries are derived only from terminal `member_outcomes`. They are
not checkpoint fields and must never be independently resumed or incremented.

## Checkpoints And Decisions

An extraction checkpoint has exactly `version` (integer `2`), immutable
`manifest`, immutable `source_snapshot`, `member_outcomes`, `decisions`,
`pending_decision`, and `delivery_ids`. A creation checkpoint has the same
fields except it has no `source_snapshot`; its `decisions` is `{}` and its
`pending_decision` is `null`. Both envelopes reject unversioned objects,
independently maintained aggregate counters, `written_members`, and every V1
checkpoint field.

Extraction terminal outcomes are `directory`, `extracted`, `skipped`, and
`ignored`. A `partial` outcome records an incomplete target and is not terminal;
the member must be retried or explicitly ignored. Creation terminal outcomes are
`directory` and `created`.

`decisions` persists member-local collision actions (`skip` or `replace`),
rename targets, ignored members, and retry members. A pending collision is an
`existing_files` object with one or more conflicts and allowed actions. A pending
write failure is a `member_error` object with canonical member and target paths,
a bounded message, `partial_output`, and exactly `retry` and `ignore` actions.
Control decisions may use `skip`, `skip_all`, `replace`, `replace_all`,
`replace_older`, `rename`, `retry`, `ignore`, or `cancel`; the pending decision
limits which actions are valid.

## Routes And Ownership

The complete binding inventory is `route-bindings.json`. Backend durable routes
are rooted at `/api/archive/v2/operations`; its inspection routes are rooted at
`/api/archive/v2/inspection`. Companion direct-local execution routes are rooted
at `/api/browse/{drive}/archive/v2/executions`. Mixed Companion execution uses
only `/api/browse/{drive}/archive/v2/relay/creation` and
`/api/browse/{drive}/archive/v2/relay/extraction`.

Public route names and payloads are operation-based. The disjoint relay request
shapes identify whether the local drive supplies source data or receives output;
they do not expose a topology selector. The runtime resolves the actual local,
SMB, or relay adapter privately. SMB-to-SMB is backend-owned, local-to-local is
Companion-owned, and mixed topologies use a Companion relay over a backend-owned
durable operation.

Inspection request schemas are owner-specific: backend SMB inspection requires
`connection_id`, while Companion local inspection derives its source identity
from the `{drive}` route parameter. Backend member inspection additionally
declares its supported preview viewport and screen parameters.

## Capabilities And Idempotency

A Companion capability is a signed, short-lived claim bound to the operation ID,
contract version, operation kind, resolved topology, relay binding, source and
destination connection IDs and paths, and manifest hash. The backend validates
every claim against the durable operation before relay I/O.

`Idempotency-Key` is an optional UUID delivery identity on relay acknowledgement
controls. It is scoped to one operation and command. The checkpoint `delivery_ids`
map stores at most 1024 entries whose values are nonempty fingerprints up to 4096
characters. The fingerprint is the compact JSON serialization of
`{"command": command, "payload": payload}` with sorted keys and separators
`,` and `:`. An identical replay is a no-op; reuse with a different fingerprint
fails with `idempotency_conflict`.

## Error Vocabulary

Every V2 failure uses the `{ "code": string, "message": string }` error
envelope. Validation and control failures use these stable semantic codes:
`invalid_manifest`, `invalid_checkpoint`, `invalid_contract_version`,
`invalid_member_path`, `collision`, `partial_output`, `source_changed`,
`transport_failure`, `cancelled`, `idempotency_conflict`, `capability_invalid`,
`capability_version_mismatch`, `invalid_request`, `authentication_invalid`,
`authorization_denied`, `not_found`, `invalid_operation_state`, and
`operation_unavailable`. The error schema defines their bounded
machine-readable representation; transport status distinguishes malformed input
(`422`), unauthenticated or invalid capability (`401`), capability scope denial
(`403`), stale state or idempotency conflict (`409`), unavailable operation
controls (`405`), and failed dependency or I/O (`5xx`).
