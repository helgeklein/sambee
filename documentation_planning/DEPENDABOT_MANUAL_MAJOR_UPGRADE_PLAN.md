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

### Tasks

1. Record the current baseline validation commands:
   - frontend typecheck and lint
   - targeted frontend Vitest slices
   - companion typecheck, lint, and Rust validation suite
2. Confirm Node 20.19+ everywhere that matters:
   - local dev
   - Docker image build
   - GitHub Actions workflows
3. Decide which validation suite is mandatory after every dependency slice.
4. Do not start any migration slice until that baseline is consistently green.

### Acceptance criteria

- current frontend validation is green
- current companion validation is green
- no later phase depends on an unverified environment assumption

## Phase 1: I18n Stack Upgrade

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

1. Frontend unit tests covering i18n setup and common UI renders.
2. Companion i18n tests.
3. Full frontend typecheck.
4. Companion typecheck.

### Acceptance criteria

- all translation flows still resolve correctly
- typed translation calls remain green
- no runtime locale initialization regressions in frontend or companion

## Phase 2: React Markdown Upgrade

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

1. Targeted markdown-related Vitest suites.
2. Full frontend typecheck.
3. Frontend lint.

### Acceptance criteria

- markdown rendering still matches expected UI behavior
- custom link handling still works
- no renderer typing regressions remain

## Phase 3: Companion Vite Upgrade

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

1. `npx tsc --noEmit`
2. companion tests
3. companion lint
4. full companion validation suite

### Acceptance criteria

- companion is on Vite 7 with a green validation suite
- Vite 8 has a documented go/no-go decision with the actual blocker named

## Phase 4: TypeScript 6 Upgrade

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

1. frontend typecheck
2. companion typecheck
3. frontend lint
4. companion lint

### Acceptance criteria

- both apps are clean on TS 6
- no TS 6 deprecation warnings remain untriaged

## Phase 5: React 19 Upgrade

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

1. frontend typecheck
2. targeted frontend tests for rendering-heavy surfaces
3. frontend lint
4. smoke-check app boot and major routes

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

1. routing-related frontend tests
2. full frontend typecheck
3. smoke-check route transitions and browser navigation

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

1. frontend typecheck after each staged major
2. frontend lint after each staged major
3. targeted tests for viewer dialogs, settings dialogs, forms, menus, and navigation controls
4. manual smoke pass on core settings and file-browser flows after each staged major

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

### Companion Vite 8 blocker candidate

- `vite-prerender-plugin` in the current companion dependency graph only advertises Vite `5.x || 6.x || 7.x`
- this must be resolved or replaced before treating companion Vite 8 as routine

### MUI migration surface

- current frontend usage of removed prop APIs is broad enough that MUI remains a migration project, not a simple package bump

### React 19 plus MUI staging

- if any MUI stage happens before React 19 is complete, MUI's `react-is` compatibility guidance for React 18 must be followed exactly

## Recommended PR Breakdown

1. PR 1: i18next and react-i18next
2. PR 2: react-markdown
3. PR 3: companion Vite 7
4. PR 4: companion Vite 8 spike or blocker documentation
5. PR 5: TypeScript 6 across frontend and companion
6. PR 6: React 19 and matching type packages
7. PR 7: React Router 7
8. PR 8: MUI 5 -> 6
9. PR 9: MUI 6 -> 7
10. PR 10: MUI 7 -> 9
11. PR 11: Dependabot cleanup and remaining-ignore reduction

## Exit Criteria

This plan is complete when:

- each ignored npm major has either been upgraded or has an explicitly documented blocker
- the remaining Dependabot ignore rules are minimal and justified
- the repo is on a coherent modern baseline for React, TypeScript, routing, and frontend tooling