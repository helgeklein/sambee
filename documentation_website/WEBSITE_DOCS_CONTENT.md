# Website Docs Content And Inheritance

This document describes the current docs content model for the website, the authoring rules for editors, and the implementation details that website developers need to preserve.

## Purpose

The docs system supports versioned content inheritance so a newer docs version can reuse content from an older release without copying the Markdown until the content actually changes.

The model is built around three rules:

- Docs identity is path-derived.
- Inheritance walks backward through the canonical version list.
- Public docs URLs stay tied 1:1 to the requested content path.

## Who This Is For

- Editors: people adding or updating docs content and navigation data.
- Website developers: people changing Hugo templates, validation rules, routing behavior, or build scripts.

## Core Model

Docs identity comes from the filesystem path under `website/content/docs/`.

- Version slug: `content/docs/<version>/`
- Book slug: `content/docs/<version>/<book>/`
- Section slug: `content/docs/<version>/<book>/<section>/`
- Page slug: `content/docs/<version>/<book>/<section>/<page>/`

No docs page should define `doc_id`, `product_version`, or any other duplicate identity metadata in front matter.

Docs content must not use `aliases`.

The canonical URL contract is:

- Version landing page: `/docs/<version>/`
- Book landing page: `/docs/<version>/<book>/`
- Section landing page: `/docs/<version>/<book>/<section>/`
- Article page: `/docs/<version>/<book>/<section>/<page>/`

Runtime entry behavior is:

- `/docs/` redirects to the current docs version's first book as ordered in `website/data/docs-nav/<current>.toml`.
- `/docs/<version>/` redirects to that version's first book as ordered in `website/data/docs-nav/<version>.toml`.
- Book, section, and article URLs render full docs pages.

## Version Order

Docs versions are declared in `website/data/docs-versions.toml`.

- `[[versions]]` entries are listed in ascending release order, oldest to newest.
- Inheritance only walks backward through that order.
- The `current` key defines the default docs version for non-docs search behavior and other current-version UI.
- The `searchable` flag controls whether a version is included in Pagefind indexing and default search scopes.

## Filesystem Contract

### Page Folders

A page folder under `website/content/docs/<version>/<book>/<section>/<page>/` must contain exactly one of these files:

- `index.md`: real content and metadata.
- `inherit.md`: empty inheritance marker.

Rules:

- `index.md` and `inherit.md` must never exist together.
- One of them must exist.
- `inherit.md` must be empty and must not contain front matter.

### Version And Book Folders

A version or book folder must contain exactly one of these files:

- `_index.md`: real landing-page content and metadata.
- `_inherit.md`: empty inheritance marker.

Rules:

- `_index.md` and `_inherit.md` must never exist together.
- One of them must exist.
- `_inherit.md` must be empty and must not contain front matter.

### Section Folders

A section folder may contain zero or one of these files:

- `_index.md`: section landing-page content and metadata.
- `_inherit.md`: empty inheritance marker.

Rules:

- `_index.md` and `_inherit.md` must never exist together.
- No file is valid and means the section is structural only.
- If `_inherit.md` exists, it must be empty and must not contain front matter.

## Inheritance Resolution

When Hugo renders a docs URL for version `V`, the resolver checks the matching path in `V` first, then walks backward through earlier versions until it finds real content.

Page resolution:

1. Look for `index.md` in the requested page folder.
2. If it exists, use it.
3. Otherwise, if `inherit.md` exists, move to the previous version and check the same path.
4. If neither file exists, the page is unresolved and validation should fail.
5. If the backward scan ends without finding `index.md`, validation should fail.

Landing-page resolution uses the same pattern with `_index.md` and `_inherit.md`.

Metadata always comes from the same resolved Markdown file that supplies the content.

- Resolved page title comes from the effective `index.md` or `_index.md`.
- Resolved description comes from the effective `index.md` or `_index.md`.
- Resolved body content comes from the effective `index.md` or `_index.md`.
- Resolved TOC comes from the effective article page.

Inheritance marker files are markers only.

- `inherit.md` does not override metadata.
- `_inherit.md` does not override metadata.

## Navigation Data

Navigation data lives in `website/data/docs-nav/<version>.toml`.

These files define ordering only.

- `books` orders books.
- `[[sections.<book>.items]]` orders sections and defines the displayed section label.
- `[pages.<book>.<section>].items` orders pages.

Minimal example:

```toml
books = [
	"user-guide",
	"admin-guide",
	"developer-guide",
]

[[sections.user-guide.items]]
slug = "getting-started"
title = "Getting Started"

[pages.user-guide.getting-started]
items = [
	"what-sambee-can-access",
	"first-sign-in-and-interface-tour",
]
```

Navigation data does not define:

- URLs
- page titles
- page existence
- inheritance behavior

Those come from the content tree and the effective page resolver.

Validation expects every listed slug to exist on disk for that version.

