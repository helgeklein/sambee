+++
title = "Docs Inheritance And Materialization"
description = "Understand how inherited docs markers are validated, materialized into Hugo route anchors, and resolved to effective content at render time."
+++

Sambee's docs inheritance system has two separate responsibilities.

- reduce duplicated content across docs versions
- still give Hugo a concrete page tree it can route and render

The implementation deliberately splits those responsibilities across validation, generated anchors, and render-time effective-page resolution.

## Marker Model

Inherited docs pages do not behave like normal markdown content files.

- article bundles use `index.md` for real content or `inherit.md` as an empty marker
- branch bundles that participate in landing-page inheritance use `_index.md` for real content or `_inherit.md` as an empty marker
- marker files are control files only; they are not alternate places to store front matter or body content

The validator rejects broken combinations such as both real content and a marker in the same bundle.

## Build-Time Pipeline

The website build runs the inheritance workflow in a fixed order.

1. `npm run build` runs `docs:validate`
2. `website/scripts/validate-docs-content.py` checks nav structure, bundle-shape rules, marker emptiness, legacy metadata, and inheritance-chain validity
3. `npm run build` then runs `docs:materialize-inherited`
4. `website/scripts/materialize-inherited-docs.py` scans marker files and generates route anchors under `.generated/content/docs`
5. Hugo mounts both `content` and `.generated/content` through `website/config/_default/module.toml`

Those generated anchors exist so Hugo can route inherited pages normally even though the requested version might not contain real content of its own.

## Why Materialization Exists

Hugo needs an actual page object at the requested path.

For inherited pages, the materializer writes minimal generated `_index.md` or `index.md` files with `inherit = true` into the `.generated` tree. That gives the requested URL a routable Hugo page without pretending that the generated file is the real content source.

## Render-Time Resolution

Generated anchors are only the routing layer. The actual content still comes from the effective source page.

- `themes/sambee/layouts/partials/docs/effective-page.html` walks backward through `website/data/docs-versions.toml`
- it looks for the first non-marker page at the same version, book, section, and page path
- `themes/sambee/layouts/partials/docs/render-data.html` passes that effective page into the docs templates

That means the requested URL and requested version stay stable, while titles, body content, and TOC can still come from an older real page when inheritance applies.

## What Contributors Must Preserve

- keep marker files empty
- keep path identity stable across versions so inheritance can resolve the same logical page
- update validator, materializer, and docs templates together when changing inheritance behavior
- replace a marker with real content when a newer version genuinely diverges instead of layering special cases into templates

## Common Failure Modes

- adding `inherit.md` or `_inherit.md` with body content or front matter
- changing nav or slugs without keeping the inherited path stable across versions
- changing template resolution logic without updating validation or materialization rules
- assuming the generated anchor file is the same thing as the effective content source

## Validation Expectations

When this system changes, run the full website build:

```bash
cd website && npm run build
```

If the change touches editor or inheritance tooling directly, also review the docs-editor and website tests that exercise inheritance rules.

## Related Pages

- [Docs Versioning And Navigation Model](../docs-versioning-and-navigation-model/): understand the user-facing content and nav model first
- [Docs Authoring Workflow](../docs-authoring-workflow/): use the normal workflow when you are authoring content rather than changing inheritance internals
