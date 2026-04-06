# Hugo Migration Plan For Sambee Website

## Goal

Create a new Hugo site for Sambee inside this repository, using the copied `website-temp` site only as a source for reusable theme and build assets.

The primary constraint is to migrate the visual system and generic site mechanics cleanly, without dragging over helgeklein.com-specific content structure, branding, menus, SEO settings, deployment assumptions, or generated artifacts.

## Executive Recommendation

Do not evolve `website-temp` in place.

Instead:

1. Create a brand-new site in `website/`
2. Extract the reusable presentation layer from `website-temp`
3. Rename the migrated custom theme to something Sambee-specific such as `sambee`
4. Recreate Sambee configuration, menus, and content structure from the planning docs in this repository
5. Add build, validation, and deployment pieces only after the site renders cleanly

This is the lowest-risk path because `website-temp` is a complete production site, not a standalone theme package.

## Confirmed Decisions

The following decisions are now fixed and should be treated as migration requirements, not open questions:

- Production domain: `https://sambee.net/`
- Search: keep Pagefind
- Comments: do not use Giscus or any other commenting system in the initial site
- PWA: not needed
- Docs hierarchy must exist as top-level sections under `docs/`:
   - version-first storage directly below `docs/`
   - audience-specific subsections within each version
- Docs must support multiple product versions, with content stored separately per version and a version switcher that lets visitors move between current and older documentation sets
- Version slugs should not use a `v` prefix; use `1.0`, `1.1`, and similar forms

## Analysis Of `website-temp`

### What It Is

`website-temp` is a full Hugo website with a custom theme plus site-specific content, configuration, operational tooling, and generated outputs.

The copied site is not organized as a clean reusable theme repository. Reusable theme logic exists, but it is split across:

- site root files
- `themes/helgeklein`
- root-level Hugo config
- root-level `assets`
- root-level `static`
- root-level scripts

### Core Build Stack

The copied site currently depends on:

- Hugo Extended, minimum version `0.151.0`
- Hugo modules via `go.mod`
- Node-based asset tooling via `package.json`
- Tailwind CSS 4
- `tailwind-bootstrap-grid`
- `pagefind` for search
- a custom theme token generator script at `scripts/themeGenerator.js`

### Reusable Theme Mechanics Already Present

The following parts are good candidates for migration because they are structural or stylistic rather than brand-specific:

- Theme layouts in `themes/helgeklein/layouts`
- Theme partials in `themes/helgeklein/layouts/_partials`
- Theme assets in `themes/helgeklein/assets`
- Theme translations in `themes/helgeklein/i18n`
- Theme token model in `data/theme.json`
- Theme CSS generation script in `scripts/themeGenerator.js`
- Generic site shell behavior:
  - header and footer framework
  - dark mode handling
  - Tailwind-based styling
  - page shell and asset pipeline
  - table of contents support
  - syntax highlighting support
  - responsive article layout
  - generic page templates

### Root-Level Site Assumptions That Must Not Be Carried Over As-Is

The following are clearly helgeklein.com-specific and should be recreated for Sambee rather than copied verbatim:

- `baseURL = "https://helgeklein.com/"`
- `title = "Helge Klein"`
- `theme = "helgeklein"`
- blog-centric permalink rules for `content/blog` and `content/pages`
- blog taxonomies: categories and tags
- homepage implementation that renders latest blog posts
- three-level navigation menu tailored to tools, projects, and HAUS21
- metadata author and description values
- social profile links
- Giscus repository IDs and comment settings
- Cloudflare R2 / CDN settings in `params.toml`
- footer legal links and imprint/privacy page assumptions
- helgeklein logo assets and brand typography choices
- PWA assumptions

### Content Model In The Copied Site

The content tree is blog-first:

- `content/blog/<year>/...`
- `content/pages/...`

The homepage template renders a post grid. Taxonomy and related-post templates are also blog-driven. This is a poor default for Sambee, whose planned information architecture is:

