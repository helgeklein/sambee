# Website Typography System

## Purpose

This document defines the target typography architecture for the Hugo website theme under `website/themes/sambee`. The goal is to replace the current mix of semantic classes, partial modifiers, and ad hoc inline utilities with a Tailwind CSS 4-native model that is stable, predictable, and easy to extend.

This is an implementation spec, not a brainstorming note.

## Problems In The Current System

The current type layer in `website/themes/sambee/assets/css/shared.css` has three structural weaknesses:

1. Some type roles are split across multiple classes.
2. Some classes own overlapping properties such as `font-size`, `font-weight`, `letter-spacing`, or `text-transform`.
3. The system mixes semantic recipes with low-level style fragments, which makes source order part of the API.

Concrete examples from the current code:

- `type-label` only provides family, style, and uppercase transformation.
- `type-label-sm` provides size, weight, and spacing.
- `type-label-strong` also provides size, weight, and spacing.
- Templates therefore compose multiple `type-*` classes to produce a single text role.

This is the root cause of the fragility seen during the eyebrow refactors.

## Target Architecture

The website typography system should use two layers only:

1. A token layer in `@theme`
2. A recipe layer in `@utility`

Rules:

- `@theme` owns reusable design decisions: families, sizes, tracking, and leading.
- `@utility` owns repeated semantic text roles used by templates.
- Each semantic recipe must be complete on its own.
- No recipe utility may require another recipe utility as a base.
- No two recipe utilities should be designed to be stacked to produce one role.
- Layout, spacing, and color remain separate concerns.

## Layer Responsibilities

### `@theme`

Use `@theme` for typography values that should be shared across multiple roles and should be available as Tailwind utilities.

This includes:

- font family tokens
- size tokens
- tracking tokens
- line-height tokens
- any custom hero or title sizes not already represented by Tailwind defaults

### `@utility`

Use `@utility` for complete semantic text roles that appear repeatedly in templates.

Examples:

- section titles
- body copy
- eyebrow labels
- list item titles
- list item labels
- list indices
- title headings

### Plain Tailwind Utilities

Keep these concerns outside the semantic typography API:

- color
- hover color
- spacing
- width and layout
- one-off responsive alignment
- rare local overrides where introducing a semantic recipe would be overfitting

## Recommended `@theme` Tokens

The website already has some reusable primitives in `website/themes/sambee/assets/css/base.css`, such as:

- `--font-size-label-xs`
- `--font-size-label-sm`
- `--line-height-heading-tight`
- `--line-height-heading-normal`

The next step is to expose the typography scale needed by shared recipes as Tailwind theme variables.

Recommended additions in the website CSS entry layer:

```css
@theme {
  --text-label-xs: var(--font-size-label-xs);
  --text-label-sm: var(--font-size-label-sm);
  --text-copy: var(--font-size-copy-base);
  --text-list-item-label: var(--font-size-label-sm);
  --text-list-index: var(--font-size-copy-sm);
  --text-list-item-title: var(--font-size-copy-sm);
  --text-title-sm: 1.125rem;
  --text-title-md: 1.5rem;
  --text-title-xl: 2rem;
  --text-hero-subtitle: 1.6rem;
  --text-hero-sm: 2.85rem;
  --text-hero-md: 3.55rem;

  --tracking-label: 0.1em;
  --tracking-label-strong: 0.14em;
  --tracking-eyebrow: 0.22em;
  --tracking-eyebrow-strong: 0.18em;
  --tracking-list-item-label: 0.1em;
  --tracking-hero-subtitle: -0.1rem;

  --leading-copy: 1.625rem;
  --leading-eyebrow: 1;
  --leading-title-md: 1.2;
}
```

Notes:

- Keep existing `--font-primary`, `--font-secondary`, and `--font-tertiary` as the canonical family tokens.
- Keep `--line-height-heading-tight` in place instead of renaming it until more of the theme is migrated.
- Only promote a value into `@theme` if it is reused or is part of the official website type scale.

## Recommended `@utility` Recipes

The following classes should exist as complete standalone recipes.

### Keep As Standalone Semantic Recipes

