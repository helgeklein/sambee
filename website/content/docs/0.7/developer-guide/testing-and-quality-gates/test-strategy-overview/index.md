+++
title = "Test Strategy Overview"
description = "Choose the right checks for backend, frontend, companion, and website changes, and understand when cross-boundary validation is required."
+++

Sambee has multiple subsystems, so the right validation strategy depends on which contract you changed.

## Start With The Smallest Relevant Set

Do not default to either no validation or every possible check.

- docs-only website change: build the website
- backend-only change with no shared contract impact: run backend tests and type checking
- frontend-only change: run frontend tests, type check, and lint
- companion-only change: run companion checks and Rust tests
- shared workflow change: run every affected subsystem's checks

## Recommended Checks By Change Area

| Change area | Baseline checks |
|---|---|
| Backend behavior | `cd backend && pytest -v`, `cd backend && mypy app` |
| Frontend behavior | `cd frontend && npm test`, `cd frontend && npx tsc --noEmit`, `cd frontend && npm run lint` |
| Companion behavior | `cd companion && npx tsc --noEmit`, `cd companion && npm run lint`, `cd companion/src-tauri && cargo test` |
| Website or docs content | `cd website && npm run build` |

## Cross-Boundary Changes Need Cross-Boundary Checks

Run broader coverage when you change a shared contract, for example:

- backend response shape that the frontend consumes
- companion behavior that changes browser-facing pairing or editing flows
- localization or logging behavior that spans more than one app
- docs navigation or docs-version behavior that affects generated site structure

## Contract-Sensitive Areas

### API Contracts

Frontend and backend compatibility depends on stable response shapes and matching types. Contract tests are part of that protection, especially for typed frontend service behavior.

### Localization

Localization is treated as typed product behavior, not just string replacement. If you touch translation wiring or browser-to-companion localization sync, validate the relevant frontend and companion checks.

### Logging And Diagnostics

Logging changes can affect both local debugging and backend trace collection. Validate the app surfaces that consume those logging contracts.

### Docs System

Website changes are not “just markdown” if they affect docs structure, navigation, inheritance, or build scripts. Use the full website build so validation, materialization, and Hugo rendering all run.

## Practical Selection Rule

Use this decision order:

1. Identify which subsystem changed directly.
2. Identify which other subsystem consumes the changed contract.
3. Run baseline checks for the changed subsystem.
4. Add checks for every subsystem whose contract might now be wrong.

## When To Go Beyond The Baseline

Run deeper or wider validation when:

- the change affects a high-risk workflow such as file editing, locking, upload, or pairing
- you changed dependencies or version metadata
- you changed typed API contracts
- you touched build scripts or docs generation behavior
- the change fixes a regression that previously escaped narrower coverage

The goal is not maximum command count. The goal is to prove the changed behavior still matches Sambee's cross-app contracts.

## Go Deeper

- [Logging And Localization](../../cross-cutting-systems/logging-and-localization/): shared cross-boundary rules that often expand the validation surface
- [How To Plan And Review A Change](../../contribution-workflows/how-to-plan-and-review-a-change/): decide scope and docs impact before choosing checks
- [Dependency And Release Workflow](../../release-and-versioning/dependency-and-release-workflow/): use this when version metadata or reviewed dependency inputs are part of the change