Validation also expects:

- every `books` entry to be a non-empty unique string
- every `sections.<book>.items[]` entry to be a table with a non-empty `slug` and non-empty `title`
- section slugs within the same book to be unique
- every `pages.<book>.<section>.items[]` entry to be a non-empty string
- page slugs within the same section to be unique

Unlisted sections or pages may still exist on disk and be reachable by direct URL, but they will not appear in generated navigation or listings.

## Editor Workflow

### Add A New Page

1. Choose the version, book, section, and page folder path.
2. Create the page folder if it does not already exist.
3. Add `index.md` with the real content.
4. Add the page slug to `website/data/docs-nav/<version>.toml` if the page should appear in navigation.

### Reuse An Older Page Without Changes

1. Create the page folder in the newer version if it does not already exist.
2. Add an empty `inherit.md` file.
3. Do not add front matter or content to `inherit.md`.
4. Make sure the same page path exists in an older version with real content.
5. Add the page slug to that version's nav TOML if the page should appear in navigation.

### Add Or Reuse Landing-Page Content

- Use `_index.md` when the version, book, or section has its own landing-page content.
- Use `_inherit.md` when that landing page should reuse content from an older version.
- Leave section folders without either file when the section is only a grouping container.

### Update Existing Content

- Edit the resolved `index.md` or `_index.md` when you want to change the shared inherited content for newer versions too.
- Replace `inherit.md` with `index.md` when a newer version needs to diverge.
- Replace `_inherit.md` with `_index.md` when a newer landing page needs to diverge.

### Things Editors Must Not Do

- Do not add `doc_id`.
- Do not add `product_version`.
- Do not add `aliases`.
- Do not put content into `inherit.md` or `_inherit.md`.
- Do not place article pages directly under a book folder without a section and page folder.

## Website Developer Notes

### Key Runtime Behavior

- The requested docs URL stays in the browser even when the content is inherited from an older version.
- Breadcrumbs and version-switcher state reflect the requested version, not the resolved source version.
- Inherited pages do not display a visual inheritance badge.
- Effective page metadata must be used consistently for titles, descriptions, TOCs, sidebar labels, and article content.
- `/docs/` is a redirect-only entry page that forwards to the current version's first book.
- `/docs/<version>/` is a redirect-only entry page that forwards to that version's first book.
- Book, section, and article pages all render through the same article-style docs shell.

### Context And Resolver Contracts

`website/themes/sambee/layouts/partials/docs/context.html` derives path context from the requested page's `.RelPermalink` and returns:

- `isDocs`
- `version`
- `book`
- `section`
- `page`
- `kind`: one of `docs-root`, `version`, `book`, `section`, or `page`
- convenience booleans: `isDocsRoot`, `isVersion`, `isBook`, `isSection`, and `isPage`

`website/themes/sambee/layouts/partials/docs/effective-page.html` accepts the requested Hugo page object and returns:

- `page`: the effective source page object that should supply rendered content and metadata
- `requestedPage`: the original Hugo page object for the requested URL
- `requestedVersion`: the version slug derived from the requested path
- `resolvedVersion`: the version slug that supplied the effective content
- `isInherited`: whether the requested URL resolves through inheritance or through a generated inherited route anchor

Implementation notes:

- templates should render article body, title, description, and TOC from `page`, not directly from `requestedPage`
- navigation, breadcrumbs, and version-switcher state should stay tied to the requested path context even when `resolvedVersion` differs
- the resolver treats raw marker files and generated placeholders marked with `inherit = true` as non-authored routing nodes, not as effective content sources

### Key Implementation Files

- `website/themes/sambee/layouts/partials/docs/context.html`: derives version, book, section, page, and node kind from the requested path.
- `website/themes/sambee/layouts/partials/docs/effective-page.html`: resolves the effective source page by walking backward through the canonical version list.
- `website/themes/sambee/layouts/partials/docs/render-data.html`: resolves the shared render inputs used by docs page templates.
- `website/themes/sambee/layouts/partials/docs/article-shell.html`: renders the shared article-style docs shell for book, section, and article pages.
- `website/themes/sambee/layouts/partials/docs/redirect-target.html`: resolves redirect targets for `/docs/` and `/docs/<version>/` entry pages.
- `website/themes/sambee/layouts/partials/docs/redirect-page.html`: renders the redirect body used by docs entry pages.
- `website/themes/sambee/layouts/docs/single.html`: delegates article pages to the shared article-style docs shell.
- `website/themes/sambee/layouts/docs/list.html`: redirects docs root/version entry pages and delegates book and section pages to the shared article-style docs shell.
- `website/themes/sambee/layouts/partials/docs/nav-tree.html`: resolves nav targets and displayed page titles by path and effective page metadata.
- `website/themes/sambee/layouts/partials/docs/version-target-url.html`: resolves cross-version switch targets using the requested path and fallback chain.
- `website/themes/sambee/layouts/partials/essentials/head.html`: uses effective docs metadata for the HTML title and description.
- `website/themes/sambee/layouts/partials/search-modal.html`: scopes search to the active docs version on docs pages and to the current docs version elsewhere.
- `website/themes/sambee/layouts/_default/baseof.html`: emits Pagefind filter metadata for docs and site content.

