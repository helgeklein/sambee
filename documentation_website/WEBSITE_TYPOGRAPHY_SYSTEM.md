# Website Typography System

## Purpose

This document defines the current typography architecture for the Hugo website theme under `website/themes/sambee`. It documents the shared typography tokens, semantic text utilities, and the boundary between shared typography and component-local styles as they exist today.

This is a reference spec for the live system.

## Current Architecture

The website typography system has two shared layers:

1. A token layer in `@theme` in `website/themes/sambee/assets/css/main.css`
2. A recipe layer in `@utility` in `website/themes/sambee/assets/css/shared.css`

Rules in the current implementation:

- `@theme` owns reusable type scale, tracking, and leading values that should be available as Tailwind-native tokens.
- `@utility` owns repeated semantic text roles used across templates.
- Each semantic recipe is complete on its own.
- Templates apply one semantic `type-*` utility per text role.
- Color, spacing, layout, and interaction state remain separate concerns.
- Component-local CSS may keep typography local when the role is specific to one component, but it should consume shared tokens where that keeps the site scale aligned.

## Shared Token Layer

The current typography token block in `website/themes/sambee/assets/css/main.css` is:

```css
@theme {
  --text-copy: var(--font-size-copy-base);
  --text-label-xs: var(--font-size-label-xs);
  --text-label-sm: var(--font-size-label-sm);
  --text-list-item-label: var(--font-size-label-sm);
  --text-list-index: var(--font-size-copy-sm);
  --text-list-item-title: var(--font-size-copy-sm);
  --text-docs-nav: var(--font-size-copy-sm);
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
  --leading-docs-nav: 1.375;
  --leading-eyebrow: 1;
  --leading-title-md: 1.2;
}
```

Supporting primitives still come from the shared base and generated theme layers, including:

- `--font-primary`, `--font-secondary`, and `--font-tertiary`
- `--line-height-heading-tight`
- `--line-height-copy-base`
- `--tracking-tight`
- `--text-4xl`, `--text-5xl`, and `--text-7xl`

Notes:

- `--text-docs-nav` and `--leading-docs-nav` are part of the current shared scale because the docs interface reuses the same text role in multiple places.
- Hero sizing still combines local tokens with the larger Tailwind text tokens already exposed by the theme.
- Values belong in `@theme` only when they are part of the shared website scale or reused across roles.

## Shared Recipe Layer

The current shared semantic utilities in `website/themes/sambee/assets/css/shared.css` are:

- `type-section-title`
- `type-copy`
- `type-label-sm`
- `type-label-strong`
- `type-label-eyebrow`
- `type-label-eyebrow-strong`
- `type-label-xs`
- `type-list-item-label`
- `type-list-item-title`
- `type-docs-nav`
- `type-hero`
- `type-title-xl`
- `type-hero-subtitle`
- `type-title-md`
- `type-title-md-tight`
- `type-title-sm-tight`
- `type-list-index`

These utilities are standalone recipes. Each one owns the font family, size, weight, spacing, and line-height decisions needed for that role.

The current system intentionally does not include:

- `type-label` as a partial base class
- `type-docs-nav-strong` as a separate semantic utility

Docs current-item emphasis is handled by `type-docs-nav` plus local state styling such as color, weight, and surface treatment.

## Representative Definitions

The shared recipes are implemented with `@utility` and are complete on their own.

```css
@utility type-copy {
  font-family: var(--font-primary);
  font-size: var(--text-copy);
  font-weight: 400;
  font-style: normal;
  letter-spacing: normal;
  line-height: var(--leading-copy);
}

@utility type-label-sm {
  font-family: var(--font-tertiary);
  font-size: var(--text-label-sm);
  font-weight: 400;
  font-style: normal;
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
}

@utility type-docs-nav {
  font-family: var(--font-primary);
  font-size: var(--text-docs-nav);
  font-weight: 400;
  font-style: normal;
  letter-spacing: normal;
  line-height: var(--leading-docs-nav);
}

@utility type-title-md {
  font-family: var(--font-secondary);
  font-size: var(--text-title-md);
  font-weight: 700;
  font-style: normal;
  letter-spacing: normal;
  line-height: var(--leading-title-md);
}
```

## Template Usage

Current templates use one semantic typography utility per text role and then combine it with separate classes for color, layout, and interaction.

Examples from the live theme:

```html
<span class="type-label-eyebrow type-color-accent eyebrow-stack">Documentation</span>
<h2 class="type-section-title type-color-ink">Fast local-first preview</h2>
<span class="docs-sidebar-link docs-sidebar-link-current type-docs-nav type-color-ink ui-current-primary-inset">Current page</span>
<a class="docs-sidebar-link type-docs-nav type-color-muted ui-transition-color type-hover-ink ui-hover-surface-mid" href="/docs/">Documentation</a>
```

Current usage rules:

- Apply exactly one semantic `type-*` utility to a given text element.
- Combine that utility with color helpers, layout helpers, and component-specific state classes as needed.
- Do not stack two `type-*` utilities that both set font metrics.
- Do not reintroduce a partial base class such as `type-label`.

Patterns intentionally absent from the current theme include:

```html
<span class="type-label type-label-strong">...</span>
<span class="type-label type-label-xs">...</span>
<li class="type-label type-list-item-label">...</li>
```

## Local Typography Boundaries

Not every text treatment is shared. The current split between shared typography and component-local CSS is:

### Docs UI

`website/themes/sambee/assets/css/docs.css` uses the shared `type-docs-nav` role for repeated documentation navigation text, including:

- table of contents links
- version switcher labels and options
- nav tree links and current items
- sequential navigation mobile labels and titles

Local docs classes still own padding, indentation, and current-item state. For example, `.docs-sidebar-link-current` adds the stronger weight for the active item instead of relying on a separate semantic recipe.

### Navigation

`website/themes/sambee/assets/css/navigation.css` keeps `.nav-link` as a component-local role. It uses `var(--tracking-label)` so navigation aligns with the shared label tracking scale, but the navigation pattern remains local because it is specific to the site header and drawer.

### Buttons

`website/themes/sambee/assets/css/buttons.css` keeps `.btn` and `.btn-sm` as local button primitives. They consume shared typography tokens where appropriate:

- `.btn` uses `var(--tracking-label)`
- `.btn-sm` uses `var(--text-label-sm)`

This keeps button typography aligned with the shared scale without turning buttons into shared text-role utilities.

### Footer

Footer layout classes remain local in `website/themes/sambee/assets/css/footer.css`. The textual role itself comes from shared utilities in the templates, such as `type-label-eyebrow` on footer copy and legal links. Local footer classes therefore own layout and alignment, not reusable font metrics.

### Content-Specific Typography

Article-content semantics such as table headers, `figcaption`, `dt`, and admonition titles remain local to `content.css`. They are content-domain styles, not shared site-wide text roles.

## Guardrails

Use these rules for future typography work in the website theme:

1. Use plain Tailwind utilities for one-off cases.
2. Add a shared `type-*` utility only when the same semantic role appears in multiple templates.
3. Keep each shared utility complete on its own.
4. Do not let two semantic typography utilities compete on `font-size`, `font-weight`, `letter-spacing`, `line-height`, or `text-transform`.
5. Keep layout, spacing, color, and interaction state outside the semantic typography utility unless the role truly requires them.
6. When a component-specific class needs typography values from the shared site scale, consume the shared tokens instead of duplicating magic numbers.
