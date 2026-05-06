+++
title = "Localization and Locale Behavior"
+++

Localization in Sambee is a typed cross-app system. It affects UI copy, browser formatting, and browser-to-companion behavior.

Use this page when you are adding copy, changing locale behavior, or touching browser-to-companion localization sync.

## Sources of Truth

These files own the localization model:

| Area | Source |
|---|---|
| Browser app translations | `frontend/src/i18n/resources.ts` |
| Companion translations | `companion/src/i18n/resources.ts` |
| Browser app typed wrapper | `frontend/src/i18n/index.ts` |
| Companion typed wrapper | `companion/src/i18n/index.ts` |

English is the source locale.

The pseudo-locale `en-XA` is generated from the English translation tree. Do not edit pseudo-locale strings manually.

## Adding New UI Copy

When you add new copy:

1. add the English key to the relevant `EN_TRANSLATIONS` tree
2. use that key from UI code instead of hard-coding a string
3. use the existing translation access pattern for the surface you are editing
4. add or extend tests when the copy sits in a reused or high-risk surface

Typical access patterns are:

- browser app React components: `useTranslation()`
- browser app non-component helpers or config: `translate(...)`
- companion components: `useI18n()` or `translate(...)`

## Type-Safety Rules

Typed translation keys are part of the contract.

- translation keys are type-checked through the i18n type layer
- invalid keys should fail TypeScript compilation
- do not bypass that with casts to `string` or `any`
- keep wrapper signatures typed instead of weakening them for convenience

If localization typing becomes optional, contributors lose one of the main protections against copy drift and key mismatches.

## Compile-Time Guard Fixtures

These files exist specifically to catch regressions in localization typing:

- `frontend/src/i18n/__tests__/typecheck.ts`
- `companion/src/i18n/__tests__/typecheck.ts`

They intentionally include both:

- valid translation calls that must compile
- invalid keys marked with `@ts-expect-error` that must stay invalid

If a change weakens typed keys, these fixtures should fail type checking.

## Language Versus Regional Formatting

Sambee separates UI language from regional formatting.

- language decides which translated copy the UI shows
- regional formatting decides how dates, numbers, and sorting behave

That split matters because users may want English UI with non-US formatting, or any other mixed combination the product supports.

## Preference Storage Rules

Frontend language and regional formatting preferences are stored separately.

- language preference lives in `localization.language` in current-user settings and is mirrored in local storage under the app locale key
- regional formatting preference lives in `localization.regional_locale` in current-user settings and is mirrored in local storage under `sambee.regional-locale`
- `browser` is the default for both preferences

`browser` means:

- UI language resolves from the browser locale list against the supported translation set
- regional formatting resolves from the browser locale while preserving variants such as `en-GB` versus `en-US`

## Runtime Locale Behavior

Both apps keep document locale metadata aligned with the active locale.

- `document.documentElement.lang` stays synchronized
- text direction stays synchronized through `dir`

Frontend date, number, and sorting behavior should use the locale-aware helpers instead of raw browser-default formatting.

Prefer:

- `frontend/src/utils/localeFormatting.ts`

Frontend React trees that depend on localization preferences should be wrapped in:

- `frontend/src/i18n/LocalePreferencesProvider.tsx`

The user-facing preferences UI lives in:

- `frontend/src/pages/PreferencesSettings.tsx`

## Browser-to-Companion Localization Sync

When the browser is paired with Sambee Companion, the browser pushes its effective localization state to the companion over the authenticated localhost API.

Important rules:

- sync uses concrete effective locale values, not unresolved `browser` preferences
- the companion therefore receives resolved values such as `en` or `en-GB`
- companion localization is persisted on the Rust side and mirrored into companion local storage for fast startup
- synchronization is global within the desktop app
- last-writer-wins behavior is based on the browser-provided `updated_at` timestamp
- persisted companion state also records the source browser origin
- open companion windows listen for localization update events and apply the new locale immediately

If you change the browser-side locale model, you must check the companion sync path too.

## Scope Rules

- translate app-owned UI strings
- do not translate raw backend error payloads or third-party library messages unless Sambee wraps them in its own copy
- decorative glyphs are fine when they are not the only user-facing label

## Common Failure Modes

- adding UI text without a translation key
- weakening typed-key enforcement with casts
- changing browser locale behavior without checking companion sync
- treating language preference and formatting preference as the same value
- using browser-default formatting instead of the shared locale-aware helpers

## Validation Expectations

For routine localization changes, usually run:

```bash
cd frontend && npx tsc --noEmit && npm run lint
cd companion && npx tsc --noEmit && npm run lint
```

For higher-confidence UI changes, also run the relevant frontend or companion tests.

For browser-to-companion localization sync changes, also validate:

```bash
cd frontend && npm test -- src/services/__tests__/companionService.test.ts
cd companion && npm test -- src/i18n/__tests__/index.test.ts src/components/__tests__/Preferences.test.tsx
```

## Related Pages

- [Logging and Localization](../logging-and-localization/): cross-cutting overview for both systems
- [Frontend Logging and Tracing](../frontend-logging-and-tracing/): the browser-side logging system that often changes alongside other shared UI infrastructure
- [How to Plan and Review a Change](../../contribution-workflows/how-to-plan-and-review-a-change/): scope cross-boundary behavior before implementation spreads across browser and companion