### Version Switcher Fallback Order

When switching from one docs version to another, the target lookup order is:

1. Same page path.
2. Same section landing page.
3. Same book landing page.
4. Target version landing page.

## Build And Validation Scripts

For the planned editor automation layer that will manage versions, books, sections, and pages safely, see `documentation_website/WEBSITE_DOCS_EDITOR_TOOL.md`.

### `website/scripts/validate-docs-content.py`

This script validates docs content, navigation data, and inheritance rules.

It checks for:

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

Run it with:

```bash
cd website
npm run docs:validate
```

This script runs automatically as part of `npm run build`.

### `website/scripts/materialize-inherited-docs.py`

This script exists because Hugo does not have a built-in concept of an inheritance marker.

From Hugo's perspective, `inherit.md` and `_inherit.md` are just ordinary content files. If the site consumed them directly, Hugo would try to publish them as their own pages, which would create the wrong public URLs.

Example:

- `content/docs/1.1/end-user/getting-started/install/inherit.md` would naturally become a page at `/docs/1.1/end-user/getting-started/install/inherit/`
- `content/docs/1.1/_inherit.md` would naturally become a page at `/docs/1.1/_inherit/`

Those URLs are invalid for this docs model. The canonical public URL must stay attached to the folder path itself:

- `/docs/1.1/end-user/getting-started/install/`
- `/docs/1.1/`

That creates a routing gap:

- raw marker files must not become public pages
- but Hugo still needs a real page or section node at the requested folder path so the templates can run and the resolver can supply inherited content

This script fills that gap by creating transient Hugo anchors at the canonical folder paths. Concretely, during the build it:

- deleting any stale generated docs anchors under `website/.generated/content/docs/`
- scanning `website/content/docs/` for `inherit.md` and `_inherit.md`
- generating transient `index.md` or `_index.md` anchors at the matching folder paths under `website/.generated/content/docs/`
- marking those anchors with `inherit = true` so templates can recognize them as routing placeholders instead of real authored content

In practice, the build relies on three pieces working together:

- `website/hugo.toml` ignores raw `inherit.md` and `_inherit.md` files so Hugo does not publish `/inherit/` or `/_inherit/` URLs
- `website/scripts/materialize-inherited-docs.py` generates synthetic `index.md` and `_index.md` anchors at the corresponding folder paths
- `website/config/_default/module.toml` mounts `.generated/content` into Hugo's content tree so those synthetic anchors become the routable page nodes Hugo renders

The generated front matter is intentionally minimal. It only exists to make Hugo create the requested page node and to mark it with `inherit = true` so the templates know they are rendering a routing placeholder, not real authored content.

Without this script, the project would be stuck with two bad options:

- keep the raw marker files visible to Hugo and accept broken `/inherit/` and `/_inherit/` URLs
- ignore the marker files and lose the routable page nodes needed to render inherited docs at the canonical requested URLs

Operational notes:

- `website/.generated/` is build output and is ignored by Git.
- Hugo mounts `.generated/content` into the site content tree during the build.
- Hugo is configured to ignore raw `inherit.md` and `_inherit.md` files.

Run it with:

```bash
cd website
npm run docs:materialize-inherited
```

This script also runs automatically as part of `npm run build`.

### Build Commands

- `npm run docs:validate`: run docs validation only.
- `npm run docs:materialize-inherited`: regenerate transient inherited route anchors only.
- `npm run build`: generate theme assets, validate docs, materialize inherited routes, and build the site.
- `npm run build:search`: run the full site build and then generate the Pagefind search index.

## Search Behavior

Pagefind behavior for docs is intentionally version-aware.

- Search indexes the requested docs URL, not the resolved source version URL.
- Search does not de-duplicate inherited content across versions.
- On docs pages, the UI defaults search filters to the currently requested docs version.
- On non-docs pages, the UI defaults search filters to the `current` docs version from `website/data/docs-versions.toml`.
- Versions with `searchable = false` are excluded from docs search indexing.

## Quick Checklist

Before publishing docs changes:

1. Confirm the content path is correct.
2. Confirm each page folder has exactly one of `index.md` or `inherit.md`.
3. Confirm each version and book folder has exactly one of `_index.md` or `_inherit.md`.
4. Confirm section folders only use `_index.md` or `_inherit.md` when needed.
5. Confirm nav TOML ordering matches the intended visible docs structure.
6. Run `cd website && npm run docs:validate`.
7. Run `cd website && npm run build` or `cd website && npm run build:search` before shipping template or search changes.
