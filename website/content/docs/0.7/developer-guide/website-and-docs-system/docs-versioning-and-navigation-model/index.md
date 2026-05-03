+++
title = "Docs Versioning And Navigation Model"
description = "Understand how docs versions, books, sections, pages, and navigation data work together in the live Hugo site."
+++

Sambee's docs system is version-aware, path-derived, and intentionally strict about filesystem structure.

## Canonical Sources Of Truth

| File or area | Role |
|---|---|
| `website/data/docs-versions.toml` | declares the available docs versions and their order |
| `website/data/docs-nav/<version>.toml` | declares the book, section, and page order for one docs set |
| `website/content/docs/<version>/...` | holds the actual content for that docs set |

## Content Shape

Docs content is structured by path, not by repeated slugs in front matter.

- version landing page: `website/content/docs/<version>/_index.md`
- book landing page: `website/content/docs/<version>/<book>/_index.md`
- section landing page: `website/content/docs/<version>/<book>/<section>/_index.md`
- article page: `website/content/docs/<version>/<book>/<section>/<page>/index.md`

This keeps URLs, content paths, and navigation names aligned.

## Navigation Rules

The sidebar order is not inferred from the filesystem alone. It is driven by the matching file in `website/data/docs-nav/`.

For a new page to show up correctly, contributors usually need both:

1. the content file in the right folder
2. the matching section or page entry in the nav data file for that version

## Versioning And Inheritance

The docs system is designed to support inherited content across versions.

- versions are ordered canonically in `docs-versions.toml`
- later versions can inherit content from earlier ones instead of duplicating every page immediately
- page bundles use `index.md` for real content and can use inheritance markers where the docs system expects them
- effective content resolution walks backward through the declared version order until it finds real content

The build pipeline materializes inherited docs before the final site render, so contributors should preserve the expected folder conventions.

## Safe Change Checklist

When changing docs navigation or versioned docs content:

- keep the filesystem path aligned with the intended public URL
- update `docs-nav/<version>.toml` when section or page ordering changes
- keep book, section, and page boundaries consistent with the current docs architecture
- avoid changing slugs casually, because slug changes are also URL changes
- run `cd website && npm run build` before finishing the change

## Common Failure Modes

- adding a page without adding the corresponding nav entry
- changing a slug in content but not in navigation data
- treating planning files as live docs content
- duplicating content across books instead of keeping user, admin, and developer audiences separated

If you are changing the docs system itself rather than just authoring content, review the relevant planning and implementation notes before changing templates or inheritance behavior.

## Related Pages

- [Docs Authoring Workflow](../docs-authoring-workflow/): follow the normal content-update workflow without drifting into legacy folders
- [Docs Inheritance And Materialization](../docs-inheritance-and-materialization/): understand how inherited marker pages become routable and how effective content is resolved
