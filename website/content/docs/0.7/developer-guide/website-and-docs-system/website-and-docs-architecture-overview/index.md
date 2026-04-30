+++
title = "Website And Docs Architecture Overview"
description = "Understand how the Hugo website is structured, how versioned docs are organized, and which build steps turn source content into the public site."
+++

The public website lives in `website/` and is built with Hugo plus repository-specific build and validation scripts.

## What Lives In `website/`

The website contains:

- homepage and other public-site content
- versioned docs content under `content/docs/`
- docs navigation data under `data/`
- the custom Sambee theme under `themes/sambee/`
- build and validation scripts under `scripts/`
- image assets used by the public site

## Versioned Docs Structure

The live docs tree is organized by version, then by book, then by section and page.

```text
website/content/docs/<version>/<book>/<section>/<page>/index.md
```

That structure gives the docs system a stable mapping between filesystem layout, URLs, and navigation metadata.

## Main Build Steps

The website build is more than a plain Hugo render. The standard build runs:

1. theme generation
2. docs-content validation
3. inherited-doc materialization
4. Hugo site build

In `website/package.json`, the normal production-style build is:

```bash
cd website && npm run build
```

For local development, use:

```bash
./scripts/start-website
```

That workflow also keeps search and image-related development tasks in sync.

## Search And Images

The website build has a few project-specific behaviors contributors should remember.

- Pagefind is used for search indexing.
- raster site images are expected to have generated WebP derivatives.
- the website development flow includes helpers for image generation and validation.

## Where Docs Content Comes From

The live docs books are the destination content.

- `documentation/` and `documentation_developers/` are source-material pools
- `documentation_planning/website/` holds planning and rollout guidance
- `website/content/docs/` holds the actual public docs content that ships

That distinction matters. Contributors should reshape source material into website pages rather than linking readers back to legacy markdown folders as if those were the published docs.

## The Three Public Docs Books

The public docs are intentionally split by audience.

- `user-guide`: product usage and troubleshooting
- `admin-guide`: deployment, operations, and escalation
- `developer-guide`: contributor-facing architecture, workflows, and docs-system guidance

Keep those boundaries intact when moving or writing content.

## Go Deeper

- [Docs Versioning And Navigation Model](../docs-versioning-and-navigation-model/): version metadata, sidebar ordering, and slug-sensitive docs changes
- [Docs Authoring Workflow](../docs-authoring-workflow/): where live docs belong and how to add or update pages without drifting back into source-material folders
