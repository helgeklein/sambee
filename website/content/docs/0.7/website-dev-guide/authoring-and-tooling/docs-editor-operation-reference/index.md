+++
title = "Docs Editor Operation Reference"
+++

Use this page when you already know you need the docs editor and want the detailed reference behavior.

## Position Selectors

Operations that insert books, sections, or pages use the same position syntax:

- `<index>`: insert at a zero-based numeric index
- `before:<slug>`: insert immediately before the existing item
- `after:<slug>`: insert immediately after the existing item
- `start`: insert at the beginning
- `end`: insert at the end

If the requested selector does not resolve cleanly in the target nav list, the operation refuses instead of guessing.

## Global Options

The CLI supports these global options:

- `--apply`: write changes to disk instead of previewing them
- `--yes`: skip confirmation for destructive apply operations
- `--json`: emit machine-readable preview or result output
- `--quiet`: reduce non-error output
- `--verbose`: reserved for future detailed output

## Forward-Impact Analysis

Changes in an older version can affect newer versions that still resolve through the same path. The tool analyzes that forward impact before destructive rename and delete operations.

Affected newer versions fall into these categories:

- inherited-only descendants: newer versions that contain only marker files for the affected path
- structural descendants: newer versions that keep the path only as structure, without landing-page content
- modified descendants: newer versions that contain real `_index.md` or `index.md` content at the affected path

Default behavior:

- inherited-only descendants are updated automatically in apply mode
- structural descendants are preserved where the operation allows it
- modified descendants block destructive rename and delete operations

## Content Rules the Tool Preserves

The docs editor preserves these invariants:

- docs identity remains path-derived
- `doc_id`, `product_version`, and `aliases` are not introduced
- page folders contain exactly one of `index.md` or `inherit.md`
- version and book folders contain exactly one of `_index.md` or `_inherit.md`
- section folders contain zero or one of `_index.md` or `_inherit.md`
- `inherit.md` and `_inherit.md` remain empty marker files
- version order in `website/data/docs-versions.toml` stays canonical
- nav data remains ordering-only metadata

## Real Content Stubs

When the tool creates real content, it writes a minimal front matter stub.

Defaults:

- page `index.md`: `title` defaults to a humanized page slug unless `--title` is provided
- section `_index.md`: `title` defaults to the section title from nav data unless `--title` is provided
- book `_index.md`: `title` defaults to a humanized book slug unless `--title` is provided
- version `_index.md`: `title` defaults to the version label unless `--title` is provided

## Inherited Markers

When the tool creates inherited content, it writes:

- empty `inherit.md` files for pages
- empty `_inherit.md` files for version, book, and section landing pages

No front matter or body content is written into marker files.

## Output Formats

Human-readable preview output shows the operation, the target path or version, the planned file changes, and the metadata changes that will be made on apply.

JSON preview output includes:

- `result`
- `destructive`
- `apply`
- `metadata`
- `changes`

For propagated destructive operations, `metadata` includes `propagated_versions` when later inherited-only versions will follow the change.

## Operation Reference

### Version Operations

`version create` adds a new docs version, creates the matching content tree, initializes the new version to inherit from the previous version, and creates a matching nav file.

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
cd website
python3 scripts/docs-editor.py version create 1.2 --after 1.1 --label "1.2"
```

Behavior:

1. inserts the new version into `website/data/docs-versions.toml`
2. creates `website/content/docs/<new-version>/`
3. creates `website/data/docs-nav/<new-version>.toml` from the previous version's nav data
4. mirrors the previous version's docs tree shape
5. creates inherited markers instead of copying authored content

Bootstrap behavior:

- if `docs-versions.toml` has no declared versions, `--latest` bootstraps the first version instead of inheriting from a base version
- in that case, the tool creates an authored version root with `_index.md`, creates an empty nav file, and sets the new version as `current`
- this bootstrap path only works for a truly empty docs workspace; if version directories or version nav files still exist on disk, reconcile or remove them first

Important details:

- the new version slug must not collide with an existing version
- the reference version must exist
- `current` changes only when `--set-current` is passed
- `searchable` defaults to `false` unless explicitly set otherwise

`version delete` removes a version entry, its nav file, and its content directory.

Required input:

- version slug

Optional input:

- `--new-current <version>` when deleting the current version

Example:

```bash
cd website
python3 scripts/docs-editor.py version delete 1.1
```

Behavior:

1. removes the version from `website/data/docs-versions.toml`
2. removes `website/data/docs-nav/<version>.toml`
3. removes `website/content/docs/<version>/`
4. revalidates inheritance resolution across remaining versions

Refusal cases:

- the version does not exist
- the version is current and `--new-current` was not supplied
- `--new-current` points to the deleted version
- `--new-current` does not exist after deletion
- `--new-current` was supplied while deleting a non-current version

### Book Operations

`book create` creates a book folder, writes `_index.md` by default or `_inherit.md` with `--inherit`, and inserts the book into the version nav file.

Optional input includes `--position <index|before:<slug>|after:<slug>|start|end>`.

Example:

```bash
cd website
python3 scripts/docs-editor.py book create --version 1.1 --book tutorials --title "Tutorials" --position end
```

`book delete` removes the book folder, the book entry in nav data, and the matching `sections.<book>` and `pages.<book>` data.

`book rename` renames the book directory, updates `books` ordering plus the associated `sections` and `pages` tables, and propagates inherited-only descendants when allowed.

Example:

```bash
cd website
python3 scripts/docs-editor.py book rename --version 1.1 --from end-user --to user-guide --title "User Guide"
```

### Section Operations

`section create` creates a section directory, adds a section entry in nav data, and initializes an empty `pages.<book>.<section>.items` array.

By default it creates `_index.md`. With `--inherit`, it creates `_inherit.md`. With `--structural-only`, it creates no landing file. Optional input includes `--position <index|before:<slug>|after:<slug>|start|end>`.

Example:

```bash
cd website
python3 scripts/docs-editor.py section create --version 1.1 --book admin --section authentication --title "Authentication" --position end
```

`section delete` removes the section directory, its nav entry, and the matching `pages.<book>.<section>` table.

`section rename` renames the section directory, updates `sections.<book>.items`, moves the matching `pages.<book>.<section>` table to the new key, and preserves structural-only descendants as structural-only when no landing file exists at the renamed path.

Example:

```bash
cd website
python3 scripts/docs-editor.py section rename --version 1.1 --book admin --from configuration --to authentication --title "Authentication"
```

### Page Operations

`page create` creates the page directory, writes `index.md` by default or `inherit.md` with `--inherit`, and adds the page slug to `pages.<book>.<section>.items`.

Optional input includes `--position <index|before:<slug>|after:<slug>|start|end>`.

Example:

```bash
cd website
python3 scripts/docs-editor.py page create --version 1.1 --book developer --section architecture --page overview --title "Architecture Overview"
```

`page delete` removes the page directory and the matching page slug from nav data.

`page rename` renames the page directory, updates `pages.<book>.<section>.items`, and propagates inherited-only descendants when allowed.

Example:

```bash
cd website
python3 scripts/docs-editor.py page rename --version 1.1 --book end-user --section getting-started --from install --to setup --title "Setup Sambee"
```

## Notes

- the tool does not edit `website/.generated/` directly
- the tool does not run `materialize-inherited-docs.py` for you
- the tool does not edit page body content or offer free-form front matter editing
