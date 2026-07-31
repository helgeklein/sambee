+++
title = "OpenID Connect Authentication Operations"
+++

Use this guide to manage OIDC sessions, account mappings, and audit records after completing [OpenID Connect Authentication Setup](../openid-connect-authentication-setup/).

## Session Lifecycle

For each OIDC browser session, Sambee stores the provider refresh token encrypted on the server. The browser holds only a short-lived API token in memory and an `HttpOnly` session cookie. Reloading the page can obtain a new API token from that cookie without exposing the provider refresh token to browser storage, URLs, logs, or API responses.

Sambee renews the API token in the background until the configured interactive sign-in interval ends. Refreshing does not extend the original verified sign-in time.

An interactive sign-in is required when the interval ends, the identity provider rejects or revokes the refresh token, a refresh result is uncertain, an access policy changes, or the browser session is revoked. Sambee returns the user to the same safe route after sign-in. See [Recover Unsaved In-Browser Edits](../../../user-guide/viewing-and-editing-files/recover-unsaved-edits/) for the editing behavior during required sign-in.

## Manage Browser Sessions

Users can open **Settings** > **Sessions** to review active OIDC browser sessions. The page identifies the current browser and shows when each session was created and last active without exposing device fingerprints or token details.

- Select **Sign out** to revoke the current browser session and return to the sign-in page.
- Select **Revoke** to end another browser session.
- Select **Revoke all other sessions** to end every other active OIDC browser session.

Revocation immediately invalidates API tokens issued for the affected browser sessions. It does not sign the user out of the identity provider itself.

## Manage Account Mappings

Open **Settings** > **Administration** > **Users** to review how each local account authenticates. An account can show **Local password**, **OIDC linked**, or both. Established mappings show the provider name and most recent OIDC sign-in. A pending mapping shows the provider username that must complete the first admitted OIDC sign-in, who created the mapping, and when.

### Assign Individual Roles

For a linked or pending account, set **OIDC role assignment** to **Administrator**, **Editor**, or **Viewer** to create an individual override. Select **Use configured role assignment** to apply the provider's uniform or group-based policy instead. Individual assignments take precedence over the configured policy and work without a groups claim unless selected-group admission requires one.

### Change Mappings

Administrators can map an unlinked local account to an expected provider username, cancel a pending mapping, or change a linked account to a different provider username. Changing a linked username removes the established identity and creates a pending mapping.

Use **Advanced OIDC actions** to move an established identity to another active, unlinked local account or detach it from a local account. Changing, moving, or detaching an established identity revokes affected Sambee sessions. Detaching does not revoke access at the identity provider; remove provider admission separately when the person must no longer sign in.

Mapping updates are atomic and revision checked. If another administrator changes mappings while the page is open, Sambee rejects the stale update; reload the users page and review the current state. In **OIDC only** mode, Sambee prevents removal of the last active OIDC administrator mapping.

Deleting a local user also removes their established identity, pending mappings targeting that user, and incomplete OIDC flows in the same transaction. Pending mappings that the deleted user created for other accounts remain active and show **Deleted user** as their creator. Deletion remains subject to the last-administrator guard.

## Audit Events

OIDC configuration and identity events are stored in the Sambee database. They do not contain raw subjects, provider tokens, client secrets, authorization codes, nonces, verifiers, or one-time login grants. Events are retained until the database is removed or an external retention process deletes them.

Export the complete audit stream as JSON Lines:

```bash
cd backend
python -m app.oidc_admin export-audit --output sambee-audit.jsonl
```

## Authentication Request Limits

Sambee enforces authentication limits in the application. A reverse proxy can add stricter limits but does not replace these defaults:

| Request | Default limit |
|---|---|
| Start OIDC authorization | 20 requests per source IP per 5 minutes |
| Process OIDC callback | 60 requests per source IP per 5 minutes |
| Exchange OIDC login grant | 30 requests per source IP per 5 minutes |
| Password sign-in | 10 attempts per source IP per 5 minutes and 10 attempts per submitted username per 15 minutes |

Limits refill continuously. A rejected API request returns `Retry-After`; browser-based OIDC requests return to the sign-in page with a generic retry message. Password forms larger than 64 KiB are rejected before parsing. These responses do not expose account existence, the active sign-in mode, provider payloads, or submitted credentials.

