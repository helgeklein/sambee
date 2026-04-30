+++
title = "Docs Authoring Workflow"
description = "Write and update live docs pages in the Hugo site without drifting back into legacy markdown folders or breaking versioned navigation."
+++

The live docs books are authored in the website, not in the legacy source-material folders.

## Destination Versus Source Material

Use these folders for different jobs:

| Area | Use it for |
|---|---|
| `website/content/docs/` | final, published docs content |
| `website/data/docs-nav/` | version-specific sidebar ordering |
| `documentation/` | source material to migrate into User or Admin docs |
| `documentation_developers/` | source material to migrate into Developer Guide pages |
| `documentation_planning/website/` | planning, rollout decisions, and docs-system design notes |

If readers should see it on the public docs site, it belongs under `website/content/docs/`.

## Standard Authoring Steps

1. decide which book owns the topic: user, admin, or developer
2. decide which docs version you are updating
3. create or update the content bundle at the path that matches the intended URL
4. add or update the matching nav entry in `website/data/docs-nav/<version>.toml`
5. run the website build before finishing the change

## Content Structure Rules

The docs system is path-derived.

- book landing page: `website/content/docs/<version>/<book>/_index.md`
- section landing page: `website/content/docs/<version>/<book>/<section>/_index.md`
- article page: `website/content/docs/<version>/<book>/<section>/<page>/index.md`

Do not rely on front matter to redefine page identity. The path is the identity.

## Navigation Workflow

Adding content alone is not enough for the sidebar.

When you add or rename a section or article:

- update the matching `docs-nav/<version>.toml` file
- keep slugs aligned between the folder names and nav entries
- treat slug changes as URL changes, not cosmetic edits

## Working With Versions And Inheritance

Docs versions are declared in `website/data/docs-versions.toml` in canonical release order.

The docs system is designed to support inherited content across versions, so contributors should respect the expected content model.

- `index.md` and `_index.md` are real content files
- inheritance markers are part of the versioned docs system and should not be treated as free-form markdown pages
- versioned docs changes should preserve the expected folder layout so validation and materialization still work

## Authoring Rules That Prevent Drift

- do not send readers back to `documentation/` or `documentation_developers/` as if those were the live docs books
- do not mix user-facing tasks, admin operations, and contributor implementation guidance into one page just because the source material started that way
- do not create nav-only pages or content-only pages that leave the other side out of sync
- do not invent ad hoc folder shapes that break the versioned path model

## Standard Validation

For docs or website changes, run:

```bash
cd website && npm run build
```

For local iteration on the site itself, use:

```bash
./scripts/start-website
```

The build runs theme generation, docs validation, docs inheritance materialization, and the Hugo site build, so it is the minimum meaningful verification for docs work.

## Related Pages

- [How To Plan And Review A Change](../../contribution-workflows/how-to-plan-and-review-a-change/): decide scope, docs impact, and validation before the implementation sprawls
- [Dependency And Release Workflow](../../release-and-versioning/dependency-and-release-workflow/): use this when doc version metadata or other release-sensitive files are part of the change
- [Docs Inheritance And Materialization](../docs-inheritance-and-materialization/): use this when you are changing the inheritance machinery rather than just authoring content
