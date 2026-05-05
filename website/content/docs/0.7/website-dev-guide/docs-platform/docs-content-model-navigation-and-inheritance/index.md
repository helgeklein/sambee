+++
title = "Docs Content Model, Navigation, and Inheritance"
description = "Understand the path-derived docs model, the navigation data contract, and how inherited content becomes routable and renderable in the website."
+++

Sambee's docs system is intentionally strict. That is a feature, not incidental complexity.

The strict rules keep URLs, page identity, navigation, inheritance, and render-time resolution aligned.

## Core Model

Docs identity is path-derived under `website/content/docs/`.

```text
website/content/docs/<version>/<book>/<section>/<page>/index.md
```

The path itself defines the docs identity:

- version slug: `content/docs/<version>/`
- book slug: `content/docs/<version>/<book>/`
- section slug: `content/docs/<version>/<book>/<section>/`
- page slug: `content/docs/<version>/<book>/<section>/<page>/`

Do not duplicate that identity in front matter.

Docs pages must not introduce:

- `doc_id`
- `product_version`
- `aliases`

## Public URL Contract

For the current docs version, the canonical public routes are stable and unversioned:

- `/docs/<book>/`
- `/docs/<book>/<section>/`
- `/docs/<book>/<section>/<page>/`

Archived versions remain available at explicit versioned routes:

- `/docs/<version>/`
- `/docs/<version>/<book>/`
- `/docs/<version>/<book>/<section>/`
- `/docs/<version>/<book>/<section>/<page>/`

Explicit current-version URLs under `/docs/<current>/...` are compatibility routes. They should redirect to the matching stable current route.

## Filesystem Contract

The docs system allows real authored content and inheritance markers. The allowed combinations are strict.

### Page Folders

A page folder under `website/content/docs/<version>/<book>/<section>/<page>/` must contain exactly one of:

- `index.md`: real page content
- `inherit.md`: empty inheritance marker

Do not keep both files in the same page folder.

### Version and Book Folders

A version folder or book folder must contain exactly one of:

- `_index.md`: real landing-page content
- `_inherit.md`: empty inheritance marker

### Section Folders

A section folder may contain zero or one of:

- `_index.md`: real section landing-page content
- `_inherit.md`: empty inheritance marker

No file is valid and means the section is structural only. This Website Dev Guide uses that pattern: the section folders group pages in navigation, but the guide does not create separate section landing pages.

## Marker Files Are Markers Only

Inheritance markers do not carry content or override metadata.

- `inherit.md` must be empty and have no front matter.
- `_inherit.md` must be empty and have no front matter.

If a newer version needs different content, replace the marker with real content instead of trying to add special-case metadata to the marker file.

## Navigation Data Contract

Navigation data lives in `website/data/docs-nav/<version>.toml`.

These files define ordering only.

- `books` orders books
- `[[sections.<book>.items]]` orders sections and gives each section a displayed title
- `[pages.<book>.<section>].items` orders pages inside one section

Example:

```toml
books = [
  "user-guide",
  "admin-guide",
  "developer-guide",
  "website-dev-guide",
]

[[sections.website-dev-guide.items]]
slug = "authoring-and-tooling"
title = "Authoring and Tooling"

[pages.website-dev-guide.authoring-and-tooling]
items = [
  "docs-authoring-workflow",
  "docs-editor-tool",
]
```

Navigation data does not define:

- URLs
- page titles
- page existence
- inheritance behavior

Those come from the content tree and the effective-page resolver.

## Version Order and Current Version

Version metadata lives in `website/data/docs-versions.toml`.

Important rules:

- versions are listed in ascending release order, oldest to newest
- that declaration order is canonical
- inheritance only walks backward through that order
- the `current` key defines the version that publishes at stable unversioned routes

Do not infer chronology from the version slug string itself. Use the declared order.

## Inheritance Resolution

When Hugo renders a docs URL for a version, the system checks the requested version first and then walks backward through earlier versions until it finds real content.

For article pages, the resolution order is:

1. check `index.md` at the requested path
2. if present, use it
3. otherwise, if `inherit.md` exists, move to the previous declared version and check the same path
4. if neither file exists, validation should fail
5. if the backward scan ends without finding real content, validation should fail

Landing-page resolution follows the same pattern with `_index.md` and `_inherit.md`.

Example:

```text
content/docs/0.7/website-dev-guide/docs-platform/website-and-docs-architecture-overview/index.md
content/docs/0.8/website-dev-guide/docs-platform/website-and-docs-architecture-overview/inherit.md
```

In that case, the `0.8` route remains routable, but the content comes from the `0.7` authored page until `0.8` diverges.

## Safe Change Checklist

When changing docs content, navigation, or routing behavior:

- keep the filesystem path aligned with the intended public URL
- update `docs-nav/<version>.toml` when section or page ordering changes
- treat slug changes as URL changes, not cosmetic edits
- keep marker files empty
- preserve the expected file combinations for pages, books, and sections
- run the website build before finishing

## Common Failure Modes

- adding a page without adding the corresponding nav entry
- changing a slug in content but not in nav data
- leaving both `index.md` and `inherit.md` in one page folder
- adding content or front matter to `inherit.md` or `_inherit.md`
- putting published content into a source-material folder and assuming it is live docs
- changing template or script behavior without preserving the same docs path contract

## Validation Commands

Use the full website build for meaningful verification:

```bash
cd website
npm run build
```

If you only need docs structure validation while iterating on content-model rules, run:

```bash
cd website
npm run docs:validate
```

If you are changing inheritance or route-anchor behavior directly, also regenerate the transient anchors during testing:

```bash
cd website
npm run docs:materialize-inherited
```

## Related Pages

- [Website and Docs Architecture Overview](../website-and-docs-architecture-overview/): use this first if you need the broader site layout and build pipeline
- [Docs Runtime and Route Resolution](../docs-runtime-and-route-resolution/): use this for template resolution, stable current routes, materialization, and docs search behavior
- [Docs Authoring Workflow](../../authoring-and-tooling/docs-authoring-workflow/): use this for normal content updates
- [Docs Editor Tool](../../authoring-and-tooling/docs-editor-tool/): use this for structural docs changes

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
- `npm run docs:materialize-inherited`: regenerate transient inherited-route and stable current-route anchors
- `npm run build`: generate theme assets, validate docs, materialize docs route anchors, and build the site
- `npm run build:search`: run the full build and then generate the Pagefind search index

## Related Pages

- [Website and Docs Architecture Overview](../website-and-docs-architecture-overview/): broader site layout and build pipeline
- [Docs Content Model, Navigation, and Inheritance](../docs-content-model-navigation-and-inheritance/): path-derived identity, filesystem rules, and inheritance model
