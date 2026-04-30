+++
title = "Logging And Localization"
description = "Understand the shared logging and localization rules that span the browser app, backend, and companion."
+++

Logging and localization are both cross-boundary product systems in Sambee.

- logging affects local debugging, operator visibility, and backend trace collection
- localization affects typed UI copy, locale behavior, browser formatting, and browser-to-companion sync

Treat both as shared contracts rather than optional polish.

## Logging Model

Sambee uses more than one logging surface, but the goal is still one coherent diagnostic story.

### Browser App Logging

The browser app supports both:

- console logging for local development and debugging
- backend tracing for server-side log collection when production or mobile debugging needs it

That means a logging change can affect both developer ergonomics and support visibility.

### Companion And Service-Side Logging

The companion has its own desktop-side logging path, and operational logs are still important on the backend and in local development scripts.

- use the shared logging utilities where the app already has them
- keep log messages specific enough to be actionable
- avoid replacing structured or filtered logging with scattered ad hoc output

For local environment diagnosis, the repo also provides supported log and service-status scripts instead of relying entirely on manual process inspection.

## Localization Model

Localization is a typed system, not just a string file.

### Sources Of Truth

| Area | Source |
|---|---|
| Browser app translations | `frontend/src/i18n/resources.ts` |
| Companion translations | `companion/src/i18n/resources.ts` |
| Typed wrappers | each app's `i18n/index.ts` layer |

English is the source locale, and the pseudo-locale is generated automatically from the English tree.

### Contributor Rules

- add new UI strings through the translation resources instead of hard-coding copy
- keep translation keys type-safe instead of casting around the type system
- preserve the distinction between UI language and regional formatting behavior
- remember that the browser app can push its effective locale into the companion through the paired localhost API

## What Contributors Must Preserve

### Logging

- browser app logging and backend tracing are related but separately configurable
- logging changes should not silently remove trace visibility that support workflows depend on
- diagnostics should stay specific and action-oriented

### Localization

- typed keys should remain enforced
- browser-localization behavior and companion-localization sync should keep using effective locale values rather than raw unresolved preferences
- app-owned UI text should stay translatable

## Common Failure Modes

- adding UI text without a translation key
- bypassing typed translation keys with casts
- changing localization behavior in the browser app without checking companion sync effects
- switching logging behavior in a way that helps local debugging but breaks backend tracing or support visibility
- flooding logs with noisy messages that hide the actionable ones

## Validation Expectations

When this area changes, usually run:

```bash
cd frontend && npx tsc --noEmit
cd frontend && npm run lint
cd companion && npx tsc --noEmit
cd companion && npm run lint
```

For higher-confidence changes, add the relevant frontend or companion tests, especially when localization sync or logging configuration behavior changes.

Use [Test Strategy Overview](../../testing-and-quality-gates/test-strategy-overview/) to decide when those cross-boundary checks need to extend further.

## Related Pages

- [Frontend Logging And Tracing](../frontend-logging-and-tracing/): follow the browser app's dual console-plus-tracing pipeline in more detail
- [How To Plan And Review A Change](../../contribution-workflows/how-to-plan-and-review-a-change/): scope cross-boundary changes before the implementation sprawls
