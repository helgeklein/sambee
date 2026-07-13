# Companion Remaining Audit Triage Plan

## Scope

This plan covers the `cargo audit` findings that remained after the companion security remediation work in `COMPANION_SECURITY_AUDIT_UPGRADE_PLAN.md`.

Status:

- Phase 1 has been applied in the current branch.
- `anyhow` was updated to `1.0.103`.
- `uds_windows` was updated to `1.2.1`.
- Native and Windows-target companion builds still pass after those updates.
- The remaining findings are the GTK3 / `glib` / `unic-*` / `fxhash` / `rand 0.7` / `instant` groups described below.

The original high-severity findings for `quick-xml`, `quinn-proto`, and `rustls-webpki` were already resolved. What remains is a mix of:

- low-risk lockfile refresh opportunities
- direct-dependency upgrade candidates
- upstream Tauri / WRY / GTK3 ecosystem warnings that are not realistically fixable only inside this repository

## Triage Summary

### Can be fixed locally with low risk

1. `anyhow 1.0.102` (`RUSTSEC-2026-0190`)
   - `cargo update -n -p anyhow` resolves to `1.0.103`
   - reverse dependency ownership is broad but still entirely transitive through the current Tauri stack
   - this should be treated as a lockfile-only patch update

2. `uds_windows 1.2.0` (yanked)
   - `cargo update -n -p uds_windows` resolves to `1.2.1`
   - path: `tauri-plugin-single-instance -> zbus -> uds_windows`
   - this is also a lockfile-only refresh candidate

### Needs a deliberate dependency decision in this repo

3. `instant 0.1.13` (`RUSTSEC-2024-0384`)
   - path: `notify-types -> notify 7.0.0 -> sambee-companion`
   - `notify` is a direct dependency in the companion manifest
   - no compatible update was available from the current lockfile state
   - likely resolution path is evaluating a newer `notify` release line rather than a plain lockfile refresh

### Effectively upstream-blocked in the current Tauri line

4. GTK3 / glib / proc-macro stack
   - advisories include `atk`, `atk-sys`, `gdk`, `gdk-sys`, `gdkwayland-sys`, `gdkx11`, `gdkx11-sys`, `gtk`, `gtk-sys`, `gtk3-macros`, `glib`, and `proc-macro-error`
   - these are pulled in by Linux desktop integration through `wry`, `webkit2gtk`, `tao`, `tray-icon`, `rfd`, and Tauri runtime crates
   - current ownership chain is fundamentally:
     - `tauri -> tauri-runtime-wry -> wry -> webkit2gtk / gtk3 family`
     - plus `tauri -> tray-icon / muda / rfd -> gtk3 family`
   - there were no compatible updates available for `tauri-utils`, `tauri-runtime-wry`, or the current Tauri line that would remove these warnings
   - a dry run showed `wry 0.55.1` is available, but there is no evidence that this alone removes the GTK3-based warnings

5. `unic-*`, `fxhash`, and `rand 0.7.3`
   - `unic-char-property`, `unic-char-range`, `unic-common`, `unic-ucd-ident`, `unic-ucd-version`
   - `fxhash 0.2.1`
   - `rand 0.7.3`
   - paths:
     - `urlpattern 0.3.0 -> tauri-utils / tauri-plugin-http`
     - `selectors 0.24.0 -> kuchikiki -> tauri-utils`
   - `cargo update -n -p urlpattern` and `cargo update -n -p tauri-utils` did not find compatible fixes
   - these findings should be treated as Tauri / `tauri-utils` upstream dependency debt for the current major line

## Recommended Execution Order

### Phase 1: Safe lockfile refreshes

Apply these first and re-run validation:

1. `cargo update -p anyhow`
2. `cargo update -p uds_windows`

Validation:

- `cd companion/src-tauri && cargo check`
- `cd companion/src-tauri && cargo check --target x86_64-pc-windows-gnu`
- `cd companion/src-tauri && cargo audit`

Expected result:

- clears the `anyhow` advisory
- clears the `uds_windows` yanked warning
- leaves the Tauri / GTK3 / `tauri-utils` findings unchanged

Observed result in this branch:

- matched expectation
- `cargo audit` no longer reports `RUSTSEC-2026-0190` for `anyhow`
- `cargo audit` no longer reports the `uds_windows` yanked warning

### Phase 2: Direct dependency review for file watching

Investigate the direct `notify` dependency used by the companion.

Tasks:

1. determine whether the current code actually needs APIs that pin us to `notify 7`
2. test a branch upgrade to the latest `notify` major that is compatible with current code
3. if the API delta is small, upgrade and re-run audit
4. if the delta is large, document `instant` as a temporary accepted risk tied to the file-watching subsystem

Reason:

- unlike the GTK3 findings, this path is repo-owned because `notify` is declared directly by the companion

### Phase 3: Upstream Tauri-stack tracking

Open a dedicated dependency-tracking item for the current Tauri desktop stack.

Track these owners:

1. `tauri`
2. `tauri-runtime-wry`
3. `wry`
4. `tauri-utils`
5. `tauri-plugin-http`
6. `tauri-plugin-dialog`
7. `tauri-plugin-single-instance`

Goal:

- upgrade to a Tauri / WRY line that removes or replaces the GTK3 and legacy parsing dependency chains on Linux
- upgrade to a `tauri-utils` line that no longer pulls `urlpattern 0.3.0` and `kuchikiki/selectors` with the current unmaintained leaf crates

Practical note:

- these should not be mixed into small security patch work
- this is a framework-stack maintenance project and likely needs broader Linux desktop regression testing

## Suggested Acceptance Policy Until Upstream Fixes Land

If CI must stay green while waiting on upstream:

1. treat `anyhow` and `uds_windows` as must-fix now
2. treat `notify` / `instant` as a repo-owned follow-up decision
3. treat GTK3 / `glib` / `unic-*` / `fxhash` / `rand 0.7` warnings as temporarily accepted upstream debt, with explicit tracking tied to future Tauri upgrades

## Evidence Gathered

The following dry-run checks informed this plan:

- `cargo update -n -p anyhow` -> updates to `1.0.103`
- `cargo update -n -p uds_windows` -> updates to `1.2.1`
- `cargo update -n -p notify` -> no compatible update found in current graph
- `cargo update -n -p urlpattern` -> no compatible update found in current graph
- `cargo update -n -p tauri-utils` -> no compatible update found in current graph
- `cargo update -n -p tauri-runtime-wry` -> no compatible update found in current graph
- `cargo update -n -p wry` -> `0.55.1` available, but not enough evidence that it resolves the GTK3-family warnings

## Decision

The remaining audit work should be handled in two tracks:

1. a short patch pass for `anyhow` and `uds_windows`
2. a separate Tauri-stack modernization effort for the Linux GTK3 and `tauri-utils` warning families
