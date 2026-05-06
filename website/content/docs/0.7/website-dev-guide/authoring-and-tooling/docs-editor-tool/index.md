+++
title = "Docs Editor Tool"
+++

The docs editor CLI manages structural website docs changes safely and consistently.

Use it when you need to change the shape of the docs tree across:

- `website/content/docs/`
- `website/data/docs-nav/<version>.toml`
- `website/data/docs-versions.toml`

For ordinary copy edits inside an existing page, edit the Markdown file directly instead.

## Tool Location

The CLI lives at `website/scripts/docs-editor.py`.

Run it from the `website/` directory:

```bash
cd website
python3 scripts/docs-editor.py [global-options] <entity> <operation> [operation-options]
```

## Normal Workflow

Use the tool in this order:

1. run the command in preview mode first
2. review the planned file and metadata changes
3. rerun the command with `--apply` when the plan is correct
4. add `--yes` for destructive apply operations in non-interactive shells

After a successful apply, the tool runs docs validation automatically.

## What the Tool Handles

The docs editor supports four entity types:

- versions
- books
- sections
- pages

Supported structural operations include:

- create a docs book
- delete a docs book
- rename a docs book
- create a section
- delete a section
- rename a section
- create a page
- delete a page
- rename a page

## Example: Preview a New Book

```bash
cd website
python3 scripts/docs-editor.py book create \
  --version 0.7 \
  --book website-dev-guide \
  --title "Website Dev Guide" \
  --position after:developer-guide
```

Apply the same change:

```bash
cd website
python3 scripts/docs-editor.py --apply book create \
  --version 0.7 \
  --book website-dev-guide \
  --title "Website Dev Guide" \
  --position after:developer-guide
```

## Example: Create a Structural-Only Section

This is useful when you want a navigation group without a section landing page.

```bash
cd website
python3 scripts/docs-editor.py section create \
  --version 0.7 \
  --book website-dev-guide \
  --section authoring-and-tooling \
  --title "Authoring And Tooling" \
  --position end \
  --structural-only
```

That creates the section directory and nav entry without `_index.md` or `_inherit.md`.

## Example: Preview a New Page

```bash
cd website
python3 scripts/docs-editor.py page create \
  --version 0.7 \
  --book website-dev-guide \
  --section authoring-and-tooling \
  --page docs-editor-tool \
  --title "Docs Editor Tool"
```

Apply it:

```bash
cd website
python3 scripts/docs-editor.py --apply page create \
  --version 0.7 \
  --book website-dev-guide \
  --section authoring-and-tooling \
  --page docs-editor-tool \
  --title "Docs Editor Tool"
```

## Example: Rename a Page Safely

```bash
cd website
python3 scripts/docs-editor.py page rename \
  --version 0.7 \
  --book website-dev-guide \
  --section docs-platform \
  --from docs-versioning-and-navigation-model \
  --to docs-content-model-navigation-and-inheritance \
  --title "Docs Content Model, Navigation, And Inheritance"
```

That preview is especially useful when a rename may propagate into inherited descendants.

## Safety Model

The docs editor is deliberately conservative.

- preview is the default
- no files are written unless you pass `--apply`
- destructive operations require confirmation unless you pass `--yes`
- docs validation runs automatically after a successful apply

## Refusal Semantics

The tool refuses destructive operations when they would silently rewrite newer authored content.

Typical refusal case:

- an older version rename would force changes into a later version that already has real content at the affected path

In that case, the CLI exits non-zero, reports the refusal reason, and leaves the docs tree unchanged.

## Detailed Reference

The full CLI reference now lives on a separate page so this overview can stay task-focused.

Use [Docs Editor Operation Reference](../docs-editor-operation-reference/) when you need:

- the full global option list
- forward-impact analysis rules
- content invariants preserved by the tool
- real-content stub and inherited-marker behavior
- preview output details
- per-entity create, delete, and rename reference behavior

## When the Tool Is Better than Manual Edits

Use the CLI when the change touches structure and ordering together.

Examples:

- introducing a new book
- reorganizing sections
- renaming a page slug
- deleting a page that may exist through inheritance in later versions

Manual file edits are still fine for revising the body text of an existing page.

## Related Pages

- [Docs Authoring Workflow](../docs-authoring-workflow/): normal content work before or after the structural change
- [Docs Editor Operation Reference](../docs-editor-operation-reference/): option details, output formats, and per-operation behavior
- [Docs Content Model, Navigation, and Inheritance](../../docs-platform/docs-content-model-navigation-and-inheritance/): the invariants the tool is designed to preserve
