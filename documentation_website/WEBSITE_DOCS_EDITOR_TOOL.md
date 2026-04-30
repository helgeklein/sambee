# Website Docs Editor Tool

The docs editor CLI manages versioned website documentation safely and consistently.

Use it when you need to create, delete, or rename docs versions, books, sections, or pages without manually editing multiple files under:

- `website/content/docs/`
- `website/data/docs-nav/<version>.toml`
- `website/data/docs-versions.toml`

The tool is inheritance-aware. It updates content paths, nav data, and version metadata together, validates the result after successful apply operations, and refuses requests that would leave the docs tree invalid or silently overwrite newer authored content.

For the underlying docs content model, see `documentation_website/WEBSITE_DOCS_CONTENT.md`.

## Tool Location

The CLI lives at `website/scripts/docs-editor.py`.

Run it from the `website/` directory:

```bash
cd website
python3 scripts/docs-editor.py [global-options] <entity> <operation> [operation-options]
```

Examples:

```bash
python3 scripts/docs-editor.py version create 1.2 --after 1.1 --label 1.2
python3 scripts/docs-editor.py book rename --version 1.1 --from end-user --to user-guide
python3 scripts/docs-editor.py section delete --version 1.0 --book admin --section configuration
python3 scripts/docs-editor.py page create --version 1.1 --book developer --section architecture --page overview --inherit
```

## Normal Workflow

Use the tool in this order:

1. Run the command in preview mode first.
2. Review the planned file and metadata changes.
3. Re-run the command with `--apply` when the plan is correct.
4. Add `--yes` for destructive apply operations in non-interactive shells.

After a successful apply, the tool runs the same docs validation used by `python3 scripts/validate-docs-content.py`.

## Global Options

- `--apply`: write changes to disk instead of previewing them
- `--yes`: skip confirmation for destructive apply operations
- `--json`: emit machine-readable preview or result output
- `--quiet`: reduce non-error output
- `--verbose`: reserved for future detailed output

## Quick Start

### Preview A Non-Destructive Create

Create a page and inspect the plan before writing anything:

```bash
cd website
python3 scripts/docs-editor.py page create \
	--version 1.1 \
	--book developer \
	--section architecture \
	--page overview \
	--title "Architecture Overview"
```

Expected result:

- preview output listing the new page directory, `index.md`, and nav update
- no filesystem changes yet because `--apply` was not passed

Apply the same change:

```bash
cd website
python3 scripts/docs-editor.py --apply page create \
	--version 1.1 \
	--book developer \
	--section architecture \
	--page overview \
	--title "Architecture Overview"
```

### Preview A Destructive Rename

Use `--json` when you want a machine-readable plan for a rename that may propagate into inherited descendants:

```bash
cd website
python3 scripts/docs-editor.py --json page rename \
	--version 1.1 \
	--book end-user \
	--section getting-started \
	--from install \
	--to setup \
	--title "Setup Sambee"
```

Expected result:

- JSON with `result: preview`
- `metadata.propagated_versions` when later inherited-only versions will follow the rename
- `changes` entries showing the planned path rename and nav updates

Apply the rename:

```bash
cd website
python3 scripts/docs-editor.py --apply --yes page rename \
	--version 1.1 \
	--book end-user \
	--section getting-started \
	--from install \
	--to setup \
	--title "Setup Sambee"
```

### Recognize A Refusal Case

If a later version has real content at the affected path, destructive rename and delete operations refuse to proceed instead of rewriting that authored descendant silently.

```bash
cd website
python3 scripts/docs-editor.py --json section rename \
	--version 1.1 \
	--book admin \
	--from configuration \
	--to authentication \
	--title "Authentication"
```

Expected result:

- non-zero exit status
- an error explaining that the operation cannot continue across later versions with real content
- no files or nav data changed

## What The Tool Handles

The docs editor supports these operations:

### Versions

- create a new version after an existing version
- create a new version as the latest version
- delete a version

### Books

- create a book in a version
- delete a book in a version
- rename a book

### Sections

- create a section in a book in a version
- delete a section in a book in a version
- rename a section in a book in a version

### Pages

- create a page in a section in a version
- delete a page in a section in a version
- rename a page in a section in a version

## Safety Model

### Preview By Default

- No files are written unless you pass `--apply`.
- Preview output shows the planned file and metadata changes.
- Destructive operations require confirmation unless you pass `--yes`.

### Validation After Apply

After a successful apply operation, the tool runs docs validation before reporting success.

If validation fails, the operation fails with a non-zero exit status.

### Refusal Semantics

When the tool refuses an operation:

- it exits non-zero
- it prints the refusal reason to stderr
- it does not emit a preview payload for that refusal, even when `--json` is used
- it leaves the docs tree unchanged

### Forward-Impact Analysis

Changes in an older version can affect newer versions that still resolve through the same path. The tool analyzes that forward impact before destructive rename and delete operations.

Affected newer versions fall into these categories:

