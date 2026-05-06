+++
title = "Docs Authoring Workflow"
+++

The live docs are authored in the website, not in the source-material folders.

## Know the Destination

Use these locations for different jobs:

| Area | Use it for |
|---|---|
| published docs content | final content that readers see on the website |
| docs navigation data | published navigation order for one version |
| user and admin source notes | working material that may later become User Guide or Admin Guide content |
| developer source notes | working material that may later become Developer Guide content |
| planning notes | rollout and design material, not published docs |

If readers should see it on the website, the content belongs under `website/content/docs/`.

## Choose the Right Book First

Before you write anything, decide which public docs book owns the topic.

- `user-guide`: user tasks and product usage
- `admin-guide`: deployment, configuration, operations, troubleshooting, and escalation
- `developer-guide`: backend, frontend, companion, and product implementation topics
- `website-dev-guide`: website editing, docs authoring, docs tooling, routing, media, typography, and website theme internals

Picking the wrong book usually creates duplication later.

## Standard Workflow

For a normal content change:

1. choose the book, section, page, and docs version
2. create or update the content file at the path that matches the intended URL
3. add or update the matching nav entry in `website/data/docs-nav/<version>.toml`
4. run the website build before you consider the work done

## Content Structure Rules

The docs system is path-derived.

- book landing page: `website/content/docs/<version>/<book>/_index.md`
- section landing page: `website/content/docs/<version>/<book>/<section>/_index.md`
- article page: `website/content/docs/<version>/<book>/<section>/<page>/index.md`

Section landing pages are optional. A section may be structural only, with no `_index.md` and no `_inherit.md`. This Website Dev Guide uses structural-only sections.

## Example: Add a New Page

Suppose you want a new page under `website-dev-guide/authoring-and-tooling/`.

Create the content bundle:

```text
website/content/docs/0.7/website-dev-guide/authoring-and-tooling/new-page/index.md
```

Then add the page slug to the matching nav section:

```toml
[pages.website-dev-guide.authoring-and-tooling]
items = [
  "docs-authoring-workflow",
  "docs-editor-tool",
  "new-page",
]
```

Without the nav update, the page may exist on disk but stay absent from generated navigation.

## Example: Reuse an Older Page without Copying the Content

When a newer version should reuse the same page unchanged:

1. create the same page folder in the newer version
2. add an empty `inherit.md`
3. keep the corresponding path in an older version with real `index.md` content

Example:

```text
website/content/docs/0.8/website-dev-guide/site-systems/media-publishing-workflow/inherit.md
```

Do not put front matter or body content into `inherit.md`.

## Example: Diverge in a Newer Version

If a newer version needs different content, replace the marker with a real page:

1. remove `inherit.md`
2. create `index.md`
3. write the new content for that version

That keeps the inheritance chain explicit and avoids template-side special cases.

## Navigation Rules

Navigation data controls order, not content. Keep these rules in mind:

- slugs in the nav file must match the folder names on disk
- changing a slug changes the public URL
- page titles come from the page's own front matter, not from the nav file
- section titles come from `docs-nav/<version>.toml`

## Legacy Website Notes Should Be Reshaped, Not Mirrored Blindly

If you are migrating older website implementation notes or planning material, treat them as source material rather than as publishable docs.

When you migrate or update that material:

- keep active technical contracts
- remove planning-only or obsolete statements
- split large internal notes into reader-oriented public pages when that improves navigation
- keep examples when they make the workflow easier to follow

The published Website Dev Guide is now the canonical destination for website editing and website implementation docs.

## When to Use the Docs Editor Instead of Manual File Edits

Manual edits are normal for copy changes inside an existing page.

Use the docs editor when the change is structural, for example:

- creating a new book
- creating, deleting, or renaming a section
- creating, deleting, or renaming a page
- changing docs structure across inherited versions

The docs editor keeps content paths and nav data in sync and refuses destructive changes that would silently overwrite newer authored content.

## Validation

For docs and website changes, run:

```bash
cd website
npm run build
```

That is the minimum meaningful verification because it runs theme generation, docs validation, inherited-doc materialization, Hugo rendering, and homepage CTA validation.

## Related Pages

- [Docs Content Model, Navigation, and Inheritance](../../docs-platform/docs-content-model-navigation-and-inheritance/): path and marker rules behind the workflow
- [Docs Editor Tool](../docs-editor-tool/): structural changes that should go through the CLI
- [Website and Docs Architecture Overview](../../docs-platform/website-and-docs-architecture-overview/): broader context for the website build and docs runtime