- `type-section-title`
- `type-copy`
- `type-label-xs`
- `type-label-sm`
- `type-label-strong`
- `type-label-eyebrow`
- `type-label-eyebrow-strong`
- `type-list-item-label`
- `type-list-item-title`
- `type-docs-nav`
- `type-docs-nav-strong`
- `type-hero`
- `type-hero-subtitle`
- `type-title-xl`
- `type-title-md`
- `type-title-md-tight`
- `type-title-sm-tight`
- `type-list-index`

### Remove As Separate Building Blocks

- `type-label`

Reason:

`type-label` is a partial primitive, not a complete text role. It forces templates to compose typography out of multiple recipe classes, which is exactly the failure mode this migration is meant to remove.

## Recipe Definitions

The target shape is standalone recipes implemented with `@utility`, not plain class blocks with implicit composition.

Example definitions:

```css
@utility type-label-sm {
  font-family: var(--font-tertiary);
  font-size: var(--text-label-sm);
  font-weight: 400;
  font-style: normal;
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
}

@utility type-label-strong {
  font-family: var(--font-tertiary);
  font-size: var(--text-label-sm);
  font-weight: 700;
  font-style: normal;
  text-transform: uppercase;
  letter-spacing: var(--tracking-label-strong);
}

@utility type-label-eyebrow {
  font-family: var(--font-tertiary);
  font-size: var(--text-label-sm);
  font-weight: 400;
  font-style: normal;
  text-transform: uppercase;
  letter-spacing: var(--tracking-eyebrow);
  line-height: var(--leading-eyebrow);
}

@utility type-copy {
  font-family: var(--font-primary);
  font-size: var(--text-copy);
  font-weight: 400;
  font-style: normal;
  letter-spacing: normal;
  line-height: var(--leading-copy);
}
```

## Migration Map From Current Classes

This table reflects the current shared typography inventory in `website/themes/sambee/assets/css/shared.css` after the initial implementation pass.

| Current class | Target status | Notes |
| --- | --- | --- |
| `type-section-title` | Keep | Convert to `@utility`; keep semantic name |
| `type-copy` | Keep | Convert to `@utility`; keep semantic name |
| `type-label` | Delete | Replace usages with complete label recipes |
| `type-label-sm` | Keep | Make complete; must include family and uppercase |
| `type-label-strong` | Keep | Make complete; must include family and uppercase |
| `type-label-eyebrow` | Keep | Standalone semantic recipe |
| `type-label-eyebrow-strong` | Keep | Standalone semantic recipe |
| `type-label-xs` | Keep | Make complete; must include family and uppercase |
| `type-list-item-label` | Keep | Complete list-label recipe |
| `type-list-item-title` | Keep | Convert to `@utility` |
| `type-docs-nav` | Keep | Shared docs navigation text role |
| `type-docs-nav-strong` | Keep | Shared docs navigation current-item role |
| `type-hero` | Keep | Convert to `@utility`; preserve breakpoint behavior |
| `type-title-xl` | Keep | Convert to `@utility` |
| `type-hero-subtitle` | Keep | Convert to `@utility` |
| `type-title-md` | Keep | Convert to `@utility` |
| `type-title-md-tight` | Keep | Convert to `@utility` |
| `type-title-sm-tight` | Keep | Convert to `@utility` |
| `type-list-index` | Keep | Complete list-index recipe |

## Template Migration Rules

After the recipe utilities are made complete, templates must stop stacking typography recipe classes.

### Allowed

- one semantic type class plus color classes
- one semantic type class plus layout classes
- one semantic type class plus component-specific structural classes

Examples:

```html
<span class="type-label-eyebrow type-color-accent eyebrow-stack">Documentation</span>
<h2 class="type-section-title type-color-ink">Fast local-first preview</h2>
<p class="type-copy type-color-muted">Body copy</p>
```

### Not Allowed

- `type-label` plus another `type-*` recipe
- `type-label-sm` plus `type-label-strong`
- any combination where two `type-*` classes both own font metrics

Examples to remove:

```html
<span class="type-label type-label-strong">...</span>
<span class="type-label type-label-xs">...</span>
<li class="type-label type-list-item-label">...</li>
```

