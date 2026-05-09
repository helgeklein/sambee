+++
title = "Typography System"
+++

This page documents the current typography architecture for the Hugo website theme under `website/themes/sambee`.

It is a reference for the live system, not a planning note.

## Current Architecture

The shared typography system has two layers:

1. a token layer in `@theme` in `website/themes/sambee/assets/css/main.css`
2. a recipe layer in `@utility` in `website/themes/sambee/assets/css/shared.css`

Rules of the current implementation:

- `@theme` owns reusable type scale, tracking, and leading values that should be available as Tailwind-native tokens
- `@utility` owns repeated semantic text roles used across templates
- each semantic recipe is complete on its own
- templates apply one semantic `type-*` utility per text role
- color, spacing, layout, and interaction state remain separate concerns
- component-local CSS may keep typography local when the role is specific to one component, but it should consume shared tokens where that keeps the site scale aligned

## Shared Token Layer

The current shared typography token block in `website/themes/sambee/assets/css/main.css` is:

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

- `--text-docs-nav` and `--leading-docs-nav` are part of the shared scale because the docs interface reuses the same text role in multiple places
- hero sizing still combines local tokens with the larger text tokens already exposed by the theme
- values belong in `@theme` only when they are part of the shared site scale or reused across roles

## Shared Recipe Layer

The current shared semantic typography utilities are:

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

These utilities are intended to be complete on their own. Do not stack two semantic typography utilities that both set font metrics.

The current system intentionally does not include:

- `type-label` as a partial base class
- `type-docs-nav-strong` as a separate semantic utility

Docs current-item emphasis is handled by `type-docs-nav` plus local state styling such as color, weight, and surface treatment.

## Usage and Boundaries

The detailed usage examples, intentionally absent patterns, and component-boundary rules now live on a separate page so this overview can stay focused on the shared system itself.

Continue to [Typography Usage and Boundaries](../typography-usage-and-boundaries/) for:

- representative `@utility` definitions
- template usage examples
- current-item emphasis rules for docs navigation
- component-local versus shared typography boundaries
- intentionally absent patterns that should not be reintroduced

## Guardrails

Use these rules for future typography work:

1. use plain Tailwind utilities for one-off cases
2. add a shared `type-*` utility only when the same semantic role appears in multiple templates
3. keep each shared utility complete on its own
4. keep layout, spacing, color, and interaction state outside the semantic typography utility unless the role truly requires them
5. when a component-local class needs a shared scale value, consume the shared tokens instead of copying magic numbers
