# Hugo Migration Plan For Sambee Website

## Goal

Build a new Hugo site for Sambee inside this repository, using `website-temp` only as a donor for reusable theme and build pieces.

The migration should produce a clean `website/` directory with:

- a Sambee-specific custom theme
- versioned docs with plain version slugs such as `1.0` and `1.1`
- Pagefind search
- no comments system
- no PWA support
- no dependency on helgeklein.com content, branding, or deployment assumptions

## Fixed Decisions

These are no longer open questions.

- Production domain: `https://sambee.net/`
- Site generator: Hugo with a custom theme
- Theme source: extracted from `website-temp`, then renamed and cleaned up
- Search: keep Pagefind
- Comments: none
- PWA: none
- Docs storage model: version-first under `docs/`
- Version slug format: `1.0`, `1.1`, and similar; no `v` prefix
- Initial scaffolded version set: `1.0` only
- Current version at scaffold start: `1.0`
- Unversioned docs book routes use hard redirects to the current version
- Search default scope inside docs: current version only
- All docs books share one template initially
- Start with the smallest practical Hugo module and tooling set
- Deployment model should broadly mirror the source site approach
- Docs books within each version:
  - `end-user`
  - `admin`
  - `developer`

## Current Implementation Status

Status legend used below:

- `implemented`: present in `website/` today
- `partial`: started and usable, but not fully aligned with the target plan yet
- `not started`: still planned work

Current snapshot as of 2026-04-09:

- `implemented`: clean `website/` Hugo site scaffold exists
- `implemented`: active theme is `sambee`
- `implemented`: initial versioned docs tree exists under `content/docs/1.0/`
- `implemented`: `data/docs-versions.toml` and `data/docs-nav/1.0.toml` exist
- `implemented`: docs sidebar, version switcher, and unversioned book redirects exist
- `implemented`: build scripts include Pagefind
- `implemented`: comments and PWA wiring are absent from the active site
- `partial`: donor theme extraction is in place, but final cleanup is not complete yet
- `partial`: docs behavior is present, but breadcrumbs, version-status banners, and stronger search/version integrity behavior are still missing
- `partial`: placeholder homepage and docs content exist, but the migration is not content-complete or hardened

## Donor Site Assessment

`website-temp` is a complete production Hugo website, not a reusable theme package.

What is useful:

- `themes/helgeklein/layouts`
- `themes/helgeklein/layouts/_partials`
- `themes/helgeklein/assets`
- `themes/helgeklein/i18n`
- `data/theme.json`
- `scripts/themeGenerator.js`
- selected search UI and Pagefind-related assets

What is donor-specific and must not be carried over as active implementation:

- helgeklein.com branding, title, metadata, menus, legal/footer assumptions, and social links
- Giscus configuration
- PWA wiring and manifest
- blog-centric content model and templates
- generated outputs and local tooling state such as `public`, `resources`, `node_modules`, `.hugo_build.lock`, and `hugo_stats.json`
- deployment or storage assumptions tied to Cloudflare R2 or the original site

The critical mismatch is structural, not stylistic: the donor site is blog-first, while Sambee needs a docs-first product site with explicit documentation versioning.

## Target Architecture

### Directory Layout

The new site should live in `website/` with this structure:

```text
website/
|-- archetypes/
|-- assets/
|-- config/
|   `-- _default/
|-- content/
|   |-- _index.md
|   `-- docs/
|       |-- _index.md
|       |-- 1.0/
|       |   |-- _index.md
|       |   |-- end-user/
|       |   |   `-- _index.md
|       |   |-- admin/
|       |   |   `-- _index.md
|       |   `-- developer/
|       |       `-- _index.md
|-- data/
|   `-- docs-versions.toml
|-- layouts/
|-- static/
|-- themes/
|   `-- sambee/
|       |-- assets/
|       |-- i18n/
|       `-- layouts/
|-- scripts/
|-- hugo.toml
|-- go.mod
|-- go.sum
|-- package.json
`-- package-lock.json
```

### Routing Model

Canonical docs URLs must be versioned.

Examples:

- `/docs/1.0/end-user/`
- `/docs/1.0/end-user/install/`
- `/docs/1.0/admin/configuration/`
- `/docs/1.0/developer/architecture/`

