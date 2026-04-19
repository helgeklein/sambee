# Website Implementation Checklist

This checklist converts the current website design direction into build work for the Hugo site in `website/`.

Strategy note:

- this checklist is still useful as a delivery tracker
- component-boundary and reuse decisions are now governed by [Website_architecture_reset_plan.md](./Website_architecture_reset_plan.md)
- homepage parity work beyond the broad implementation phases is now governed by [Homepage_fidelity_checklist.md](./Homepage_fidelity_checklist.md)
- where this checklist assumes broad homepage/docs component sharing, follow the architecture reset plan instead

It assumes:

- homepage copy already exists in [Homepage_text_copy.md](./Homepage_text_copy.md)
- docs content planning already exists and should be treated as input rather than a missing prerequisite
- the first implementation target is the homepage
- docs pages will follow using the same design system and theme primitives
- the website should be runnable through a first-class repo-level dev script, not only from `website/package.json`

## Implementation Goals

- implement the approved "Technical Ledger" visual system in the existing `website/` Hugo theme
- ship the homepage first without creating throwaway styling that will need to be replaced for docs later
- keep docs routing, versioning, and navigation architecture intact while preparing the theme for a future docs rollout
- reuse shared site foundation and chrome across homepage and docs pages, while allowing homepage and docs to have separate composition layers
- add a reliable top-level workflow for starting the Hugo development server that matches the rest of the repository's script conventions

## Phase 0: Hugo Dev Workflow Integration

- [x] Integrate Pagefind into the normal website dev workflow so the search index is available in the dev site without a separate manual step
- [x] Keep the Pagefind index refreshed during development when Hugo rewrites generated HTML in `website/public`

- [x] Confirm the intended responsibility split between:
  - `website/package.json` scripts for site-local commands
  - top-level `scripts/` wrappers for workspace-standard entrypoints
  - VS Code tasks for one-click editor execution
- [x] Use the donor implementation in `website-temp/scripts/hugo-serve.sh` as input, but only carry forward behavior that fits the current repo:
  - keep prerequisite checks for `hugo` and `node`
  - keep dependency bootstrapping if `website/node_modules` is missing
  - keep process cleanup for prior Hugo dev instances
  - do not copy donor-specific image or Git LFS checks unless the active `website/` build actually depends on them
  - do not assume the donor's Pagefind-first `dev` flow is still the right default for Sambee
- [x] Decide the canonical command surface for local website development:
  - likely top-level script: `scripts/start-website`
  - likely underlying site command: `cd /workspace/website && npm run dev`
  - optionally add a separate search-oriented workflow only if Pagefind validation needs a distinct command path
- [x] Define exact startup behavior for `scripts/start-website`:
  - verify the command is running inside the expected dev container or otherwise fail with actionable guidance
  - verify `hugo`, `node`, and `npm` are available before attempting startup
  - change into `website/` explicitly rather than depending on caller working directory
  - install npm dependencies only when `website/node_modules` is absent
  - regenerate theme CSS through the existing npm workflow rather than duplicating generation logic in bash
  - start Hugo with host binding suitable for container access and consistent port reporting
- [x] Decide whether the wrapper should execute `npm run dev` directly or manage the underlying Hugo command itself:
  - prefer `npm run dev` if the package script remains the single source of truth
  - only move Hugo flags into bash if there is a concrete need for repo-level policy that package scripts cannot express cleanly
- [x] Review the current `website/package.json` development script against donor behavior and document which flags should be added, removed, or left alone:
  - assess `--navigateToChanged`
  - assess `--renderToMemory=false`
  - assess `--disableFastRender`
  - assess explicit `--baseURL` for local development
  - assess whether theme generation should run once or in `--watch` mode
  - implemented decision: keep `--navigateToChanged` and `--disableFastRender`
  - implemented decision: do not add `--renderToMemory=false` or an explicit local `--baseURL`
  - implemented decision: run theme generation in `--watch` mode during `npm run dev`
- [x] Define process cleanup rules so the script is safe to rerun:
  - identify the Hugo server process precisely enough to avoid killing unrelated services
  - avoid broad `pkill -f hugo` patterns that may terminate non-website commands
  - decide whether port `1313` conflicts should be handled by process matching, port probing, or both
