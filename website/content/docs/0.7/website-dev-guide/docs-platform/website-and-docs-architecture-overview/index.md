+++
title = "Website and Docs Architecture Overview"
description = "Understand how the public website is organized, how versioned docs fit into it, and which build steps turn repository content into the published site."
+++

This page is the entry point for both website editors and web developers.

- Editors need to know where published content lives, which files control navigation, and which validation steps must pass before a docs change is complete.
- Web developers need the same content model, plus the scripts, templates, and theme files that turn source content into the live site.

## What Lives In `website/`

The public site lives under `website/`. The important areas are:

```text
website/
  content/
    docs/
  data/
    docs-nav/
    docs-versions.toml
  scripts/
  themes/sambee/
  assets/
  static/
```

In practice:

- `content/` holds the authored website pages and docs pages.
- `content/docs/` holds the published versioned docs books.
- `data/docs-versions.toml` declares the canonical docs version order and the current version.
- `data/docs-nav/<version>.toml` declares book, section, and page ordering for one version.
- `scripts/` holds build helpers, docs validation, docs materialization, and docs editor automation.
- `themes/sambee/` holds the Hugo layouts, partials, CSS, and JS for the public site.
- `assets/` and `static/` hold source media, generated media, and static files.

## Published Docs Versus Source Material

Sambee keeps published docs separate from source material.

Use these locations for different jobs:

| Area | Role |
|---|---|
| published docs content | the pages that ship on the site |
| docs navigation data | ordering for the published books, sections, and pages |
| user and admin source notes | working material that may later become public end-user or operations docs |
| developer source notes | working material for implementation-facing topics |
| planning notes | rollout and design material that should not be treated as published docs |

If readers should find the content on the website, the destination is under `website/content/docs/`, not one of the source-material folders.

## The Public Docs Books

The live docs are split by audience and responsibility.

- `user-guide`: day-to-day product usage
- `admin-guide`: deployment, configuration, operations, and escalation
- `developer-guide`: product implementation across backend, frontend, companion, and shared runtime behavior
- `website-dev-guide`: website editing, docs authoring, docs tooling, and website theme systems

That split matters when you move content. A page belongs in the book that matches the next question the reader needs to answer.

## How Docs Routing Works

Docs content is versioned in the content tree:

```text
website/content/docs/<version>/<book>/<section>/<page>/index.md
```

The current docs version also publishes stable unversioned routes:

- `/docs/<book>/`
- `/docs/<book>/<section>/`
- `/docs/<book>/<section>/<page>/`

Archived or explicit versioned routes remain available at:

- `/docs/<version>/`
- `/docs/<version>/<book>/...`

The routing rules, inheritance markers, and stable-current behavior are covered in more detail in [Docs Content Model, Navigation, and Inheritance](../docs-content-model-navigation-and-inheritance/).

## Build and Preview Pipeline

The website build is more than a plain Hugo render.

The normal production-style build is:

```bash
cd website
npm run build
```

That command runs:

1. theme generation
2. docs validation
3. inherited-doc materialization
4. Hugo site build
5. homepage CTA validation

For local development, use:

```bash
./scripts/start-website
```

Or run the website dev workflow directly:

```bash
cd website
npm run dev
```

That dev workflow also keeps search indexing and WebP generation in sync while you iterate.

## Where Runtime Behavior Lives

This page stays focused on the site layout and the overall website/docs architecture. For the deeper implementation map behind docs routing, stable current routes, template resolution, and version-switch behavior, continue to [Docs Runtime and Route Resolution](../docs-runtime-and-route-resolution/).

## Editor Workflow Versus Developer Workflow

The same system supports two different styles of work.

Editors usually:

- add or revise copy under `website/content/docs/`
- update ordering in `website/data/docs-nav/`
- run the website build before finishing

Web developers additionally:

- change Hugo partials, layouts, or theme CSS
- change docs validation, materialization, or editor scripts
- preserve the path-based docs contract when changing internals

## Continue with the Right Page

- Use [Docs Runtime and Route Resolution](../docs-runtime-and-route-resolution/) when you need the runtime file map, route-resolution model, version-switch behavior, or docs search behavior.
- Use [Docs Content Model, Navigation, and Inheritance](../docs-content-model-navigation-and-inheritance/) when the change touches docs paths, nav order, inheritance markers, or route behavior.
- Use [Docs Authoring Workflow](../../authoring-and-tooling/docs-authoring-workflow/) when you are adding or revising published content.
- Use [Docs Editor Tool](../../authoring-and-tooling/docs-editor-tool/) when the change is structural and should be done through the CLI.
- Use [Media Publishing Workflow](../../site-systems/media-publishing-workflow/) or [Typography System](../../site-systems/typography-system/) when the change touches those shared website systems.