These patterns have already been removed from the homepage and docs templates.

## Current Hotspots Outside `shared.css`

The shared type system is not the only typography surface in the website theme. These files still contain local typography decisions that should be audited after the core migration lands:

- `website/themes/sambee/assets/css/docs.css`
- `website/themes/sambee/assets/css/navigation.css`
- `website/themes/sambee/assets/css/buttons.css`
- `website/themes/sambee/assets/css/content.css`
- `website/themes/sambee/assets/css/footer.css`

Known examples of local typography that may deserve shared recipes or token alignment:

- docs sidebar links in `docs.css`
- navigation brand and drawer text in `navigation.css`
- button label typography in `buttons.css`
- footer micro-label typography in `footer.css`

These should be migrated only if they represent repeated website-wide roles. Do not centralize one-off typography just for consistency theater.

### Audit Snapshot

Items that should likely migrate to shared recipes:

- `docs-sidebar-link` and `docs-sidebar-link-current` in `docs.css` have been migrated onto the shared `type-docs-nav` and `type-docs-nav-strong` roles.

Items that should likely align to shared tokens but remain local:

- `nav-link` in `navigation.css` belongs to a navigation-specific component, but its size and tracking should align to shared label/list tokens.
- `.btn` and `.btn-sm` in `buttons.css` should probably stay local button primitives, but they should consume shared label tokens rather than owning their own tracking and small-size values.
- `site-footer-copy` and `site-footer-legal` in `footer.css` are footer-specific, but they should consume shared label tokens if the footer microtype remains part of the site language.

Progress made:

- breadcrumb typography now uses the existing `type-label-eyebrow` and `type-label-eyebrow-strong` roles directly.
- `nav-link` now consumes the shared label tracking token.
- `.btn` now consumes the shared label tracking token, and `.btn-sm` uses the shared label size token.
- `site-footer-copy` and `site-footer-legal` now consume the shared eyebrow-strong tracking token.

Items that should remain local for now:

- `nav-brand-title--home` in `navigation.css` is branding-specific, not a reusable site-wide text role.
- table headers, `figcaption`, `dt`, and `.admonition__title` in `content.css` are content-semantic styles and should stay local unless the same role appears outside article content.

## Implementation Order

### Phase 1: Introduce tokens

Add website typography tokens in the CSS entry layer, preferably near the top of `website/themes/sambee/assets/css/main.css` or in a dedicated imported typography token file.

Output of Phase 1:

- custom text-scale tokens exist in `@theme`
- tracking and leading tokens exist in `@theme`
- completed

### Phase 2: Convert shared recipes

Refactor the type rules in `website/themes/sambee/assets/css/shared.css` to use `@utility` and make each label-style recipe complete.

Output of Phase 2:

- `type-label` is no longer needed by templates
- label recipes no longer overlap as base plus modifier
- eyebrow recipes remain standalone
- completed

### Phase 3: Update templates

Replace every stacked label combination in website templates with a single recipe utility.

Known patterns to remove from current templates:

- `type-label type-label-strong`
- `type-label type-label-xs`
- `type-label type-list-item-label`

Output of Phase 3:

- every semantic role uses one typography recipe class
- template typography is easier to scan and harder to break
- completed for current homepage and docs usages

### Phase 4: Audit local typography

Review the remaining typography in local CSS files and decide case by case whether each item should:

- stay local
- become a theme token consumer
- become a shared recipe utility

## Guardrails

Use these rules during future typography work:

1. Do not add a new typography class if plain Tailwind utilities are enough for a one-off case.
2. Do not add a base typography class that must be combined with another recipe class.
3. Do not let two semantic classes compete on `font-size`, `font-weight`, `letter-spacing`, `line-height`, or `text-transform`.
4. Prefer standalone semantic recipes when the same role appears in multiple templates.
5. Promote values into `@theme` only when they are part of the official website scale or reused across roles.

## Expected End State

At the end of this migration:

- website templates use a single semantic type class per text role
- shared recipes are implemented with `@utility`
- reusable values live in `@theme`
- typography no longer depends on CSS source order or class stacking to render correctly
- shared website text roles are obvious from the template markup