- [x] Define output and error-handling requirements for the wrapper:
  - print the detected Hugo version and Node version
  - report whether dependencies were already present or newly installed
  - print the expected local URL and any forwarded/container-access URL guidance
  - surface startup failures with actionable next steps instead of silent exits
  - keep logging specific and operational rather than decorative
- [x] Decide whether a paired stop command is needed for the website workflow:
  - extend `scripts/dev-stop` to optionally stop the website server
  - or add a focused `scripts/stop-website` if website lifecycle should remain independent
  - document whichever lifecycle model is chosen
- [x] Add a VS Code task for the website dev server once the script contract is stable so the workflow matches backend and frontend startup conventions
- [x] Document the final workflow in the appropriate developer-facing location:
  - top-level `README.md` for discoverability if the website becomes a standard local workflow
  - `documentation_developers/DEVELOPMENT.md` if there is project-specific setup detail
  - website planning docs only for implementation sequencing, not long-term operational instructions
- [x] Verify the final design against current repository reality:
  - Hugo is already installed in the dev container
  - the active website lives in `website/`
  - the active site already has working npm scripts
  - the missing piece is orchestration and discoverability, not a completely new build pipeline

## Phase 1: Theme Foundations

- [x] Expand the theme token model in `website/data/theme.json` to support ledger-style semantic tokens for:
  - primary action
  - action container
  - page surface
  - nested surfaces
  - strong and soft outlines
  - primary text and muted text
  - docs callout/status colors
- [x] Update `website/scripts/themeGenerator.js` so the generated CSS exposes the new semantic tokens for both light and dark mode
- [x] Regenerate `website/assets/css/generated-theme.css` from the updated theme data
- [x] Replace the current default font stack with the approved families:
  - Newsreader for display and editorial headings
  - Work Sans for body text
  - Space Grotesk for labels, metadata, and technical annotations
- [x] Update global base styling in `website/themes/sambee/assets/css/base.css` to enforce ledger rules:
  - zero-radius UI
  - stronger border usage
  - no shadow-based hierarchy
  - tighter editorial spacing
- [x] Audit the existing CSS for rounded cards, soft panels, and shadow-based emphasis and remove or replace those patterns

## Phase 2: Shared Site Chrome

- [x] Restyle the shared header in `website/themes/sambee/layouts/partials/essentials/header.html` and related CSS so it matches the design system:
  - hard structural borders
  - compact label-style navigation
  - rectangular search control
  - stronger active-state treatment
- [x] Verify the logo treatment works in both light and dark mode in `website/themes/sambee/layouts/partials/logo.html`
- [x] Restyle the footer in `website/themes/sambee/layouts/partials/essentials/footer.html` to fit the ledger system instead of the current generic footer shell
- [x] Update navigation styling in `website/themes/sambee/assets/css/navigation.css` so mobile and desktop navigation both follow the same visual language
- [x] Keep the existing menu and search behavior unless a visual requirement clearly forces a structural change

## Phase 3: Shared Layout Primitives

- [x] Replace the current rounded-card utility patterns in `website/themes/sambee/assets/css/shared.css` with reusable ledger primitives for:
  - section shells
  - eyebrow labels
  - rule-based dividers
  - grid cells
  - CTA bands
  - metadata chips
  - tabular or matrix blocks
- [x] Define a consistent set of spacing, border, and surface conventions for homepage sections and future docs shells
- [x] Introduce reusable classes or partial-friendly wrappers for asymmetrical grid layouts used by the homepage design
- [x] Make dark-mode support complete at the token and component level even if the public default remains light mode

## Phase 4: Homepage Content Wiring

- [x] Decide how homepage structured content is sourced in Hugo:
  - front matter on `website/content/_index.md`
  - data file in `website/data/`
  - partial-local data structure
- [x] Map the existing homepage copy in [Homepage_text_copy.md](./Homepage_text_copy.md) to concrete homepage sections and content fields
- [x] Identify which homepage sections need structured repeatable data rather than raw markdown blocks
- [x] Confirm CTA destinations for homepage buttons and section links
- [x] Confirm which homepage visual elements need local assets rather than placeholder blocks

