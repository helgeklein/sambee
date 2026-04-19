# Homepage Data Schema

This document defines the recommended content structure for the homepage before Phase 4 implementation begins.

## Recommendation

Use a dedicated Hugo data file for homepage section content.

Recommended split:

- `website/content/_index.md`
  - page title
  - short summary or description if needed for page metadata
  - little or no homepage section content
- `website/data/homepage.yaml`
  - all structured homepage section data
- `website/themes/sambee/layouts/home.html`
  - section composition only
- homepage partials under `website/themes/sambee/layouts/partials/home/`
  - rendering of each section from the shared data structure

## Why This Shape

This homepage is not a simple text page. It contains multiple repeated and semi-structured section types:

- hero
- supporting points
- multi-column problem/value framing
- benefits cards
- feature groups
- supported format list
- companion section
- deployment section
- trust or proof list
- final CTA group

That is a better fit for a structured data document than large front matter.

## File Choice

Recommended file:

- `website/data/homepage.yaml`

YAML is recommended here because:

- the homepage contains many nested arrays and objects
- several sections contain longer copy blocks
- YAML is easier to scan and edit than TOML for repeated cards and multiline text

If you prefer strict consistency with the existing docs nav files, TOML is still possible, but YAML is the better editorial format for this particular page.

## Content Ownership Rules

Use these rules to keep the homepage maintainable:

- Keep section ordering explicit in the data file.
- Keep copy in data, not in templates.
- Keep presentational classes out of the data file.
- Use stable field names based on content meaning, not visual layout.
- Keep links as explicit `href` values.
- Use asset references only for real local assets that exist or are planned.
- Keep optional sections representable with `enabled: true|false`.

## Recommended Top-Level Schema

```yaml
meta:
  slug: home
  title: Sambee
  description: Browser-based SMB and local-drive access without forcing a cloud-first storage model.

hero:
  enabled: true
  kicker: Free and Open Source Software Designed for Self-Hosting
  title: Browser-based file access for SMB shares and local drives
  subtitle: Explore, preview, and manage files directly in the browser.
  supporting_points:
    - Self-hosted
    - Desktop and mobile
    - Companion optional
  ctas:
    - label: See Features
      href: "#features"
      kind: primary
    - label: Admin Docs
      href: /docs/1.0/admin/
      kind: secondary
    - label: Read Docs
      href: /docs/
      kind: tertiary
  side_panel:
    enabled: true
    eyebrow: Current Release
    title: Documentation 1.0
    body: Versioned product documentation with shared layout and search.
    stats:
      - value: 3
        label: books
      - value: Pagefind
        label: search
      - value: Hugo
        label: theme

problem_value:
  enabled: true
  items:
    - eyebrow: The Problem
      title: Cloud-first tools are not the right fit everywhere
      body: >-
        Cloud-first file access tools are not the right fit for every
        environment. Many teams want browser access to internal files without
        giving up infrastructure control or pushing storage into the cloud.
    - eyebrow: The Gap
      title: Traditional file managers are desktop-first
      body: >-
        Traditional file managers still work well on local desktops, but they
        are less suited to browser-based work styles and mobile access. Sambee
        closes that gap by bringing SMB shares and local drives into the
        browser.
    - eyebrow: The Value
      title: Convenience without giving up control
      body: >-
        Use Sambee when you want cloud-like convenience for browsing and
        previewing files, but need deployment, access, and storage to stay
        under your control.

benefits:
  enabled: true
  eyebrow: Technical Overview
  title: Core Benefits
  items:
    - id: self_hosted_control
      title: Self-hosted control
      body: Keep file access in your own environment instead of routing everyday file handling through cloud storage.
    - id: better_everyday_handling
      title: Better everyday file handling
      body: Browse large SMB directories with search, keyboard shortcuts, dual-pane navigation, and instant navigation to any directory.
    - id: rich_previews
      title: Rich previews before download
      body: View images, PDFs, and Markdown directly in the browser, including formats browsers do not handle well on their own.
    - id: native_editing
      title: Native editing when needed
      body: Open files in Word, Photoshop, LibreOffice, and other installed desktop apps through Sambee Companion.
    - id: desktop_mobile
      title: Built for desktop and mobile
      body: Use the same system from a workstation, tablet, or phone without giving up core functionality.
    - id: infrastructure_fit
      title: Fits existing infrastructure
      body: Deploy with Docker, place it behind your reverse proxy, and connect it to the SMB storage you already use.

features:
  enabled: true
  id: features
  eyebrow: Functionality Overview
  title: Features
  groups:
    - title: Access and navigate
      body: Connect to SMB shares and, with Sambee Companion, local drives. Move quickly through directories with fast search, keyboard navigation, optional dual-pane layouts, and instant navigation to any directory.
    - title: Preview and review
      body: Open files in the browser before downloading them. Review images, search PDFs, and read or edit Markdown without switching tools.
    - title: Manage files
      body: Copy, move, rename, delete, create folders, upload files, and download what you need from one UI.
    - title: Continue work in desktop apps
      body: Sambee Companion lets you open files in native desktop apps and bring changes back into Sambee.

supported_formats:
  enabled: true
  eyebrow: Preview Support
  title: Supported formats
  body: >-
    Sambee supports in-browser previewing for a broad range of file types,
    including images, PDFs, and Markdown.
  supporting_link:
    label: See full viewer support
    href: /documentation/VIEWER_SUPPORT/
  formats:
    - label: PSD
    - label: TIFF
    - label: HEIC
    - label: EPS
    - label: AI
    - label: PDF
    - label: MD
    - label: JPG
    - label: XLS

companion:
  enabled: true
  eyebrow: Module
  title: Extend Sambee to the local desktop
  body: >-
    With Sambee, you explore, preview, and manage files directly in the
    browser. The companion app extends Sambee to the local desktop,
    connecting Sambee to local drives and enabling native desktop editing.
  bullets:
    - access local drives
    - open files in installed desktop applications
    - return edited files to the source location
  note_title: Supporting note
  note_body: Companion is optional for browser-based use, but required for local-drive access and native desktop-app editing.
  cta:
    label: Install Companion
    href: /companion/
  media:
    type: image
    src: images/home/companion-panel.png
    alt: Sambee Companion desktop panel

deployment:
  enabled: true
  title: Self-hosted and easy to fit into existing infrastructure
  body: >-
    Sambee is designed for environments that care about control. Deploy it
    with Docker, run it behind your reverse proxy, and connect it to the SMB
    storage you already use.
  secondary_body: >-
    The goal is to make the storage you already trust easier to access from
    the browser.
  cta:
    label: Admin Docs
    href: /docs/1.0/admin/

proof:
  enabled: true
  eyebrow: Built for your environment
  title: Built for real file environments
  body: It is designed for environments that value control, inspectability, and infrastructure fit.
  items:
    - label: NAS devices
    - label: Samba servers
    - label: Windows file servers
    - label: Desktop and mobile browsers
    - label: Self-hosted deployments
    - label: Open-source codebase

final_cta:
  enabled: true
  title: Choose the best way to explore Sambee
  ctas:
    - label: See Features
      href: "#features"
      kind: primary
    - label: Admin Docs
      href: /docs/1.0/admin/
      kind: secondary
    - label: Read Docs
      href: /docs/
      kind:secondary
```

