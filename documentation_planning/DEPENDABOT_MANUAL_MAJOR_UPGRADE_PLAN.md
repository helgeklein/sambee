# Dependabot Manual Major Upgrade Plan

## Purpose

This document turns the current Dependabot major-version ignore list into an ordered upgrade plan.

It is intentionally delivery-oriented. The objective is not to list every available update in isolation. The objective is to define:

- the safest upgrade order
- the prerequisites and environment constraints for each slice
- the repo-specific breaking-change exposure already visible in the codebase
- the validation gates between slices
- the known blockers that make certain upgrades non-trivial

Primary source inputs:

- `.github/dependabot.yml`
- `frontend/package.json`
- `companion/package.json`
- current frontend and companion lockfiles

## Scope

This plan covers the npm dependencies currently excluded from automatic Dependabot major bumps for the frontend and companion:

- frontend: `@mui/icons-material`, `@mui/material`, `react`, `react-dom`, `react-i18next`, `react-markdown`, `react-router-dom`, `i18next`, `typescript`, `jsdom`, `@vitejs/plugin-react`, `vite`
- companion: `i18next`, `jsdom`, `@preact/preset-vite`, `typescript`, `vite`

It also covers the transitive and toolchain implications that make those upgrades manual instead of routine.

## Current Baseline

### Frontend

- `react` / `react-dom`: `18.3.1`
- `@mui/material` / `@mui/icons-material`: `5.18.0`
- `react-router-dom`: `6.30.4`
- `react-markdown`: `9.1.0`
- `react-i18next`: `15.7.4`
- `i18next`: `25.10.10`
- `jsdom`: `27.4.0`
- `typescript`: `5.9.3`
- `vite`: `8.0.16`
- `@vitejs/plugin-react`: `6.0.2`

### Companion

- `i18next`: `25.10.10`
- `jsdom`: `29.0.2`
- `typescript`: `5.9.3`
- `vite`: `6.4.2`
- `@preact/preset-vite`: `2.10.5`

### Important corrections

1. The frontend is already on the latest Vite major.
2. The frontend is already on the latest `@vitejs/plugin-react` major.
3. The companion is the only app with an actual Vite major gap.
4. The companion is already on the latest `jsdom` major and latest `@preact/preset-vite` major.

## Delivery Assumptions

- The repository can accept coordinated dependency upgrades that touch frontend, companion, CI, and Docker together when necessary.
- The repository currently runs on Node `20.20.2` locally, which satisfies the Node floor for Vite 7, Vite 8, and jsdom 29.
- CI and Docker are presently on Node 20, so upgrades that require `20.19+` are feasible without a repo-wide Node major bump.
- Major upgrades should be split into validation-sized slices, not landed as one batch.
- MUI should not be treated as a single-package bump. It is a staged migration project.

## Strategy Summary

The upgrade order should optimize for three things:

1. decouple low-risk library bumps from framework and design-system migrations
2. land toolchain shifts before the most invasive React and MUI work
3. leave the highest-surface, highest-regression slices until the codebase is otherwise current

Recommended sequence:

1. Establish and freeze the validation baseline.
2. Upgrade the i18n stack.
3. Upgrade `react-markdown`.
4. Upgrade companion Vite to v7, then decide whether Vite 8 is unblocked.
5. Upgrade TypeScript to v6.
6. Upgrade React and React DOM to v19.
7. Upgrade React Router to v7 if still outstanding after the React 19 slice.
8. Upgrade Material UI in staged majors: v5 -> v6 -> v7 -> v9.
9. Remove remaining temporary compatibility shims and Dependabot ignores that are no longer justified.

This sequence matters.

The React and MUI work should not be first. The current codebase has real MUI v5-era API usage and a still-present icons alias in Vite config, so landing smaller independent upgrades first reduces the regression surface before the larger UI migration.

## Phase 0: Baseline And Guardrails

### Goals

- make current validation green and repeatable
- confirm runtime and CI prerequisites for later toolchain upgrades
- define the rollback boundary between each later phase

### Recorded baseline

Environment baseline confirmed in the current workspace:

- local Node: `v20.20.2`
- local npm: `10.8.2`
- Docker frontend builder image: `node:20-alpine`
- GitHub Actions Node baseline: `node-version: '20'` across test, lint, companion build, dependency-security, website deploy, and Docker preview workflows