- inherited-only descendants: newer versions that only contain marker files for the affected path
- structural descendants: newer versions that keep the path only as structure, without landing-page content
- modified descendants: newer versions that contain real `_index.md` or `index.md` content at the affected path

Default behavior:

- inherited-only descendants are updated automatically in apply mode
- structural descendants are preserved where the operation allows it
- modified descendants block destructive rename and delete operations

## Content Rules The Tool Preserves

The docs editor preserves these invariants:

- docs identity remains path-derived
- `doc_id`, `product_version`, and `aliases` are not introduced
- page folders contain exactly one of `index.md` or `inherit.md`
- version and book folders contain exactly one of `_index.md` or `_inherit.md`
- section folders contain zero or one of `_index.md` or `_inherit.md`
- `inherit.md` and `_inherit.md` remain empty marker files
- version order in `website/data/docs-versions.toml` stays canonical
- nav data remains ordering-only metadata

### Real Content Stubs

When the tool creates real content, it writes a minimal front matter stub.

Defaults:

- page `index.md`: `title` defaults to a humanized page slug unless `--title` is provided
- section `_index.md`: `title` defaults to the section title from nav data unless `--title` is provided
- book `_index.md`: `title` defaults to a humanized book slug unless `--title` is provided
- version `_index.md`: `title` defaults to the version label unless `--title` is provided

### Inherited Markers

When the tool creates inherited content, it writes:

- empty `inherit.md` files for pages
- empty `_inherit.md` files for version, book, and section landing pages

No front matter or body content is written into marker files.

## Output Formats

### Human-Readable Preview

Preview output shows the operation, the target path or version, the planned file changes, and the metadata changes that will be made on apply.

### JSON Preview

JSON preview output includes:

- `result`
- `destructive`
- `apply`
- `metadata`
- `changes`

For propagated destructive operations, `metadata` includes `propagated_versions` when later inherited-only versions will follow the change.

## Operation Reference

## Version Operations

### `version create`

Purpose:

- add a docs version entry
- create the matching content tree
- initialize the new version to inherit from the previous version

Required input:

- new version slug
- one insertion selector: `--after <existing-version>` or `--latest`

Optional input:

- `--label <label>`
- `--status <status>`
- `--visible true|false`
- `--searchable true|false`
- `--set-current`

Example:

```bash
python3 scripts/docs-editor.py version create 1.2 --after 1.1 --label "1.2"
```

Behavior:

1. Inserts the new version into `website/data/docs-versions.toml`.
2. Creates `website/content/docs/<new-version>/`.
3. Creates `website/data/docs-nav/<new-version>.toml` from the previous version's nav data.
4. Mirrors the previous version's docs tree shape.
5. Creates inherited markers instead of copying authored content.

Bootstrap behavior:

- If `docs-versions.toml` has no declared versions, `--latest` bootstraps the first version instead of inheriting from a base version.
- In that case, the tool creates an authored version root with `_index.md`, creates an empty nav file, and sets the new version as `current`.
- This bootstrap path only works for a truly empty docs workspace. If version directories or version nav files still exist on disk, remove or reconcile them first.

Important details:

- the new version must not collide with an existing version slug
- the reference version must exist
- `current` changes only when `--set-current` is passed
- `searchable` defaults to `false` unless explicitly set otherwise

### `version delete`

Purpose:

- remove a version entry, its nav file, and its content directory

Required input:

- version slug

Optional input:

- `--new-current <version>` when deleting the current version

Example:

```bash
python3 scripts/docs-editor.py version delete 1.1
```

Behavior:

1. Removes the version from `website/data/docs-versions.toml`.
2. Removes `website/data/docs-nav/<version>.toml`.
3. Removes `website/content/docs/<version>/`.
4. Revalidates inheritance resolution across remaining versions.

Refusal cases:

- the version does not exist
- the version is current and `--new-current` was not supplied
- `--new-current` points to the deleted version
- `--new-current` does not exist after deletion
- `--new-current` was supplied while deleting a non-current version

## Book Operations

### `book create`

Required input:

- `--version <version>`
- `--book <slug>`

Optional input:

- `--title <title>`
- `--position <index|before:<slug>|after:<slug>|start|end>`
- `--inherit`

Example:

```bash
python3 scripts/docs-editor.py book create --version 1.1 --book tutorials --title "Tutorials" --position end
```

Behavior:

- creates `website/content/docs/<version>/<book>/`
- creates `_index.md` by default or `_inherit.md` with `--inherit`
- adds the book slug to `books` in the version nav file at the requested position
- initializes empty `sections.<book>` and `pages.<book>` structures as needed

Refusal cases:

- the version does not exist
- the destination book already exists
- the requested position is invalid
- `--inherit` was requested but no earlier version resolves that book lineage to real content

### `book delete`

Required input:

- `--version <version>`
- `--book <slug>`

Example:

```bash
python3 scripts/docs-editor.py book delete --version 1.1 --book tutorials
```

Behavior:

- removes the book folder from the target version
- removes the book from nav data
- removes matching `sections.<book>` and `pages.<book>` tables
- propagates through inherited-only descendants in later versions

