+++
title = "Docs Runtime and Route Resolution"
+++

This page covers the implementation-facing side of docs routing.

Use it when you need to answer questions such as:

- which files own docs route resolution
- how stable current routes differ from explicit versioned routes
- how inherited pages become routable
- how version switching and docs search stay version-aware

## Runtime Map

Editors usually work in content and nav files. Web developers also need to know which files own version metadata, build-time validation, and runtime route resolution.

### Content and Navigation Sources

These files define what the docs tree is supposed to be:

- `website/data/docs-versions.toml`: canonical docs version metadata
- `website/data/docs-nav/<version>.toml`: ordered books, sections, and pages

If the docs UI order looks wrong, or a page exists on disk but not in navigation, these are the first files to check.

### Build and Tooling Scripts

These scripts keep the docs tree valid and routable:

- `website/scripts/validate-docs-content.py`: validates docs structure, markers, and nav integrity
- `website/scripts/materialize-inherited-docs.py`: generates transient routable anchors for inherited docs and stable current routes
- `website/scripts/docs-editor.py`: CLI for creating, deleting, and renaming docs versions, books, sections, and pages safely

In practice:

- use the validator when you need to confirm content-tree and nav consistency
- use materialization when testing inheritance or stable-current route behavior
- use the docs editor for structural changes instead of hand-editing multiple files

### Runtime Template Layer

These files turn the requested docs URL into the page the user actually sees:

- `website/themes/sambee/layouts/partials/docs/context.html`: derives docs path context from the requested route
- `website/themes/sambee/layouts/partials/docs/page-path.html`: builds docs content paths with stable-current routing support
- `website/themes/sambee/layouts/partials/docs/page-url.html`: resolves navigable docs URLs
- `website/themes/sambee/layouts/partials/docs/source-page.html`: resolves the explicit versioned source page behind stable current routes
- `website/themes/sambee/layouts/partials/docs/effective-page.html`: resolves the authored page that supplies body content and metadata
- `website/themes/sambee/layouts/partials/docs/render-data.html`: prepares shared docs render data, including redirect and indexing state
- `website/themes/sambee/layouts/partials/docs/article-shell.html`: renders the shared docs article shell
- `website/themes/sambee/layouts/partials/docs/redirect-target.html`: resolves docs entry redirects
- `website/themes/sambee/layouts/partials/docs/nav-tree.html`: resolves navigation targets and displayed titles
- `website/themes/sambee/layouts/partials/docs/version-target-url.html`: resolves cross-version switch targets
- `website/themes/sambee/layouts/partials/search-modal.html`: applies docs-version-aware search behavior
- `website/themes/sambee/layouts/docs/list.html` and `website/themes/sambee/layouts/docs/single.html`: route docs list and page rendering through the shared shell

### Theme Assets

These assets shape the visible docs experience once the route and content have been resolved:

- `website/themes/sambee/assets/css/`: shared theme CSS, including docs UI and typography

## Requested Route Versus Effective Page

The docs runtime keeps requested-path context separate from effective-content resolution.

### Requested Route Context

`website/themes/sambee/layouts/partials/docs/context.html` derives path context from the requested route and returns values including:

- `isDocs`
- `version`
- `book`
- `section`
- `page`
- `kind`
- `currentVersion`
- `isExplicitVersion`
- `isCurrentRoute`
- `isCurrentVersion`
- convenience booleans: `isDocsRoot`, `isVersion`, `isBook`, `isSection`, and `isPage`

Interpretation rules that matter when changing templates:

- stable current routes such as `/docs/website-dev-guide/...` still resolve to the current version even though the version slug is omitted
- explicit current-version routes such as `/docs/0.7/...` are compatibility routes and should redirect to stable current routes
- archived explicit version routes stay routable and render as full docs pages

### Effective Content Resolution

`website/themes/sambee/layouts/partials/docs/effective-page.html` then resolves the authored content source and returns values including:

- `page`: the authored page that should supply title, description, TOC, and body content
- `requestedPage`: the Hugo page for the requested route
- `requestedVersion`: the version derived from the route
- `resolvedVersion`: the version that supplied the effective content
- `isInherited`: whether the route resolved through inheritance