Current session validation status:

- frontend typecheck and lint: passing
- companion typecheck, lint, Clippy, Rust fmt, and Windows GNU cross-check: passing
- broader repo suite via `./scripts/test`: passing in the current session

### Baseline command set

Frontend fast gate:

```bash
cd /workspace/frontend && npx tsc --noEmit && npm run lint
```

Frontend targeted dependency-sensitive tests:

```bash
cd /workspace/frontend && npm test -- --run
```

Use a narrower Vitest slice first when a dependency change is isolated to one surface, then fall back to the full frontend test run before closing the phase.

Companion fast gate:

```bash
cd /workspace/companion && npx tsc --noEmit && npm run lint
```

Companion full validation gate:

```bash
cd /workspace/companion \
  && npx tsc --noEmit \
  && npm run lint \
  && cargo clippy --manifest-path src-tauri/Cargo.toml --lib --tests -- -D warnings \
  && cargo fmt --manifest-path src-tauri/Cargo.toml --check \
  && npm run check:rust:windows
```

Broader repo regression gate:

```bash
cd /workspace && ./scripts/test
```

This broader gate is slower and should be run at minimum after:

- toolchain phases
- React or MUI phases
- any phase that changes shared testing or build infrastructure

### Tasks

1. Treat the frontend fast gate as mandatory after every frontend dependency slice.
2. Treat the companion fast gate as mandatory after every companion dependency slice.
3. Treat the companion full validation gate as mandatory for companion toolchain changes and before closing any companion phase.
4. Treat the broader repo regression gate as mandatory after:
   - companion Vite work
   - TypeScript 6
   - React 19
   - each MUI staged-major phase
5. Keep the rollback boundary at one dependency slice per PR.
6. Do not start Phase 1 work unless these recorded gates remain green on the current mainline baseline.

### Acceptance criteria

- current frontend fast gate is green
- current companion fast gate is green
- current companion full validation gate is green
- local, Docker, and CI Node baselines are all confirmed to satisfy the later Vite and jsdom requirements
- every later phase has an explicit mandatory validation command set before merge

## Phase 1: I18n Stack Upgrade

### Status

Completed on 2026-06-21.

Implemented results:

- frontend upgraded to `i18next@26.3.1` and `react-i18next@17.0.8`
- companion upgraded to `i18next@26.3.1`
- obsolete `showSupportNotice` init option removed from frontend and companion i18n initialization
- companion preferences i18n assertions updated to use translation keys instead of stale hardcoded pseudo-localized strings

Validation status:

- frontend Phase 1 command set: passing
- companion Phase 1 command set: passing

### Target

- frontend: `i18next` `25.10.10` -> `26.3.1`
- frontend: `react-i18next` `15.7.4` -> `17.0.8`
- companion: `i18next` `25.10.10` -> `26.3.1`

### Why first

- the runtime surface is relatively contained
- `react-i18next@17` expects `i18next >= 26.2.0`, so this is a natural paired upgrade
- the repo does not currently appear to rely on advanced selector-mode features that make i18next 26 risky

### Repo-specific exposure

- frontend i18n initialization is straightforward in `frontend/src/i18n/index.ts`
- companion i18n initialization is straightforward in `companion/src/i18n/index.ts`
- no obvious custom selector-mode or `getFixedT` complexity is currently visible

### Tasks

1. Upgrade frontend `i18next` and `react-i18next` together.
2. Upgrade companion `i18next` in the same release train or immediately after.
3. Re-run localization tests and key translation smoke tests.
4. Check TypeScript inference around `keyPrefix`, `t()`, and typed resources.

### Risks

- mostly type-level changes and stricter inference
- potential regressions if translation helper wrappers assume older generic shapes

### Validation

Frontend exact commands:

```bash
cd /workspace/frontend \
  && npx vitest run \
    src/i18n/__tests__/index.test.ts \
    src/config/__tests__/browserCommands.test.ts \
    src/pages/__tests__/PreferencesSettings.test.tsx \
  && npx tsc --noEmit \
  && npm run lint
```

Companion exact commands:

