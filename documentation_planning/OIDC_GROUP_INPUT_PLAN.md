# OIDC Group Input Plan

## Goal

Allow the OIDC configuration dialog to accept multiple group names in the Admission groups, Administrator groups, Editor groups, and Viewer groups fields. Users enter a comma-delimited list, including group names that contain internal spaces.

The UI must preserve separators while typing, submit structured arrays to the existing API, and retain correct validation and OIDC policy-preview behavior.

## Scope

The fix is frontend-only. The backend already accepts structured `list[str]` values and normalizes group names safely.

No API, schema, migration, or documentation changes are required.

## Implementation

1. Add typed raw display state for the four group fields:

   ```ts
   type OidcGroupDrafts = {
     admission: string;
     admin: string;
     editor: string;
     viewer: string;
   };
   ```

   Drafts retain exactly what the user typed, including commas, spaces, and incomplete entries.

2. Add pure helpers:

   - `groupDraftsFor(candidate)` formats canonical arrays with `listValue()`.
   - `candidateWithGroupDrafts(candidate, drafts)` parses all four drafts into one effective candidate.
   - `sameStringList(left, right)` compares ordered parsed arrays.
   - `sameGroupConfiguration(left, right)` compares admission and all role-mapping lists.

3. Define one effective candidate:

   ```ts
   const effectiveCandidate = candidateWithGroupDrafts(candidate, groupDrafts);
   ```

   Use it for group validation, button state, OIDC test requests, and stored reviewed policies.

4. Extract user-edit side effects from `update()` into:

   ```ts
   applyCandidateUpdate(nextCandidate, changedField)
   ```

   `changedField` is typed as `keyof OidcConfigurationCandidate`. This helper:

   - updates canonical `candidate`;
   - clears relevant test errors;
   - stores `reviewedPolicyFor(nextCandidate)`;
   - re-evaluates a tested identity for reviewable fields;
   - preserves the existing request-sequence protection against stale preview requests.

   Keep `update(key, value)` as a wrapper that builds `nextCandidate` and delegates to this helper.

5. Implement `updateGroupDraft(field, rawValue)`:

   - build `nextDrafts` with the exact raw input;
   - build `nextEffectiveCandidate` from all four drafts;
   - save `nextDrafts`;
   - call `applyCandidateUpdate()` only if the group configuration changed semantically.

   Admission edits pass `"admission_groups"` as `changedField`; Administrator, Editor, and Viewer edits pass `"role_mappings"`.

   This prevents lost cross-field updates and avoids policy-preview requests caused only by a trailing comma or space.

6. Render each group `TextField` from its raw draft and route `onChange` through `updateGroupDraft`. Do not parse and reformat the field on each keystroke. Do not add custom Enter or blur behavior.

7. Use a safe initialization/reset path:

   ```ts
   initializeOidcDraft(nextCandidate)
   ```

   It updates the canonical candidate and regenerates group drafts from canonical lists. Use it for initial loading, restored OIDC flows, dialog reset/cancel, post-activation reloads, and other non-interactive authoritative replacements.

8. Use a side-effect-free live preview-result path:

   ```ts
   applyOidcPreviewResult(identity)
   ```

   It updates canonical candidate, tested identity, mapping state, and pending state after the existing request-sequence guard accepts a `getOidcTestResult()` response. It must not initiate another preview request or rewrite raw group drafts.

9. Derive selected-admission, normalized-duplicate, and cross-role validation from `effectiveCandidate`. Disable `Connect and test` while any derived group validation fails.

10. Call `startTest(effectiveCandidate)`. Inside `startTest`, use that exact snapshot for both `api.startOidcTest()` and `reviewedPolicyFor()`, so the submitted configuration and stored review policy cannot diverge.

## Tests

Add focused coverage in `AuthenticationSettings.test.tsx` for:

- commas and internal spaces in all four group fields;
- parsed, trimmed arrays submitted through `api.startOidcTest`;
- empty selected-group admission, normalized duplicates, and cross-role conflicts;
- separator-only edits causing no policy-preview request;
- two group fields changing before a preview response, with the final preview containing both changes;
- delayed preview responses preserving a focused field's comma or space;
- initial load, reset, restored flow, and activation reload synchronizing drafts;
- preview responses updating canonical review state without causing another request.

## Validation

1. Run the focused `AuthenticationSettings` test file.
2. Run the frontend TypeScript check.
3. Run frontend linting.