Templates should render article content and metadata from `page`, while navigation state, breadcrumbs, and version-switcher state stay tied to the requested route context.

## Why Materialization Exists

Hugo needs a concrete page object at the requested path. Raw marker files alone are not enough.

The build therefore materializes transient route anchors under `.generated/content/docs` so Hugo can route inherited pages and stable current routes without publishing broken `/inherit/` or `/_inherit/` URLs.

From Hugo's perspective, `inherit.md` and `_inherit.md` are ordinary content files. If the site consumed them directly, Hugo would try to publish the wrong public URLs.

Example:

- `content/docs/1.1/end-user/getting-started/install/inherit.md` would naturally publish at `/docs/1.1/end-user/getting-started/install/inherit/`
- `content/docs/1.1/_inherit.md` would naturally publish at `/docs/1.1/_inherit/`

Those are invalid for this docs model. The canonical public URLs must stay attached to the folder path itself:

- `/docs/1.1/end-user/getting-started/install/`
- `/docs/1.1/`

That creates a routing gap:

- raw marker files must not become public pages
- Hugo still needs a real page or section node at the requested folder path so templates can run and the resolver can supply inherited content

The moving pieces are:

- `website/hugo.toml` ignores raw marker files as direct public pages
- `website/scripts/materialize-inherited-docs.py` generates transient anchors at the canonical folder paths
- `website/config/_default/module.toml` mounts `.generated/content` into Hugo's content tree
- `website/themes/sambee/layouts/partials/docs/effective-page.html` resolves the real authored page that should supply the body, title, description, and TOC

During the build, `materialize-inherited-docs.py` does this work:

1. deletes stale generated docs anchors under `website/.generated/content/docs/`
2. scans `website/content/docs/` for `inherit.md` and `_inherit.md`
3. generates transient `index.md` or `_index.md` anchors at the matching canonical folder paths under `website/.generated/content/docs/`
4. generates transient anchors for the declared current version at stable routes under `website/.generated/content/docs/<book>/...`
5. marks inherited-route anchors with `inherit = true`
6. marks stable current-route anchors with `current_route = true` and `source_docs_path = "/docs/<current>/..."`

Operational notes:

- `website/.generated/` is build output and is ignored by Git
- Hugo mounts `.generated/content` into the site content tree during the build
- Hugo is configured to ignore raw `inherit.md` and `_inherit.md` files

Without this script, the project would be stuck with two bad options:

- keep raw marker files visible to Hugo and accept broken `/inherit/` and `/_inherit/` URLs
- ignore marker files and lose the routable page nodes needed to render inherited docs at canonical folder URLs

## Version Switcher Fallback Order

When a reader switches from one docs version to another, the target lookup order is:

1. the same page path
2. the same section landing path
3. the same book landing path
4. the target version landing path

## Search Behavior

Docs search is intentionally version-aware.

- Pagefind indexes stable current docs URLs, not explicit current-version compatibility routes
- current docs search results therefore keep stable unversioned URLs
- explicit versioned docs pages are excluded from the current-version search index
- on non-docs pages, the UI defaults docs search filters to the `current` version from `website/data/docs-versions.toml`
- versions with `searchable = false` are excluded from docs search indexing

## Commands for Runtime Changes

The most relevant commands when you are changing docs runtime behavior are:

- `npm run docs:validate`: validate docs content, nav data, markers, and inheritance rules
- The validator checks for:
	- both `index.md` and `inherit.md` in the same page folder
	- both `_index.md` and `_inherit.md` in the same version, book, or section folder
	- missing required page markers in page folders
	- missing required `_index.md` or `_inherit.md` in version or book folders
	- invalid non-empty inheritance marker files
	- inheritance chains that never resolve to real content
	- nav entries that point to missing version, book, section, or page paths
	- duplicate nav slugs in books, sections, or pages
	- legacy identity metadata such as `doc_id` and `product_version`
	- disallowed docs front matter such as `aliases`
- `npm run docs:materialize-inherited`: regenerate transient inherited-route and stable current-route anchors
- `npm run build`: generate theme assets, validate docs, materialize docs route anchors, and build the site
- `npm run build:search`: run the full build and then generate the Pagefind search index
