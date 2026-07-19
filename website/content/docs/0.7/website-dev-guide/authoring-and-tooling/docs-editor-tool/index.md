+++
title = "Docs Editor Tool"
+++

The docs editor CLI manages structural website docs changes safely and consistently. For ordinary copy edits inside an existing page, edit the Markdown file directly instead.

Preview is the default mode. Run a command once to inspect the plan, then rerun it with `--apply` when the preview matches what you want.

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
2. review the planned metadata and file changes
3. rerun the command with `--apply` when the plan is correct
4. add `--yes` for destructive apply operations in non-interactive shells

After a successful apply, the tool runs docs validation automatically.

The human-readable preview now shows:

- the operation summary
- the key metadata for the operation
- the planned file and nav changes

## What the Tool Handles

The docs editor supports four entity types:

- versions
- books
- sections
- pages

Supported structural operations include:

- creating
- deleting
- renaming

## Common Tasks

Use the built-in help when you know the action but not the exact flags:

```bash
cd website
python3 scripts/docs-editor.py --help
python3 scripts/docs-editor.py page create --help
```

Use these commands as a starting point for the most common workflows:

- add a new page
- rename a page or section
- create a new docs version that inherits from the latest one

## Example: Create a New Version

This example:

- creates `0.8` as a new version
- adds it as to the end of the version list as the newest version (`--latest`)
- adds the status label `preview` (which is shown in the UI)

```bash
cd website
python3 scripts/docs-editor.py version create 0.8 \
  --latest \
  --status preview
```

Apply the same change:

```bash
cd website
python3 scripts/docs-editor.py --apply version create 0.8 \
  --latest \
  --status preview
```

## Example: Create a New Book

```bash
cd website
python3 scripts/docs-editor.py book create \
  --version 0.7 \
  --book tutorials \
  --title "Tutorials"
```

Apply the same change:

```bash
cd website
python3 scripts/docs-editor.py --apply book create \
  --version 0.7 \
  --book tutorials \
  --title "Tutorials"
```

## Example: Create a Structural-Only Book

Use this when a book is only a navigation container and should not have a landing page of its own.

```bash
cd website
python3 scripts/docs-editor.py book create \
  --version 0.7 \
  --book release-info \
  --position start \
  --structural-only
```

That creates the book directory and nav entry without `_index.md` or `_inherit.md`.

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

## Example: Create a New Page

```bash
cd website
python3 scripts/docs-editor.py page create \
  --version 0.7 \
  --book website-dev-guide \
  --section authoring-and-tooling \
  --page docs-editor-quickstart \
  --title "Docs Editor Quickstart"
```

Apply it:

```bash
cd website
python3 scripts/docs-editor.py --apply page create \
  --version 0.7 \
  --book website-dev-guide \
  --section authoring-and-tooling \
  --page docs-editor-quickstart \
  --title "Docs Editor Quickstart"
```

## Example: Rename a Page

```bash
cd website
python3 scripts/docs-editor.py page rename \
  --version 0.7 \
  --book website-dev-guide \
  --section docs-platform \
  --from website-and-docs-architecture-overview \
  --to website-and-docs-system-overview \
  --title "Website And Docs System Overview"
```

That preview is especially useful when a rename may propagate into inherited descendants, because the metadata section shows which later inherited versions will follow the rename.

## Convert an Inherited Page to Real Content

Sometimes a later version already has the page path and nav entry, but the page itself is still inherited through an empty `inherit.md` marker.

In that case, do not use `page create`. The page already exists structurally.

Instead:

1. Identify the inherited source page you want to override.
1. Copy that page's current content into the later version as a starting point.
1. Replace the later version's empty `inherit.md` with a real `index.md`.
1. Edit the new `index.md` for the version-specific behavior.

This is a manual content-materialization step, not a page-creation step. The docs editor currently manages page identity and nav structure, but it does not provide a dedicated command that turns an existing inherited page marker into authored page content.

If a position selector fails, the CLI also reports the valid sibling slugs so you can retry without opening the nav file first.

## Safety Model

The docs editor is deliberately conservative.

- preview is the default
- no files are written unless you pass `--apply`
- destructive operations require confirmation unless you pass `--yes`
- docs validation runs automatically after a successful apply

### Refusal Semantics

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