```bash
cd /workspace/companion \
  && npx vitest run \
    src/i18n/__tests__/index.test.ts \
    src/components/__tests__/Preferences.test.tsx \
    src/components/__tests__/PairingWindow.test.tsx \
  && npx tsc --noEmit \
  && npm run lint
```

### Acceptance criteria

- all translation flows still resolve correctly
- typed translation calls remain green
- no runtime locale initialization regressions in frontend or companion

## Phase 2: React Markdown Upgrade

### Status

Completed on 2026-06-21.

Implemented results:

- frontend upgraded to `react-markdown@10.1.0`
- no repo-local `MarkdownViewer` code changes were required for the v10 migration

Validation status:

- targeted markdown Vitest suites: passing
- markdown Playwright suite: passing
- frontend typecheck: passing
- frontend lint: passing

### Target

- frontend: `react-markdown` `9.1.0` -> `10.1.0`

### Why here

- it is isolated compared to React and MUI
- the runtime usage surface is concentrated in one main component
- it removes a manual exclusion with comparatively low coordination cost

### Repo-specific exposure

- primary runtime usage is in `frontend/src/components/Viewer/MarkdownViewer.tsx`
- the visible custom renderer already destructures the `node` prop and does not appear to depend on removed legacy props on the root `ReactMarkdown` component

### Breaking-change focus

- v10 removed the `className` prop on the `ReactMarkdown` component itself
- the unified/remark/hast dependency stack also moves forward, so renderer typings must be revalidated

### Tasks

1. Upgrade `react-markdown`.
2. Revalidate the custom renderers in `MarkdownViewer`.
3. Re-run markdown viewer and editor tests.
4. Verify syntax highlighting and link handling behavior manually if needed.

### Validation

```bash
cd /workspace/frontend \
  && npx vitest run \
    src/components/Viewer/__tests__/MarkdownViewer.test.tsx \
    src/components/Viewer/__tests__/MarkdownRichEditor.test.tsx \
  && npm run test:e2e:markdown \
  && npx tsc --noEmit \
  && npm run lint
```

### Acceptance criteria

- markdown rendering still matches expected UI behavior
- custom link handling still works
- no renderer typing regressions remain

## Phase 3: Companion Vite Upgrade

### Status

Completed on 2026-06-21.

Implemented results:

- companion upgraded directly from `vite@6.4.2` to `vite@8.0.16`
- intermediate `vite@7.3.5` validation passed cleanly
- follow-up `vite@8.0.16` spike also passed cleanly, so the phase did not need to stop at Vite 7
- current transitive `vite-prerender-plugin` blocker assumption is no longer valid because the latest published plugin peer range includes Vite 8

Validation status:

- companion Phase 3 command set on Vite 7: passing
- companion Phase 3 command set on Vite 8: passing
- broader repo regression gate `./scripts/test`: passing

### Target

- companion: `vite` `6.4.2` -> `7.x`, then reassess `8.x`

### Why this is a staged phase

Companion Vite 8 is not just a routine bump.

The current lockfile shows a transitive constraint from `vite-prerender-plugin` through `@preact/preset-vite` usage that only peers on Vite `5.x || 6.x || 7.x`. Although `@preact/preset-vite` itself accepts Vite 8, the current installed prerender plugin constraint is a real compatibility question.

### Recommended order inside this phase

1. Move companion from Vite 6 to Vite 7.
2. Validate the existing config and plugin stack on Vite 7.
3. Audit whether the current prerender path is still required.
4. Only then decide between:
   - upgrading to Vite 8 with a compatible plugin path
   - replacing the prerender dependency
   - intentionally holding on Vite 7 and narrowing the Dependabot ignore accordingly

### Repo-specific exposure

- companion Vite config is small and simple
- most risk is transitive, not from repo-owned Vite config
- Vite 7 and 8 both require a modern Node 20 baseline, which the repo already has

### Breaking-change focus

- Vite 7 raises the Node floor to `20.19+`
- Vite 8 moves more internals to Rolldown and Oxc
- plugin compatibility is the main unknown, not app config complexity

### Tasks

1. Upgrade companion to Vite 7.
2. Re-run companion TypeScript, Vitest, lint, and Rust-adjacent validation.
3. Inspect build output for prerender-related warnings or peer mismatch issues.
4. If Vite 7 is clean, spike Vite 8 on a short-lived branch.
5. If Vite 8 is blocked by the prerender chain, either replace the plugin or freeze at Vite 7 until a compatible path is available.

