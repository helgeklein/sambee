# Localization Guide

This project now has a typed translation system in both the frontend and the companion app. Use it consistently so new UI copy stays translatable and type-safe.

## Source of Truth

- Frontend translations live in [frontend/src/i18n/resources.ts](../frontend/src/i18n/resources.ts).
- Companion translations live in [companion/src/i18n/resources.ts](../companion/src/i18n/resources.ts).
- English is the source locale.
- The pseudo-locale `en-XA` is generated automatically from the English tree. Do not edit pseudo-locale strings manually.

## Adding New UI Copy

1. Add the new English key to the relevant `EN_TRANSLATIONS` tree.
2. Use that key from UI code instead of hard-coding a string.
3. Prefer the app's existing translation access pattern:
   - Frontend React components: `useTranslation()`
   - Frontend non-component helpers/config: `translate(...)`
   - Companion components: `useI18n()` or `translate(...)`
4. If the copy is in a high-risk or reused surface, add or extend a test that exercises the translated UI.

## Type Safety Rules

- Translation keys are type-checked through `i18next` module augmentation.
- Invalid keys should fail TypeScript compilation.
- Do not bypass this by casting keys to `string` or `any`.
- Keep wrapper signatures typed:
  - Frontend: [frontend/src/i18n/index.ts](../frontend/src/i18n/index.ts)
  - Companion: [companion/src/i18n/index.ts](../companion/src/i18n/index.ts)

## Compile-Time Guard Fixtures

These files exist specifically to catch regressions in the i18n typing setup:

- [frontend/src/i18n/__tests__/typecheck.ts](../frontend/src/i18n/__tests__/typecheck.ts)
- [companion/src/i18n/__tests__/typecheck.ts](../companion/src/i18n/__tests__/typecheck.ts)

They intentionally contain both:

- valid translation calls that must compile
- `@ts-expect-error` invalid keys that must stay invalid

If a future change breaks typed keys, these fixtures should fail typecheck.

## Locale Behavior

- Frontend language preference and regional formatting preference are separate concerns.
- Frontend language preference is stored in `localization.language` in current-user settings and mirrored in local storage under the app locale key.
- Frontend regional formatting preference is stored in `localization.regional_locale` in current-user settings and mirrored in local storage under `sambee.regional-locale`.
- `browser` is the default value for both preferences, meaning:
  - UI language resolves from the browser locale list against the supported translation set.
  - Regional formatting resolves from the browser locale, preserving variants like `en-GB` vs `en-US`.
- Both apps sync `document.documentElement.lang` and `dir` with the active locale.
- Frontend date, number, and sorting helpers should use locale-aware helpers rather than browser-default formatting.
- Frontend React trees that use localization preferences should be wrapped in [frontend/src/i18n/LocalePreferencesProvider.tsx](../frontend/src/i18n/LocalePreferencesProvider.tsx).
- When the browser is paired with Sambee Companion, the frontend also pushes its effective localization to the companion over the authenticated localhost API.
- Companion localization sync uses concrete effective values, not raw `browser` preferences. That means the companion receives resolved values such as `en` and `en-GB`, so it mirrors the browser's current result even when the Sambee preference is `browser`.
- Companion localization is persisted on the Rust side and mirrored into companion local storage for fast startup.
- Companion localization sync is global within the desktop app and uses a last-writer-wins rule based on the browser-provided `updated_at` timestamp. The persisted state also records the source browser origin.
- Open companion windows listen for localization update events and apply the new locale immediately.

Prefer these helpers where applicable:

- [frontend/src/utils/localeFormatting.ts](../frontend/src/utils/localeFormatting.ts)

The Preferences UI for these controls lives in [frontend/src/pages/PreferencesSettings.tsx](../frontend/src/pages/PreferencesSettings.tsx).

## Scope Rules

- Translate app-owned UI strings.
- Do not translate raw backend error payloads or external component/library messages unless the app wraps them in its own copy.
- Decorative glyphs are fine when they are not the only user-facing label.

## Validation

For normal validation after localization changes:

```bash
cd frontend && npx tsc --noEmit && npm run lint
cd companion && npx tsc --noEmit && npm run lint
```

For higher-confidence UI changes, also run the relevant test suites.

For browser-to-companion localization sync changes, also validate:

```bash
cd frontend && npm test -- src/services/__tests__/companionService.test.ts
cd companion && npm test -- src/i18n/__tests__/index.test.ts src/components/__tests__/Preferences.test.tsx
```