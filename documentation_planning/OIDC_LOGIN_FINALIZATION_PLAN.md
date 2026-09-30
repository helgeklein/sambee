# OIDC Login Finalization Plan

## Problem and Evidence

After an administrator resets the password of an account that also uses OIDC,
sign-in at the identity provider succeeds but the browser returns to Sambee's
login page. The password reset increments `User.token_version`, intentionally
invalidating existing sessions; a new OIDC login must still succeed.

A production HAR establishes the relevant ordering:

1. The OIDC callback succeeds and sends the browser to the frontend callback route.
2. Bootstrap refresh succeeds using the previous browser session and returns its token.
3. The global theme provider starts `themes` and `me` requests with that token.
4. Grant exchange succeeds, creates a new browser session, and revokes the previous session.
5. The in-flight requests return `oidc_reauthentication_required` for the now-revoked session. The global 401 handler navigates to `/login` despite the successful exchange.
6. The exchange response also contains `return_path: "/login/oidc/callback"`; following that path would revisit the callback without its one-time grant.

The browser-bound flow cookie and grant exchange worked in this trace. Do not
relax OIDC cookie checks, session revocation, or backend authorization. Do not
put HAR cookies, grants, or access tokens in tests or diagnostic output.
Changes to refresh cookies, logout, and session revocation are outside this
fix unless a focused reproduction demonstrates they are needed.

## Required Behavior

- A 401 from a request sent with an obsolete token cannot redirect, refresh, or disturb the newer browser session; its caller still receives the error.
- A 401 for the current token continues to require reauthentication, including after a callback finishes. Writes are never silently retried.
- Early protected requests cannot navigate away while the one-time OIDC grant is being exchanged; an exchange failure still produces the callback's error state.
- Bootstrap completes on successful login, and theme and current-user settings reload even when the new OIDC session belongs to the same user.
- The OIDC callback URL is never used as a post-login return destination. Normal internal return paths, including queries, keep working.

## Implementation

### 1. Discard obsolete authentication failures

In `frontend/src/services/api.ts`, before the existing 401 reauthentication and
retry branches, compare the bearer token actually sent in the failed request
with `authSession.getAccessToken()`. If there is a current token and it differs
from the request token, reject the original error without redirecting or
refreshing. Keep the existing behavior when no newer token exists or the
request used the current token. Apply this to the confirmed OIDC error code as
well as generic 401s. Do not depend on user ID: both sessions in the HAR belong
to the same user. Do not replay a failed mutation.

### 2. Let the callback finish before global reauthentication

While `frontend/src/pages/OidcCallback.tsx` exchanges the one-time grant,
an early protected-request 401 must reject its caller without redirecting or
starting another refresh. Establish this short-lived guard before the global
providers can handle a 401, and clear it on success, failure, or a missing
grant. The exchange determines the callback result; a failed exchange shows
the callback error, even if a request started during exchange returns 401
just after it fails. Do not permanently exempt the callback route: a new
request's 401 for the current session after finalization still follows normal
handling.

Keep `authSession.bootstrap()` and the `authBootstrapComplete` transition in
`frontend/src/App.tsx`. If exchange finishes before bootstrap, successful
login must also complete that transition so client-side navigation to
`/browse` does not remain on a loading fallback.

### 3. Reload data on a new session for the same user

`frontend/src/theme/ThemeContext.tsx` initially loads themes and `me` with
session A, then listens for user identity changes. B has the same user ID,
so those failed requests are not reissued. After installing a *new login*
token, publish one notification that reloads themes and current-user settings
with B, even for the same user. Do not invalidate this data on routine token
refresh. Avoid duplicate notifications: grant exchange and
`completeAuthentication()` both call `setAuthenticated()` today.

### 4. Reject callback return paths at existing boundaries

In `backend/app/services/oidc_flow.py` and
`frontend/src/services/oidcAuth.ts`, reject the callback route as a return
destination, including a query string, and fall back to `/browse`. Use the
frontend sanitizer when `startControlledReauthentication()` constructs its
return path in `frontend/src/services/api.ts`. Preserve valid internal paths
and queries; reject external and protocol-relative paths, including backslash
forms such as `/\outside.example/path` that a browser resolves externally.
Validate against the browser-resolved origin on the frontend and reject
backslashes at both boundaries so the backend parser cannot disagree.

## Regression Coverage

- In the API interceptor tests, send a request with A's token, install B's token, then deliver A's confirmed OIDC 401 and a generic 401. Both callers receive their original errors without refresh, redirect, or draft snapshot. A 401 for B still uses the existing redirect or safe-method retry policy; writes are not replayed.
- In a callback/app test, reproduce the HAR order: bootstrap A, start theme and `me` requests with A, exchange the grant for B, then deliver A's 401s. Verify navigation to `/browse`, no hard `/login` redirect, completed bootstrap, and successful themes and current-user settings requests with B. Also cover a 401 before exchange completes; then fail exchange and deliver a 401 from a request started during exchange. The callback error must remain visible, while a new current-session 401 after finalization still follows normal handling.
- Verify that same-user login reloads dependent data once, while an ordinary token refresh does not invalidate it.
- Test both return-path sanitizers with `/login/oidc/callback` (with and without a query), valid internal paths with queries, and external, protocol-relative, and backslash-form external paths. Verify `/login?return_path=/login/oidc/callback` cannot reproduce the loop.

Run the focused frontend and backend tests, then the frontend type check and
lint. Do not treat a 200 exchange alone as success: verify that a subsequent
protected request works with B and the browser remains off the login page.