## Phase 5: Homepage Build

- [x] Rebuild `website/themes/sambee/layouts/home.html` around the approved section order
- [x] Implement the hero section with final homepage copy and production CTA targets
- [x] Implement the problem-gap-value triptych section
- [x] Implement the core benefits grid
- [x] Implement the features overview section
- [x] Implement the preview-support or viewer-support matrix
- [x] Implement the companion-app section
- [x] Implement the self-hosted CTA section
- [x] Implement the environment-fit section
- [x] Implement the final CTA band
- [ ] Ensure the homepage remains strong on mobile and does not collapse into stacked generic cards
- [x] Ensure the homepage uses local assets and production-safe icons instead of remote placeholder resources

## Phase 6: Homepage QA And Hardening

- [ ] Validate homepage behavior across desktop, tablet, and mobile breakpoints
- [ ] Validate light and dark mode rendering for all homepage sections
- [ ] Check typography rhythm, section spacing, and border consistency against the design direction
- [ ] Verify search trigger, navigation interactions, and CTA links still work after the visual refactor
- [ ] Remove obsolete homepage CSS and markup left behind by the previous design layer

## Phase 7: Docs Theme Preparation

- [ ] Keep the existing docs routing and version architecture intact
- [ ] Restyle the docs shell in:
  - `website/themes/sambee/layouts/docs/list.html`
  - `website/themes/sambee/layouts/docs/single.html`
  - `website/themes/sambee/layouts/partials/docs/sidebar.html`
  - `website/themes/sambee/layouts/partials/docs/version-switcher.html`
- [ ] Introduce ledger-style docs shell primitives for:
  - sidebar framing
  - breadcrumb row
  - page header band
  - version badges
  - on-this-page rail
- [ ] Keep the docs templates shared across books and versions; do not fork a separate style path per docs area

## Phase 8: Docs Content Primitives

- [ ] Restyle long-form content in `website/themes/sambee/assets/css/content.css` to support the ledger documentation look
- [ ] Add production-ready styling for:
  - tables
  - inline code
  - code blocks
  - blockquotes
  - lists
  - definition lists
  - keyboard input elements
- [ ] Add or refine admonition support for note, tip, info, warning, and danger blocks
- [ ] Define how docs content authors should produce those admonitions in markdown or Hugo shortcodes
- [ ] Ensure docs tables and code blocks remain usable on narrow screens

## Phase 9: Docs Rollout

- [ ] Apply the updated docs shell to the existing docs pages without changing URL structure
- [ ] Start with one representative docs book or section to validate the design system on real content
- [ ] Verify version switcher behavior still works correctly across equivalent pages
- [ ] Verify sidebar ordering and active-state behavior still follow the current docs navigation data
- [ ] Expand the updated shell and content primitives across all docs books after the pilot section is stable

## Phase 10: Cleanup And Validation

- [ ] Remove obsolete CSS rules and markup patterns that no longer belong to the active design system
- [ ] Run the website build and confirm the Hugo pipeline still generates the site correctly
- [ ] Run the final top-level website startup script from the repo root and confirm it starts the Hugo dev server without manual directory changes
- [ ] Re-run the startup script to confirm duplicate-process cleanup and idempotent dependency checks behave correctly
- [ ] Run lint or other relevant frontend checks used by the website project
- [ ] Review the generated site for visual regressions and broken internal links
- [ ] Update planning docs if implementation decisions materially change the intended build sequence

## Suggested Execution Order

1. Hugo dev workflow integration
2. Theme foundations
3. Shared site chrome
4. Shared layout primitives
5. Homepage content wiring
6. Homepage build
7. Homepage QA and cleanup
8. Docs theme preparation
9. Docs content primitives
10. Docs rollout
11. Final cleanup and validation

## Explicit Non-Goals For The First Pass

- Do not redesign docs routing, version metadata, or navigation data structures
- Do not postpone homepage work waiting for new copy
- Do not create a homepage-only visual language that cannot be reused by docs later
- Do not rely on prototype-only remote assets in production templates