### Validation

```bash
cd /workspace/companion \
  && npx vitest run \
    src/components/__tests__/AppPicker.test.tsx \
    src/components/__tests__/Preferences.test.tsx \
    src/components/__tests__/PairingWindow.test.tsx \
  && npm run build \
  && npx tsc --noEmit \
  && npm run lint \
  && cargo clippy --manifest-path src-tauri/Cargo.toml --lib --tests -- -D warnings \
  && cargo fmt --manifest-path src-tauri/Cargo.toml --check \
  && npm run check:rust:windows
```

### Acceptance criteria

- companion is on Vite 8 with a green validation suite
- Vite 8 is confirmed unblocked for the current companion dependency graph

## Phase 4: TypeScript 6 Upgrade

### Status

Completed on 2026-06-21.

Implemented results:

- frontend upgraded to `typescript@6.0.3`
- companion upgraded to `typescript@6.0.3`
- no repo-local `tsconfig` changes were required for the TS 6 migration

Validation status:

- frontend Phase 4 command set: passing
- companion Phase 4 command set: passing
- broader repo regression gate `./scripts/test`: passing

### Target

- frontend: `typescript` `5.9.3` -> `6.0.3`
- companion: `typescript` `5.9.3` -> `6.0.3`

### Why after the companion Vite move

- toolchain changes are easier to reason about if Vite and TS are not moved simultaneously in companion
- TS 6 should land before React 19 and MUI so pure compiler issues can be separated from framework API issues

### Repo-specific exposure

- both apps already set `strict`, `module`, and `moduleResolution` explicitly
- both apps already use bundler-oriented TS config
- this neutralizes many of TS 6's default changes

### Breaking-change focus

- explicit `types` lists may be needed in any config/test tsconfig that relied on implicit `@types` enumeration
- `rootDir` inference changes matter if any build output relied on old defaults
- deprecated legacy module-resolution settings must not exist in secondary tsconfigs or scripts

### Tasks

1. Upgrade TypeScript in frontend and companion.
2. Check every tsconfig for new deprecation warnings.
3. Add explicit `types` entries where TS 6 now requires them.
4. Fix any inference regressions before moving to React 19.

### Validation

Frontend exact commands:

```bash
cd /workspace/frontend \
  && npx tsc --noEmit \
  && npm run lint \
  && npx vitest run \
    src/i18n/__tests__/index.test.ts \
    src/pages/__tests__/PreferencesSettings.test.tsx
```

Companion exact commands:

```bash
cd /workspace/companion \
  && npx tsc --noEmit \
  && npm run lint \
  && npx vitest run \
    src/i18n/__tests__/index.test.ts \
    src/components/__tests__/Preferences.test.tsx
```

Broader repo gate before merge:

```bash
cd /workspace && ./scripts/test
```

### Acceptance criteria

- both apps are clean on TS 6
- no TS 6 deprecation warnings remain untriaged

## Phase 5: React 19 Upgrade

### Status

Completed on 2026-06-21.

Implemented results:

- frontend upgraded to `react@19.2.7` and `react-dom@19.2.7`
- frontend upgraded to `@types/react@19.2.17` and `@types/react-dom@19.2.3`
- React 19 test stabilization applied across async viewer and settings slices
- PDF page input handling was hardened so committed page numbers use the live input value instead of potentially stale local state
- PDF viewer focus behavior was tightened for keyboard navigation readiness by disabling dialog auto-focus and focus enforcement while the viewer content manages focus
- PDF keyboard shortcut coverage was restored with stable hook-registration assertions in the viewer and file-browser integration suites

Validation status:

- targeted React 19 frontend gate: passing
- previously failing frontend regression slice: passing
- broader repo regression gate `./scripts/test`: passing

### Target

- frontend: `react` `18.3.1` -> `19.2.7`
- frontend: `react-dom` `18.3.1` -> `19.2.7`
- frontend: `@types/react` / `@types/react-dom` to matching `19.x`

### Why after TS 6

- React 19 type changes are easier to diagnose on the intended compiler baseline
- this keeps React-specific ref and typing adjustments separate from older compiler behavior

### Repo-specific exposure