Refusal cases:

- the target book does not exist
- a later version contains real content at the affected book path

### `book rename`

Required input:

- `--version <version>`
- `--from <old-slug>`
- `--to <new-slug>`

Optional input:

- `--title <new-title>` to rewrite the landing-page title when a real `_index.md` exists in the target version

Example:

```bash
python3 scripts/docs-editor.py book rename --version 1.1 --from end-user --to user-guide --title "User Guide"
```

Behavior:

- renames the book directory in the target version
- updates `books` ordering and the associated `sections` and `pages` tables
- propagates path changes into inherited-only later versions
- materializes the renamed path as real content in the target version when the source node was inherited-only

Refusal cases:

- the source book does not exist
- the destination book already exists
- a later version contains real content at the affected path

## Section Operations

### `section create`

Required input:

- `--version <version>`
- `--book <book>`
- `--section <slug>`

Optional input:

- `--title <title>`
- `--position <index|before:<slug>|after:<slug>|start|end>`
- `--inherit`
- `--structural-only`

Example:

```bash
python3 scripts/docs-editor.py section create --version 1.1 --book admin --section authentication --title "Authentication" --position end
```

Behavior:

- creates the section directory
- creates `_index.md` by default, `_inherit.md` with `--inherit`, or no landing file with `--structural-only`
- adds a section entry under `sections.<book>.items`
- initializes an empty `pages.<book>.<section>.items` array

Refusal cases:

- the target book does not exist
- the destination section already exists
- the requested position is invalid
- `--inherit` and `--structural-only` were used together
- `--inherit` was requested but no earlier version resolves that section lineage to real content

### `section delete`

Required input:

- `--version <version>`
- `--book <book>`
- `--section <slug>`

Example:

```bash
python3 scripts/docs-editor.py section delete --version 1.1 --book admin --section configuration
```

Behavior:

- removes the section directory from the target version
- removes the section entry from `sections.<book>.items`
- removes the matching `pages.<book>.<section>` table
- propagates through inherited-only descendants in later versions

Refusal cases:

- the target section does not exist
- a later version contains real content at the affected path

### `section rename`

Required input:

- `--version <version>`
- `--book <book>`
- `--from <old-slug>`
- `--to <new-slug>`

Optional input:

- `--title <new-title>` to update the displayed section title in nav data

Example:

```bash
python3 scripts/docs-editor.py section rename --version 1.1 --book admin --from configuration --to authentication --title "Authentication"
```

Behavior:

- renames the section directory
- updates `sections.<book>.items`
- moves the matching `pages.<book>.<section>` table to the new key
- propagates path changes into inherited-only later versions
- materializes the renamed path as real content in the target version when the source node was inherited-only
- preserves structural-only descendants as structural-only when no landing file exists at the renamed path

Refusal cases:

- the source section does not exist
- the destination section already exists
- a later version contains real content at the affected path

## Page Operations

### `page create`

Required input:

- `--version <version>`
- `--book <book>`
- `--section <section>`
- `--page <slug>`

Optional input:

- `--title <title>`
- `--position <index|before:<slug>|after:<slug>|start|end>`
- `--inherit`

Example:

```bash
python3 scripts/docs-editor.py page create --version 1.1 --book developer --section architecture --page overview --title "Architecture Overview"
```

Behavior:

- creates the page directory
- creates `index.md` by default or `inherit.md` with `--inherit`
- adds the page slug to `pages.<book>.<section>.items` at the requested position

Refusal cases:

- the target section does not exist
- the destination page already exists
- the requested position is invalid
- `--inherit` was requested but no earlier version resolves that page lineage to real content

### `page delete`

Required input:

- `--version <version>`
- `--book <book>`
- `--section <section>`
- `--page <slug>`

Example:

```bash
python3 scripts/docs-editor.py page delete --version 1.1 --book end-user --section getting-started --page install
```

Behavior:

- removes the page directory from the target version
- removes the page slug from `pages.<book>.<section>.items`
- propagates through inherited-only descendants in later versions

Refusal cases:

- the target page does not exist
- a later version contains real content at the affected path

### `page rename`

Required input:

- `--version <version>`
- `--book <book>`
- `--section <section>`
- `--from <old-slug>`
- `--to <new-slug>`

Optional input:

- `--title <new-title>` to update the page title when a real `index.md` exists in the target version

Example:

```bash
python3 scripts/docs-editor.py page rename --version 1.1 --book end-user --section getting-started --from install --to setup --title "Setup Sambee"
```

Behavior:

- renames the page directory
- updates `pages.<book>.<section>.items`
- propagates path changes into inherited-only later versions
- materializes the renamed path as real content in the target version when the source node was inherited-only

Refusal cases:

- the source page does not exist
- the destination page already exists
- a later version contains real content at the affected path

## Notes

- The tool does not edit `website/.generated/` directly.
- The tool does not run `materialize-inherited-docs.py` for you.
- The tool does not edit page body content or offer free-form front matter editing.
