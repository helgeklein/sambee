+++
title = "Docs Authoring Workflow"
+++

For wording, list punctuation, and capitalization conventions, use the [Docs Style Guide](../docs-style-guide/).

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
