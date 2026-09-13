# Dependabot Backend Lockfile Simplification Plan

## Status

Proposed for review.

## Purpose

Remove the manual step of checking out each backend Dependabot pull request and
running `scripts/refresh-backend-lockfiles` before it can merge.

Dependabot already supports `pip-compile` lockfiles and updates the relevant
`.lock.txt` file in its backend `pip` pull requests. The current friction is
the repository-specific freshness gate, which requires its output to match a
new clean dependency resolution at CI time.

The goal is to accept Dependabot's valid lockfile output while retaining the
useful safety properties of the current workflow:

- direct dependency pins and generated lockfiles stay aligned
- runtime and development dependency locks are actually installable
- hash-enforced installs remain mandatory
- intentional full dependency refreshes remain available

## Current State

`scripts/refresh-backend-lockfiles` compiles both lockfiles into an empty
temporary directory using Python 3.13, `pip-tools==7.5.3`, and
`--generate-hashes`. Its `--check` mode compares that newly resolved graph
byte-for-byte with the committed lockfiles.

This is stricter than checking whether a lockfile is valid. A new compatible
transitive release can change the clean resolution after Dependabot has created
its pull request. The pull request then needs a manual refresh even though
Dependabot has updated the direct requirement and generated a hash-locked
lockfile.

The existing CI already validates real installations:

- the backend test image installs `requirements-dev.lock.txt` with
  `--require-hashes`
- the Docker image validation workflow builds and starts the production image,
  which installs `requirements.lock.txt` with `--require-hashes`

## Proposed Changes

### Keep Dependabot Configuration Unchanged

Do not change `.github/dependabot.yml` for this work. The existing backend
`pip` entry already discovers and updates the pip-compile inputs and lockfiles.

Keep the `pydantic-core` ignore rule. It prevents an invalid transitive-only
update that conflicts with the direct `pydantic` version; it is unrelated to
lockfile freshness.

### Replace the Fresh-Resolution Gate

Retain `.github/workflows/check-backend-lockfiles.yml` and its established
`CI: Check Backend Lockfiles` status-check name. Replace
`scripts/refresh-backend-lockfiles --check` with:

```bash
python3 scripts/verify-backend-lockfiles.py
```

The workflow must retain path filters for:

- `backend/requirements.txt`
- `backend/requirements-dev.txt`
- `backend/requirements.lock.txt`
- `backend/requirements-dev.lock.txt`
- `scripts/verify-backend-lockfiles.py`

Remove the runtime-Python setup action and its related path filters from this
workflow. The new verifier is static and does not resolve or install packages.
It must use the runner's `python3`; it must not refer to `backend/.venv`, which
is not created in this workflow. Keeping the established workflow name avoids
requiring a branch-protection configuration change.

### Add a Narrow Source-to-Lock Verifier

Add `scripts/verify-backend-lockfiles.py`. It should use only the Python
standard library and validate the repository's deliberately restricted input
format rather than attempt to implement a general dependency resolver.

The verifier must:

1. Accept blank lines and comments in the two source requirement files.
2. Accept exact direct pins in the existing form: `name==version` and
   `name[extras]==version`.
3. Canonicalize distribution names according to PEP 503 for comparison, while
   ignoring extras when matching the installed distribution name.
4. Parse pip-compile lock entries and their SHA-256 hash continuation lines.
5. Confirm every runtime direct pin appears at the same version in both the
   runtime and development locks.
6. Confirm every development direct pin appears at the same version in the
   development lock.
7. Confirm every parsed lock entry has at least one SHA-256 hash.
8. Reject unsupported source requirement syntax with a specific message that
   asks the contributor to extend the verifier deliberately.

The verifier must fail with actionable messages that identify the source file,
dependency, expected version, target lockfile, and observed state. It must not
rewrite files or invoke pip.

The verifier does not attempt to prove the full transitive graph is valid.
That responsibility remains with the existing hash-enforced Docker builds.

### Retain Existing Installation Checks

Do not add another full `pip install` job to the replacement workflow.

The existing required pull-request checks already validate the two deployment
contexts using the actual Docker build paths. The backend test workflow covers
the development lock; Docker image validation covers the production lock and
starts the resulting image. These checks must remain required.

## Refresh Script Policy

Keep `scripts/refresh-backend-lockfiles`, including `--check`, as an opt-in
maintenance tool. Use it for:

- intentional full transitive dependency refreshes
- manual changes to backend dependency sources
- resolving a compatibility conflict that Dependabot cannot resolve
- investigating a suspected stale or malformed lockfile

Do not require it for routine Dependabot backend pull requests.

## Tests and Validation

Add focused unit tests for the verifier covering:

- valid runtime and development source-to-lock alignment
- missing direct package entry
- mismatched direct package version
- runtime package absent from the development lock
- missing SHA-256 hash
- extras and normalized package-name matching
- unsupported source requirement syntax

Validate the complete change by:

1. Running the new verifier against the current repository.
2. Running its unit tests.
3. Running the existing backend test workflow or its local equivalent.
4. Building the production Docker target or running the Docker image validation
   workflow equivalent.
5. Checking a historical Dependabot backend commit that changes both a source
   file and lockfile; the verifier should accept it without a local refresh.
6. Confirming that changing only a source pin or only a direct lock entry fails
   the verifier.

## Documentation

Update the current dependency-update workflow documentation to state that:

- Dependabot's generated backend lockfiles are accepted when validation passes.
- the CI contract is direct-source-to-lock alignment plus hash-enforced image
  installation, not a clean re-resolution at each pull request.
- `scripts/refresh-backend-lockfiles` is an explicit full-refresh tool, not a
  required step for ordinary Dependabot pull requests.

Use the documentation-update workflow and refresh any required derived
artifacts when making that documentation change.

## Non-Goals

- changing the project from pip-tools to another dependency manager
- allowing lockfile-only `pydantic-core` updates
- auto-merging Dependabot pull requests
- weakening `--require-hashes` installation requirements
- automating a new clean dependency resolution on every Dependabot pull request