- homepage
- end-user docs
- admin docs
- developer docs

That means the Sambee website should be docs-first or product-docs-first, not blog-first.

It also means the docs information architecture must be designed around versioned documentation from the start. Retrofitting version support after content migration would force URL, menu, search, and template changes across the whole docs tree.

### Site-Specific Operational And Generated Baggage

These folders or files are not migration inputs and should not be copied into the final site:

- `.git/`
- `.github/`
- `.githooks/`
- `.devcontainer/`
- `.vscode/`
- `node_modules/`
- `public/`
- `resources/`
- `tmp/`
- `.pytest_cache/`
- `.hugo_build.lock`
- `hugo_stats.json`
- `content-editor.code-workspace`
- `migration/`
- `R2_SETUP.md`

### Test And Validation Extras In The Copied Site

The copied site also includes validation and automation that may be useful later, but should not block initial migration:

- `.htmltest.yml`
- `tests/test_menu_urls.py`

These are candidates for phase-two adoption after the new site structure is stable.

## Recommended Target Structure

Create a clean Hugo site at `website/` with this shape:

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
|       `-- 1.1/
|           |-- _index.md
|           |-- end-user/
|           |   `-- _index.md
|           |-- admin/
|           |   `-- _index.md
|           `-- developer/
|               `-- _index.md
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

Notes:

- Use `themes/sambee` rather than `themes/helgeklein` to avoid carrying old branding into the new site.
- Keep root-level `layouts/` initially empty unless Sambee needs site-specific overrides.
- Keep root-level `assets/` only for Sambee branding or site-only assets. Move generic styling into the theme.
- Use `content/docs/...` rather than `content/blog/...` and `content/pages/...` as the main long-term structure.
- Use version-first storage beneath `docs/`, with audience subsections inside each version.
- Preserve the requested docs hierarchy within each version: `end-user`, `admin`, and `developer`.
- Do not duplicate a separate `current` content tree. Instead, store real versions once and map unversioned landing URLs to the configured current version.
- Use plain version slugs such as `1.0` and `1.1` in folders and URLs, not `v1.0` or `v1.1`.
- Treat unversioned audience routes such as `/docs/end-user/` as convenience entry points to the configured current version, not as canonical content locations.

## Migration Principles

### Principle 1: Extract, Do Not Clone

The new site should be built from a curated extraction of reusable pieces. Treat `website-temp` as a donor, not as the baseline working directory.

### Principle 2: Favor A Small Site Root

Anything reusable across pages should live in the theme. The site root should mostly contain:

- Sambee config
- Sambee content
- Sambee branding
- Sambee-specific layout overrides

### Principle 3: Remove Blog Coupling Early

The biggest architectural mismatch is not the styling. It is the content model. Remove blog assumptions before building out Sambee pages, otherwise the site structure will keep fighting the docs information architecture.

### Principle 4: Defer Nice-To-Haves

Do not carry over every feature from the donor site on day one. Only the features already confirmed for Sambee should be treated as mandatory.

This principle now applies only to unresolved features. Pagefind is required, while comments and PWA support are explicitly out of scope for the initial site.

### Principle 5: Design For Docs Versioning From Day One

Versioning must be part of the foundational content model, navigation model, and template model.

That means:

- version must be encoded in the docs content tree
- search results must be version-aware
- menus and breadcrumbs must know the selected version
- the docs version switcher must have a deterministic way to find the equivalent page in another version or fall back to that version's section landing page
- canonical docs URLs should be versioned

## What To Keep, Adapt, Or Drop

### Keep With Minimal Change

- `themes/helgeklein/assets/` as source input for the new `themes/sambee/assets/`
- `themes/helgeklein/layouts/baseof.html`
- `themes/helgeklein/layouts/_partials/essentials/*`
- `themes/helgeklein/layouts/_partials/components/*` where components are generic
- `themes/helgeklein/layouts/_partials/icons/*`
- `themes/helgeklein/layouts/_markup/render-image.html`
- `themes/helgeklein/i18n/en.toml`
- `scripts/themeGenerator.js`
- `data/theme.json` as an initial design-token source
- Pagefind integration and related search UI assets

### Keep But Rename Or Rewrite

- `theme = "helgeklein"` to `theme = "sambee"`
- logo partial behavior: keep the fallback pattern, replace actual brand assets
- `data/theme.json`: keep the mechanism, replace colors and fonts
- root `assets/images/logo-*.svg`: replace with Sambee logos or text fallback
- `config/_default/module.toml`: keep only modules actually used by Sambee
- `package.json` scripts: keep the asset build ideas, simplify aggressively

### Copy Only After Review

- `.htmltest.yml`
- `tests/test_menu_urls.py`
- plugin JS list in `hugo.toml`

### Keep As Explicit Product Decisions

- Pagefind build and UI integration
- docs table of contents support
- version-aware docs navigation and switcher support

### Drop Entirely From Initial Migration

- all blog content
- all helgeklein menus
- categories and tags unless Sambee truly needs them
- related-post templates
- Giscus configuration
- comments partials and comment-related front matter behavior
- CDN / R2 configuration
- PWA module integration and `manifest.webmanifest`
- WordPress-compatible RSS customization
- site-specific redirect rules
- migration utilities from the blog site
- content editor workspace files

## Detailed Migration Plan

### Phase 1: Create A Clean Website Skeleton

Goal: establish a fresh Hugo site that renders a minimal Sambee homepage with no dependency on the old content structure.

Steps:

1. Create `website/` as a new Hugo site root.
2. Add a minimal `hugo.toml` with:
   - Sambee title
   - production `baseURL = "https://sambee.net/"`
   - `theme = "sambee"`
   - `defaultContentLanguage = "en"`
   - only the output formats and taxonomies actually needed
3. Add `config/_default/params.toml` with only Sambee-specific placeholders.
4. Create the top-level docs section tree:
   - `content/docs/_index.md`
   - `content/docs/1.0/_index.md`
   - `content/docs/1.0/end-user/_index.md`
   - `content/docs/1.0/admin/_index.md`
   - `content/docs/1.0/developer/_index.md`
5. Add a temporary homepage content file and minimal docs section indexes.
6. Do not copy any content from `website-temp/content/`.

Exit criteria:

- `website/` builds successfully with a placeholder theme or a minimal copied shell.

### Phase 2: Extract The Theme Into `themes/sambee`

Goal: move the reusable visual and structural layer into a Sambee-specific custom theme.

Steps:

1. Create `website/themes/sambee/`.
2. Copy over these source directories from `website-temp/themes/helgeklein/`:
   - `assets/`
   - `i18n/`
   - `layouts/`
3. Rename any obvious brand references from Helge Klein to Sambee where they are structural, not content.
4. Keep `baseof.html`, essentials partials, icons, and image render hooks.
5. Remove or quarantine obviously blog-specific templates from the theme immediately:
   - `layouts/home.html`
   - `layouts/blog/`
   - `layouts/taxonomy.html`
   - `layouts/term.html`
   - homepage-specific post grid partials
   - comments partials and comment invocations
6. Keep `layouts/pages/single.html` only if you still want article-style content pages.
7. Keep or adapt the existing search modal and search-related shell pieces because Pagefind is required.
8. Replace the homepage template with one designed for Sambee product content.

Exit criteria:

- The theme renders a generic page shell without relying on blog collections.

### Phase 3: Migrate Asset Pipeline And Theme Tokens

Goal: preserve the useful styling system without carrying over unnecessary toolchain complexity.

Steps:

1. Copy `scripts/themeGenerator.js` into `website/scripts/`.
2. Copy `data/theme.json` into `website/data/`.
3. Copy only the required asset entry points into `website/themes/sambee/assets/`.
4. Create a reduced `package.json` that keeps only dependencies actually required for:
   - Tailwind CSS
   - concurrent dev workflow, if still useful
   - Pagefind
   - Prettier, only if you want formatting inside `website/`
5. Remove unrelated package scripts such as:
   - `dev:example`
   - `build:example`
   - `preview:example`
   - `remove-darkmode`
   - `remove-multilang`
   - `project-setup`
   - `theme-setup`
   - `update-theme`
6. Keep a minimal script set:
   - `dev`
   - `build`
   - `preview`
   - `build:search`
7. Generate fresh `generated-theme.css` for the new site.
8. Ensure the build pipeline runs Pagefind against the built `website/public` output.

Exit criteria:

- Theme CSS is generated successfully and the site renders with Sambee branding tokens.
- Pagefind index generation is wired into normal build output.

### Phase 4: Rebuild Sambee Configuration From Scratch

Goal: replace helgeklein.com settings with Sambee-specific site config.

Steps:

1. Recreate `hugo.toml` instead of editing the copied file line-by-line.
2. Recreate `config/_default/params.toml` with Sambee placeholders only.
3. Recreate `config/_default/menus.en.toml` from the Sambee information architecture.
4. Recreate `config/_default/languages.toml` only as needed.
5. Recreate `config/_default/module.toml` and keep only the Hugo modules Sambee actually uses.
6. Set the production domain and canonical URL behavior from the start.

Recommended initial module set:

- `basic-seo`
- `render-link`
- `table-of-contents`

Optional module set:

- `videos`
- `modal`
- `site-verifications`
- `button`

Likely removals at first pass:

- PWA module
- modal module if search or other modal UI is not yet used

Required configuration decisions:

- `baseURL = "https://sambee.net/"`
- no Giscus configuration
- no PWA output format or manifest wiring
- search configuration for Pagefind-enabled templates and assets

Exit criteria:

- No Helge Klein URLs, names, IDs, social links, or repo IDs remain in active site config.
- Active configuration matches the fixed Sambee product decisions.

### Phase 5: Recreate The Content Architecture For Sambee

Goal: align content with the planning already done in this repository.

Steps:

1. Build the homepage around Sambee messaging from the homepage planning docs.
2. Create docs landing pages for:
   - end-user docs
   - admin docs
   - developer docs
3. Establish a content organization that maps to the planning documents, not the blog taxonomy.
4. Use this docs section layout:
   - `content/docs/<version>/end-user/...`
   - `content/docs/<version>/admin/...`
   - `content/docs/<version>/developer/...`
5. Create a small set of archetypes for consistent front matter.
6. Add unversioned audience landing pages that explain audience scope and link to the current version.
7. Only after the information architecture is stable, begin migrating material from:
   - `documentation/`
   - `documentation_developers/`

Exit criteria:

- Navigation, section landing pages, and URL structure match Sambee plans rather than blog-era conventions.

### Phase 6: Implement Versioned Docs Architecture

Goal: make versioning a first-class part of the docs subsite rather than a later add-on.

Recommended approach: use path-based versioning directly below `docs/`, with audience subsections inside each version.

Recommended content layout:

- `content/docs/1.0/end-user/...`
- `content/docs/1.0/admin/...`
- `content/docs/1.0/developer/...`
- `content/docs/1.1/end-user/...`
- `content/docs/1.1/admin/...`
- `content/docs/1.1/developer/...`

Recommended support files:

- `data/docs-versions.toml` to declare:
  - current version
  - all supported versions
  - labels such as `current`, `LTS`, or `unsupported`
  - optional per-version release metadata

Recommended front matter fields on docs pages:

- `doc_id`: stable identifier shared across versions of the same conceptual page
- `product_version`: explicit version string such as `1.1`
- `audience`: one of `end-user`, `admin`, or `developer`
- optional `version_aliases` or `legacy_paths` when old URLs must redirect

Versioning rules:

1. The same conceptual document must keep the same `doc_id` across versions.
2. Relative slug structure should stay aligned across versions whenever possible.
3. Canonical docs page URLs should be versioned, for example `/docs/1.1/end-user/...`.
4. Unversioned audience landing pages such as `/docs/end-user/` should point to the configured current version landing page, not duplicate content.
5. Individual docs pages should not exist at both unversioned and versioned URLs unless an intentional alias is needed.
6. Version folder names and URL slugs should use plain release identifiers such as `1.0` and `1.1`, not `v1.0` and `v1.1`.

Version switcher behavior:

1. On a versioned docs page, show a version switcher containing the current version and older supported versions.
2. When a visitor selects another version, resolve the target page by matching:
   - same `audience`
   - same `doc_id`
   - selected `product_version`
3. If no equivalent page exists in the selected version, send the visitor to that version's audience landing page and show a short notice that the exact page is unavailable in that version.
4. The switcher should be absent or disabled outside the docs subsite.

Navigation and breadcrumb requirements:

- docs navigation must indicate both audience and selected version
- breadcrumbs should include the version level where helpful
- section sidebars should be generated per version and audience, not globally across all versions

Search requirements:

- Pagefind results must include enough metadata to identify version and audience
- docs search UI should default to the selected version when the visitor is inside versioned docs
- optionally allow widening the search scope to all versions if that proves useful later

Implementation note:

The simplest robust approach is to build the version switcher on top of stable page metadata rather than path guessing. In practice, that means using `doc_id` and `product_version` in front matter and resolving cross-version matches from Hugo page collections.

Exit criteria:

- docs content exists in separate versioned trees
- the current version is centrally configurable
- cross-version page switching works or falls back predictably
- search can distinguish versions
- canonical docs URLs are versioned

### Phase 7: Implement Required Search And Exclude Unneeded Features

Goal: retain the required search experience while explicitly removing features that are out of scope.

Required feature work:

1. Search
   - Keep Pagefind and integrate it into the docs experience.
   - Ensure search works across versioned docs.
   - Decide whether the default scope should be current version only or current section plus current version.
2. Taxonomies
   - Avoid categories and tags unless the site includes a real blog.
3. RSS
   - Keep only if news or blog content exists.
4. Related content widgets
   - Use only if there is enough long-form editorial content.

Explicit exclusions:

- no Giscus
- no other page-level commenting system
- no PWA manifest or install flow
- no PWA Hugo module

Exit criteria:

- Pagefind works in the built site.
- Comments and PWA functionality are absent from the active implementation.

### Phase 8: Add Validation, CI, And Deployment

Goal: harden the new site after the architecture and theme are stable.

Steps:

1. Add HTML validation only after routes are settled.
2. Port `.htmltest.yml` only if the generated site structure is similar enough.
3. Either rewrite or replace `tests/test_menu_urls.py` for the new menu model.
4. Add build commands to repository tooling.
5. Add deployment automation for `sambee.net` once the final hosting target is chosen.
6. Add checks that specifically validate versioned docs links and version switcher targets.
7. Add checks that validate the unversioned audience entry points resolve to the configured current version.

Exit criteria:

- Site builds reproducibly and validation checks match the new site, not the old one.
- Production deployment assumptions are aligned with `sambee.net`.

## Concrete File Migration Map

### Files To Copy Early

Copy these early into the new `website/` tree for extraction work:

- `website-temp/themes/helgeklein/assets/**` -> `website/themes/sambee/assets/**`
- `website-temp/themes/helgeklein/i18n/**` -> `website/themes/sambee/i18n/**`
- `website-temp/themes/helgeklein/layouts/**` -> `website/themes/sambee/layouts/**`
- `website-temp/data/theme.json` -> `website/data/theme.json`
- `website-temp/scripts/themeGenerator.js` -> `website/scripts/themeGenerator.js`
- Pagefind-related assets and templates that are actually used by the migrated theme

### Files To Recreate Manually

- `website/hugo.toml`
- `website/config/_default/params.toml`
- `website/config/_default/menus.en.toml`
- `website/config/_default/module.toml`
- `website/data/docs-versions.toml`
- `website/content/**`

### Files To Copy Only If Needed Later

- `website-temp/package.json`
- `website-temp/package-lock.json`
- `website-temp/go.mod`
- `website-temp/go.sum`
- `website-temp/.htmltest.yml`
- `website-temp/tests/test_menu_urls.py`

### Files To Ignore Completely

- `website-temp/content/**`
- `website-temp/public/**`
- `website-temp/resources/**`
- `website-temp/node_modules/**`
- `website-temp/migration/**`
- `website-temp/tmp/**`
- `website-temp/.git/**`
- `website-temp/static/manifest.webmanifest`

## Risks And How To Avoid Them

### Risk: Hidden Blog Assumptions In Shared Partials

Some partials look generic but still depend on blog-style fields, featured images, or post collections.

Mitigation:

- smoke-test every copied template against a minimal Sambee page before trusting it
- remove homepage and taxonomy templates first
- keep site root overrides available to replace theme templates quickly

### Risk: Versioned Docs Become Inconsistent Across Releases

Without a strong convention, versioned docs can drift in filenames, slugs, or page identity, making the version switcher unreliable.

Mitigation:

- require a stable `doc_id` on versioned docs pages
- keep per-version folder structures aligned wherever possible
- add automated checks for cross-version page resolution

### Risk: Search Quality Degrades When Multiple Versions Are Indexed

If all versions are indexed without metadata and scoping, visitors may get noisy or outdated results.

Mitigation:

- index version and audience metadata with each docs page
- default docs search to the selected version context
- clearly label search results with version badges

### Risk: Carrying Over Too Many Optional Dependencies

The copied site has Hugo modules, Tailwind, search tooling, and validation extras.

Mitigation:

- start with the smallest working set
- add modules and tooling back one feature at a time

### Risk: Theme And Site Responsibilities Remain Blurred

If too much logic stays at the site root, future reuse and maintenance become harder.

Mitigation:

- move generic presentation into `themes/sambee`
- keep Sambee content and configuration at the site root

### Risk: Generated Files Accidentally Enter Source Control

The copied site contains several generated outputs.

Mitigation:

- define ignores for `website/public/`, `website/resources/`, and generated CSS artifacts where appropriate
- generate fresh outputs in the new site instead of copying them

## Suggested Order Of Implementation Work

1. Create `website/` skeleton
2. Create `themes/sambee/`
3. Copy theme assets, layouts, i18n, `theme.json`, and theme generator script
4. Strip blog-specific templates from the copied theme
5. Recreate minimal Hugo config for Sambee
6. Replace logos, colors, and typography tokens
7. Build a minimal homepage and one docs page
8. Implement versioned docs structure and version switcher support
9. Wire Pagefind into version-aware docs search
10. Add validation and deployment
11. Migrate actual documentation content

## Definition Of Done For The Migration

The migration should be considered structurally complete when all of the following are true:

1. `website-temp` is no longer part of the active implementation path
2. `website/` builds without depending on blog content
3. no Helge Klein branding or IDs remain in active Sambee site files
4. the active theme is `sambee`
5. homepage and docs navigation match the Sambee planning docs
6. docs content is organized under `docs/<version>/end-user`, `docs/<version>/admin`, and `docs/<version>/developer`
7. versioned docs are stored separately per product version and can be switched predictably
8. Pagefind works for the active site
9. Giscus and PWA functionality are absent from the active site

## Recommended Next Step

The next implementation step should be to scaffold `website/` and extract only the minimum viable theme layer:

- theme shell
- asset pipeline
- Sambee config
- placeholder homepage
- placeholder docs landing page
- versioned docs scaffolding for one initial product version
- Pagefind-enabled docs search shell

After that, the remaining migration decisions become concrete and testable rather than theoretical.