- the app already uses `createRoot`, which removes one major React 19 migration point
- no current evidence of `ReactDOM.render`, `findDOMNode`, or `react-dom/test-utils` usage in runtime code
- risk is more about types and third-party behavior than legacy root APIs

### Breaking-change focus

- React 19 requires the modern JSX transform
- updated `@types/react` introduces stricter ref and element typing
- TypeScript-level migrations may be needed around `useRef`, ref callbacks, and unsound element prop access

### Tasks

1. Upgrade `react`, `react-dom`, `@types/react`, and `@types/react-dom` together.
2. Run React codemods only if compile or runtime evidence justifies them.
3. Fix any ref callback and `useRef` typing issues.
4. Re-run focused frontend tests before proceeding to router or MUI changes.

### Validation

```bash
cd /workspace/frontend \
  && npx vitest run \
    src/__tests__/App.test.tsx \
    src/pages/__tests__/Login.test.tsx \
    src/pages/__tests__/FileBrowser-viewer.test.tsx \
    src/components/__tests__/ErrorBoundary.test.tsx \
  && npm run build \
  && npx tsc --noEmit \
  && npm run lint
```

### Acceptance criteria

- app boots cleanly on React 19
- no runtime warnings remain from removed React 18-era APIs
- type definitions are aligned with React 19

## Phase 6: React Router 7 Upgrade

### Target

- frontend: `react-router-dom` `6.30.4` -> `7.18.0`

### Why after React 19 in the recommended sequence

- the app is already partially prepared via v7 future flags
- React 19 plus Router 7 is a natural modern baseline before the MUI migration
- even though Router 7 can run on React 18, keeping it after the React 19 slice avoids mixing routing regressions into the earlier framework cutover

### Repo-specific exposure

- the app already opts into `v7_startTransition` and `v7_relativeSplatPath`
- there are many `react-router-dom` imports across the frontend, so this is not a tiny patch
- the app appears to use declarative routing, not the heavier framework-mode APIs

### Breaking-change focus

- v6 -> v7 should be manageable, but import and future-flag cleanup must be verified
- this phase should also prepare for the eventual v8 move where `react-router-dom` is removed in favor of `react-router` and `react-router/dom`

### Tasks

1. Upgrade `react-router-dom`.
2. Re-run route and navigation tests.
3. Verify the existing future flags are still correct or no longer needed.
4. Capture follow-up notes for the later v8 import migration.

### Validation

```bash
cd /workspace/frontend \
  && npx vitest run \
    src/__tests__/App.test.tsx \
    src/pages/__tests__/FileBrowser-url-routing.test.tsx \
    src/pages/__tests__/FileBrowser-navigation.test.tsx \
    src/components/Settings/__tests__/SettingsLayout.test.tsx \
    src/components/Mobile/__tests__/HamburgerMenu.test.tsx \
  && npm run build \
  && npx tsc --noEmit \
  && npm run lint
```

### Acceptance criteria

- all route imports and route tests are green
- route transitions behave correctly under the new router version
- a later v8 migration path is documented

## Phase 7: Material UI Migration Project

### Target

- frontend: `@mui/material` `5.18.0` -> `9.x`
- frontend: `@mui/icons-material` `5.18.0` -> `9.x`

### Why last

- this is the highest-surface manual upgrade in the repo
- the codebase currently uses many MUI props and patterns that newer MUI majors remove or rename
- the repo also still has an old MUI icons ESM alias in Vite config that MUI v7+ explicitly says to remove

### Required rule

Do not try to jump directly from MUI 5 to MUI 9 in one PR.

Recommended staging:

1. MUI 5 -> 6
2. MUI 6 -> 7
3. MUI 7 -> 9

### Repo-specific exposure already visible

- MUI-removed or renamed prop families are in active use across the frontend, including:
  - `PaperProps`
  - `MenuListProps`
  - `InputLabelProps`
  - `InputProps`
  - `FormHelperTextProps`
  - `TransitionComponent`
- the frontend Vite config still aliases `@mui/icons-material/esm/*`, which MUI v7 says to remove

### MUI 5 -> 6 tasks

1. Upgrade `@mui/material` and `@mui/icons-material` to v6.
2. If React 19 is not yet landed, add the MUI-documented `react-is` override matching the active React version.
3. Run MUI v6 codemods only where the codebase actually uses affected APIs.
4. Validate layout, ripple-related tests, and Grid/ListItem/Typography changes.