## Recommended Section Model

The homepage template should expect these top-level sections:

- `meta`
- `hero`
- `problem_value`
- `benefits`
- `features`
- `supported_formats`
- `companion`
- `deployment`
- `proof`
- `final_cta`

Each section should support:

- `enabled`
- optional `eyebrow`
- required `title` where relevant
- one or more body fields
- a repeatable `items`, `groups`, `formats`, or `ctas` collection where appropriate

## CTA Schema

Use one CTA object shape everywhere:

```yaml
label: Admin Docs
href: /docs/1.0/admin/
kind: secondary
```

Recommended `kind` values:

- `primary`
- `secondary`
- `tertiary`

This keeps template logic simple and avoids section-specific button field names.

## Media Schema

Use a small media object when a section has visual content:

```yaml
media:
  type: image
  src: images/home/companion-panel.png
  alt: Sambee Companion desktop panel
```

If a section has no asset yet, omit `media` rather than using a fake placeholder path.

## Field Naming Rules

Prefer these conventions:

- `body` for the primary paragraph block
- `secondary_body` for supporting copy
- `items` for generic repeated content blocks
- `groups` for feature clusters
- `formats` for preview-format labels
- `bullets` for short unordered lists
- `ctas` for repeated calls to action
- `cta` for a single primary action

Avoid these:

- visual names like `left_column`, `card_row_2`, `yellow_box`
- component names like `heroCardData`
- content-free names like `section1`, `blockA`

## Homepage Template Expectations

The homepage implementation should assume:

- section order comes from the template, not from the data file
- section visibility comes from `enabled`
- card counts can vary without changing template logic
- CTA styling comes from `kind`
- local assets are referenced by relative site paths

## What Should Stay Out Of This Schema

Do not put these in the homepage data file:

- CSS class names
- Tailwind utility names
- HTML fragments unless there is a strong reason
- docs-version-derived stats that should be computed from Hugo data
- duplicate SEO metadata already owned by page front matter unless there is a clear need

## Minimal Front Matter Recommendation

Recommended `website/content/_index.md` shape:

```toml
+++
title = "Sambee"
description = "Browser-based SMB and local-drive access without forcing a cloud-first storage model."
+++
```

## Implementation Note

The `supporting_link.href` and some CTA targets in the example above are placeholders for structure discussion and should be aligned with real site routes during Phase 4 implementation.