Unversioned docs book routes are convenience entry points, not canonical content locations.

Examples:

- `/docs/end-user/` -> hard redirect to `/docs/1.0/end-user/`
- `/docs/admin/` -> hard redirect to `/docs/1.0/admin/`
- `/docs/developer/` -> hard redirect to `/docs/1.0/developer/`

There must not be duplicate full content trees at both versioned and unversioned URLs.

### Hugo Content Rules

- Use `_index.md` for the docs root, each version root, and each docs book root.
- Keep versioned docs pages under `content/docs/<version>/<book>/...`.
- Keep relative page structure aligned across versions whenever the same conceptual page exists in multiple releases.
- Use page bundles for pages with version-specific assets such as screenshots or downloadable files.

### Version Metadata

`data/docs-versions.toml` should be the single source of truth for visible and supported versions.

It should define at least:

- `current`
- ordered list of versions from newest to oldest
- display label per version
- support status per version, such as `current`, `supported`, `unsupported`, or `archived`
- optional release and end-of-support dates

Suggested status policy:

- `current`: default target for unversioned docs routes, visible in switcher, indexed by search, no outdated-version warning
- `supported`: still maintained, visible in switcher, optionally indexed, warning banner shown when it is not the current version
- `unsupported`: published for reference, warning banner shown, excluded from default search scope
- `archived`: still reachable by direct link if retained, hidden from normal switcher and excluded from search

Recommended shape:

```toml
current = "1.0"

[[versions]]
slug = "1.0"
label = "1.0"
status = "current"
searchable = true
```

### Navigation And Ordering Strategy

Use an explicit ordered navigation definition as the source of truth for docs ordering.

Why this is the best fit:

- Inferred ordering from the filesystem or page metadata is harder to audit once the docs grow.
- Docusaurus uses explicit sidebars when strict ordered reader flow matters.
- Hugo menu guidance recommends using one consistent definition method across the site rather than mixing approaches.
- Read the Docs emphasizes that readers need a clear, stable structure to navigate successfully.

Recommended rule set:

- maintain one ordered navigation file per docs version
- each navigation file defines the exact order of books, sections, and pages
- page references in the navigation file should use stable `doc_id` values
- the filesystem groups content, but it is not the final source of sidebar ordering truth
- one shared docs template renders navigation for all books

Recommended navigation data layout:

```text
website/
|-- data/
|   |-- docs-versions.toml
|   `-- docs-nav/
|       `-- 1.0.toml
```

Recommended `data/docs-nav/1.0.toml` shape:

```toml
[[books]]
slug = "end-user"
title = "End-User"
landing_doc_id = "end-user-index"

  [[books.sections]]
  title = "Getting Started"
  doc_ids = ["install", "first-login", "browse-files"]

  [[books.sections]]
  title = "Editing"
  doc_ids = ["edit-markdown", "open-in-desktop-app"]

[[books]]
slug = "admin"
title = "Admin"
landing_doc_id = "admin-index"
```

Operational rules:

- every page visible in docs navigation must appear exactly once in the corresponding version navigation file
- order is determined first by the navigation file, not by folder name or title
- do not use `weight` for docs ordering in front matter or navigation data
- the navigation file should be validated in CI against the existing docs pages for that version

This gives Sambee the explicit first, second, third ordering you asked for without making URL structure or titles carry the burden of navigation control.

### Docs Page Front Matter Contract

Every versioned docs page should include:

- `title`
- `doc_id`: stable across versions for the same conceptual page
- `product_version`: same value as the version folder, for example `1.0`
- `book`: one of `end-user`, `admin`, or `developer`

Optional fields:

- `layout`
- `description`
- `version_aliases`
- `legacy_paths`

Notes:

- `doc_id` is not the same as a slug. A slug controls the URL path for one page version. `doc_id` identifies the conceptual document across versions so the switcher can find the equivalent page even if titles or slugs change.
- Docs ordering should come only from `data/docs-nav/<version>.toml` so there is no second ordering system to reconcile later.

Example:

```toml
+++
title = "Install Sambee"
doc_id = "install"
product_version = "1.0"
book = "end-user"
+++
```

### Version Switcher Rules

