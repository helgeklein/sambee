+++
title = "Architecture"
doc_id = "architecture"
product_version = "1.0"
book = "developer"
description = "Overview of the current Sambee website and docs architecture scaffold."
+++

This page is a working scaffold for the documentation design system. It exercises the docs shell, content typography, tables, code blocks, and typed admonitions that the final docs sub-site will rely on.

## Content System

The documentation layout is built around a ledger-style shell with three distinct concerns:

- left navigation for book structure
- central article canvas for long-form content
- right rail for on-page section navigation when headings exist

{{< admonition type="note" title="Design Pilot" >}}
This page is intentionally more detailed than the other placeholder docs pages so the design system can be validated on real documentation patterns before wider rollout.
{{< /admonition >}}

## Layout Principles

The docs pages reuse the shared site frame, but introduce a stronger page-level structure through breadcrumbs, a title band, and technical content styling.

### Why The Shell Is Split

The prototype made it clear that the docs experience needs more local orientation than the homepage. A reader should always know:

1. which documentation version they are reading
2. which book they are in
3. where the current section sits in the article

{{< admonition type="tip" title="Implementation Rule" >}}
Keep docs-specific structure in docs templates and docs content styles. Do not move article-only concepts back into homepage-specific components.
{{< /admonition >}}

## Technical Surfaces

Inline code, dense tables, and framed code blocks are part of the design language rather than afterthoughts. For example, the keyboard shortcut for the search modal remains <kbd>/</kbd>, and code references such as `docs-shell--page` should remain visually distinct from normal prose.

### Example Table

| Surface | Purpose | Notes |
| --- | --- | --- |
| `surface` | Base page stock | Primary background for long-form reading |
| `surface_low` | Nested information blocks | Used for sidebars, blockquotes, and neutral notes |
| `surface_high` | Dense metadata areas | Used for table headers and control surfaces |

{{< admonition type="info" title="Token Source" >}}
The admonition colors are driven by the generated theme tokens so the content system can stay aligned with the shared palette in both light and dark mode.
{{< /admonition >}}

## Code Blocks

The code surface should feel framed and deliberate, not soft or floating.

```js
function createDocsShell(config) {
	return {
		sidebar: config.sidebar,
		header: config.header,
		tableOfContents: config.tableOfContents,
	};
}
```

### Failure Modes

The most common failure mode for this phase is over-generalization. If a docs primitive needs too many homepage exceptions, it is probably not a shared primitive.

> The system should feel printed and anchored. If a content block starts to feel decorative, the implementation has probably drifted away from the ledger design language.

{{< admonition type="warning" title="Rollout Order" >}}
Apply the content system to a representative article before expanding it across all docs books. Otherwise visual regressions will be harder to isolate.
{{< /admonition >}}

## Next Expansion

The next implementation slice should extend this pilot with richer real-world content, including screenshots, multiple heading levels, and additional books.

{{< admonition type="danger" title="Do Not Skip Validation" >}}
Changes to docs content styling should always be followed by a full website build, because Hugo template issues and Tailwind transform issues can surface only during compilation.
{{< /admonition >}}