### MUI 6 -> 7 tasks

1. Upgrade MUI packages to v7.
2. Remove the icons ESM alias from frontend Vite config.
3. Fix package-export breakage if any deep imports exist.
4. Validate theme behavior, Grid naming, and any import-path adjustments.

### MUI 7 -> 9 tasks

1. Upgrade MUI packages to v9.
2. Apply codemods for removed deprecated props and slot migrations.
3. Replace old prop APIs with `slotProps` and `slots` where required.
4. Validate dialogs, forms, menus, tabs, steppers, table pagination, and icon imports.

### Breaking-change focus

- MUI v6 introduces Grid2 stabilization, list/button changes, typography behavior changes, and testing-related ripple changes
- MUI v7 removes deprecated APIs, changes package exports, and requires removal of older deep-import and alias assumptions
- MUI v9 removes large amounts of deprecated props in favor of `slotProps` and `slots`, changes behavior in several components, and changes supported browser baselines

### Validation

Run this command set after each staged major:

```bash
cd /workspace/frontend \
  && npx vitest run \
    src/components/Settings/__tests__/SettingsDialog.test.tsx \
    src/components/Admin/__tests__/ConnectionDialog.test.tsx \
    src/components/Admin/__tests__/ResponsiveFormDialog.test.tsx \
    src/components/FileBrowser/__tests__/ConnectionSelector.test.tsx \
    src/components/FileBrowser/__tests__/CompanionPairingDialog.test.tsx \
    src/components/Viewer/__tests__/ViewerControls.test.tsx \
    src/pages/__tests__/ConnectionSettings.test.tsx \
    src/pages/__tests__/UserManagementSettings.test.tsx \
  && npm run build \
  && npx tsc --noEmit \
  && npm run lint
```

Before merge for each staged major:

```bash
cd /workspace && ./scripts/test
```

### Acceptance criteria

- frontend is on MUI 9 with no legacy compatibility alias left in Vite config
- all slot and prop migrations are complete
- dialog, menu, form, and viewer behavior remains correct

## Phase 8: Final Cleanup

### Goals

- remove stale Dependabot ignore rules for majors already adopted
- narrow or justify any remaining ignore rules that are still intentionally manual
- document any unresolved blockers that prevented the final major bump in a category

### Tasks

1. Update `.github/dependabot.yml` after each completed major slice.
2. Remove ignore rules that are no longer needed.
3. If companion Vite remains held below 8, replace the broad ignore rationale with the exact blocking dependency and revisit trigger.
4. Record any long-term manual-upgrade categories that remain valid.

### Acceptance criteria

- Dependabot ignores reflect current reality instead of historical risk
- unresolved manual exclusions have named blockers and an explicit re-evaluation condition

## Known Blockers And Watch Items

### Companion Vite 8 blocker follow-up

- the original `vite-prerender-plugin` peer-range blocker is no longer current
- `@preact/preset-vite@2.10.5` currently resolves a `vite-prerender-plugin` release line that advertises Vite 8 compatibility
- companion validation passed on `vite@8.0.16`, so this item no longer blocks the upgrade plan

### MUI migration surface

- current frontend usage of removed prop APIs is broad enough that MUI remains a migration project, not a simple package bump

### React 19 plus MUI staging

- if any MUI stage happens before React 19 is complete, MUI's `react-is` compatibility guidance for React 18 must be followed exactly

## Recommended PR Breakdown

1. PR 1: i18next and react-i18next
2. PR 2: react-markdown
3. PR 3: companion Vite 8
4. PR 4: TypeScript 6 across frontend and companion
5. PR 5: React 19 and matching type packages
6. PR 6: React Router 7
7. PR 7: MUI 5 -> 6
8. PR 8: MUI 6 -> 7
9. PR 9: MUI 7 -> 9
10. PR 10: Dependabot cleanup and remaining-ignore reduction

## Exit Criteria

This plan is complete when:

- each ignored npm major has either been upgraded or has an explicitly documented blocker
- the remaining Dependabot ignore rules are minimal and justified
- the repo is on a coherent modern baseline for React, TypeScript, routing, and frontend tooling