- Show the version switcher only on docs pages.
- Populate the switcher from `data/docs-versions.toml`.
- Resolve the same page in another version by matching:
  - `doc_id`
  - `book`
  - selected version slug
- If no equivalent page exists, send the user to that version’s book landing page.
- Mark outdated versions visibly in the UI.

### Search Rules

Pagefind is mandatory.

Search must:

- index docs version and book metadata
- default to the current page’s version only when the user is inside docs
- label results with version information
- exclude versions marked as not searchable in `data/docs-versions.toml`

## Migration Scope

### Copy Early

- `implemented`: `website-temp/themes/helgeklein/assets/**` -> `website/themes/sambee/assets/**`
- `implemented`: `website-temp/themes/helgeklein/i18n/**` -> `website/themes/sambee/i18n/**`
- `implemented`: `website-temp/themes/helgeklein/layouts/**` -> `website/themes/sambee/layouts/**`
- `implemented`: `website-temp/data/theme.json` -> `website/data/theme.json`
- `implemented`: `website-temp/scripts/themeGenerator.js` -> `website/scripts/themeGenerator.js`
- `implemented`: Pagefind-related UI assets are wired into the current site build

### Recreate Manually

- `implemented`: `website/hugo.toml`
- `implemented`: `website/config/_default/params.toml`
- `implemented`: `website/config/_default/menus.en.toml`
- `implemented`: `website/config/_default/module.toml`
- `implemented`: `website/data/docs-versions.toml`
- `implemented`: `website/data/docs-nav/1.0.toml`
- `partial`: `website/content/**` exists for the homepage and initial `1.0` docs tree, but content migration is still incomplete

### Defer Until Needed

- `not started`: `.htmltest.yml`
- `not started`: `tests/test_menu_urls.py`
- `not started`: optional Hugo modules such as `videos`, `site-verifications`, and `button`

### Do Not Carry Over

- donor site content
- donor menus and legal/footer assumptions
- blog templates and related-post behavior
- Giscus and comment-related partials
- PWA module integration and `manifest.webmanifest`
- donor deployment configuration
- generated output directories and lock files

## Implementation Plan

### Phase 1: Scaffold A Clean Site

Status: `implemented`

Create `website/` and add:

- `hugo.toml` with `baseURL = "https://sambee.net/"`, `theme = "sambee"`, and only the needed outputs
- `config/_default/params.toml`
- `content/_index.md`
- `content/docs/_index.md`
- one initial version tree, for example `content/docs/1.0/...`
- `data/docs-versions.toml`

Exit condition:

- Hugo builds a placeholder Sambee site without using `website-temp` content.

### Phase 2: Extract And Clean The Theme

Status: `partial`

Create `themes/sambee/` and copy the donor theme source.

Keep:

- base templates
- essentials partials
- icons
- image render hooks
- generic article and docs shell pieces

Remove or replace immediately:

- blog home template
- blog section templates
- taxonomy and term templates
- comments partials
- helgeklein branding

Exit condition:

- The theme renders a generic Sambee page shell with no blog dependency.

What is already true:

- `themes/sambee/` exists and is the active theme
- Sambee-specific home and docs layouts are in place
- comments and PWA wiring are absent from the active site

What still appears to remain:

- final donor cleanup is incomplete
- some non-doc routes from generic Hugo defaults still build, so the site is not fully reduced to the intended product/docs surface yet

### Phase 3: Rebuild The Asset And Search Pipeline

Status: `implemented`

Set up only the dependencies still needed for Sambee:

- Tailwind CSS
- theme token generation
- Pagefind
- optional formatter tooling if wanted for the `website/` subproject

Required scripts:

- `dev`
- `build`
- `preview`
- `build:search`

Build requirements:

- generate `generated-theme.css`
- build the Hugo site
- run Pagefind against `website/public`

Exit condition:

- local dev and production builds both generate a working search index.

### Phase 4: Implement Versioned Docs Behavior

Status: `partial`

Implement docs-specific templates and data-driven behavior for:

- version switcher
- docs side navigation
- breadcrumbs
- version status banners
- hard redirects for unversioned docs book entry points

Implementation rules:

- use `doc_id` for cross-version matching
- do not infer equivalent pages from path alone
- keep the same docs book split inside every version
- keep one shared docs template for all books initially
- render sidebar order from `data/docs-nav/<version>.toml`

Already implemented:

- version switcher
- docs side navigation driven by `data/docs-nav/1.0.toml`
- `doc_id` based page matching across versions
- hard redirects for unversioned docs book entry points
- shared docs templates for book landing pages and docs pages

Still missing from this phase:

- breadcrumbs
- version status banners
- broader multi-version behavior beyond the initial `1.0` set
- explicit confirmation that search defaults to the current docs version context

Exit condition:

- users can move between supported versions predictably and understand which version they are viewing.

### Phase 5: Migrate Content And Harden The Site

Status: `partial`

Migrate homepage and documentation material from the planning docs and existing internal docs.

Then add:

- validation checks
- link checking
- version integrity checks
- deployment automation for `sambee.net`

Required automated checks:

- missing `doc_id`
- duplicate `doc_id` within the same book and version
- broken cross-version switcher targets
- broken unversioned docs book entry points
- broken internal links in built docs
- docs navigation files reference only existing `doc_id` values
- each navigable page appears exactly once in the corresponding version navigation file

Exit condition:

- the site is content-complete enough to replace the donor implementation path.

Current note:

- placeholder homepage and placeholder docs pages exist
- hardening and validation work have not started yet
- deployment automation for `sambee.net` is not implemented yet

## Main Risks

### Hidden Blog Coupling In Donor Templates

Risk:

Generic-looking partials may still assume blog fields, featured images, post lists, or taxonomy terms.

Mitigation:

- remove blog templates first
- smoke-test copied partials against minimal docs pages
- prefer explicit Sambee overrides over preserving donor behavior by default

### Version Drift Across Releases

Risk:

Equivalent docs pages may stop matching across releases, breaking the switcher.

Mitigation:

- require `doc_id`
- keep folder structures aligned where possible
- validate cross-version mapping in CI

### Ordering Drift Between Content And Reader Navigation

Risk:

Folder order, titles, and other inferred ordering signals can drift away from the intended reading order, making navigation inconsistent.

Mitigation:

- treat `data/docs-nav/<version>.toml` as the ordering source of truth
- validate that navigable pages are listed exactly once
- do not use a second ordering mechanism for docs pages

### Search Noise Across Multiple Versions

Risk:

Users may get results from the wrong version.

Mitigation:

- attach version and book metadata to indexed pages
- default search scope to the current version context
- hide or de-prioritize unsupported versions

### Theme And Site Responsibilities Stay Mixed

Risk:

The new site becomes hard to maintain if generic rendering logic stays in the site root.

Mitigation:

- keep reusable presentation in `themes/sambee`
- keep content, configuration, and Sambee-specific overrides in the site root

## Definition Of Done

The migration is structurally complete when all of the following are true:

1. `implemented`: `website-temp` is no longer part of the active implementation path.
2. `implemented`: `website/` builds without donor content.
3. `implemented`: the active theme is `sambee`.
4. `partial`: Helge Klein branding is no longer visible in the active site, but donor cleanup should still be treated as incomplete until the remaining generic/blog residue is removed.
5. `implemented`: canonical docs URLs are versioned and use plain version slugs such as `1.0`.
6. `implemented`: docs content lives under `docs/<version>/end-user`, `docs/<version>/admin`, and `docs/<version>/developer`.
7. `partial`: Pagefind is wired into the build, but version-aware search behavior should still be verified against the final multi-version implementation.
8. `implemented`: comments and PWA functionality are absent.
9. `implemented` for the current scaffold: version switching, docs book entry points, and docs navigation resolve predictably for `1.0`.
10. `implemented`: docs sidebar order is determined by explicit navigation data, not inferred ordering.

## Immediate Next Step

Finish the first incomplete layer rather than re-scaffolding the site:

- complete donor/theme cleanup so only the intended Sambee surface remains
- add the missing docs UX pieces: breadcrumbs and version-status banners
- verify and tighten search behavior for version scoping
- migrate real homepage and documentation content
- add validation and integrity checks before deployment work begins

The minimum viable scaffold already exists. The next useful work is to turn that scaffold into a complete and hardened Sambee site.
