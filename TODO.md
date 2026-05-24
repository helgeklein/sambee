# TODO

## Markdown editor

- Table editing: UI is gross and ugly
- Inline code styling

## Quick Bar

- General:
   - There's no way to switch the quickbar between modes with the mouse, e.g. from command mode to smart navigation.
      - Solution:
         - Always show the chip indicating the mode, even in smart navigation mode.
         - When the chip is click, display a list with all modes for the user to select from.
- Command mode:
   - Doesn't filter out unhandled keystrokes so backspace bubbles up to the file list and causes directory navigation
   - `Rename focused item` doesn't work. Focus issue?
   - `Show keyboard shortcuts` opens the shortcut modal beneath (z-index) the still-open quick bar dropdown

## File list

- Make file operations discoverable by adding a toolbar with icons below the bar that contains the connection list
- When I select multiple files and then press DEL, only one is deleted instead of all of them.

## Authentication system

- OAuth/OIDC

## Theme

- import/export, e.g., as JSON

## Image viewer

- Support multi-page image files:
  - TIFF
  - ICO (test with uberAgent icon)

- Additional formats
   - DCM (medical image format)

## Text viewer and editor

- Support various text-based files

## PDF viewer

- Follow intra-doc links when clicked (e.g., from a ToC to a given page)

## Companion token security tightening

- Reduce local persistence of the longer-lived session token. The Companion currently stores the exchanged session JWT inside FileOperation in operations.rs:93, and that struct is persisted to disk as JSON sidecars. That is a bigger hygiene issue than the URI token TTL, because this token lives for an hour and survives crashes. Better options:

   - store only an operation ID in the sidecar and keep the session token in OS-protected storage
   - or encrypt the sidecar token at rest using a machine/user-bound secret
   - or, simplest, persist no session token at all and force a refresh/re-auth path on recovery flows

- Minimize token contents. The URI token currently embeds sub, jti, conn_id, and full file path in companion.py:220. That means anyone who sees the token learns both who opened it and exactly which file it targets. A cleaner model is to make the URI token an opaque nonce or reference ID, store the associated metadata server-side, and exchange that nonce once. That gives you:

   - less sensitive data in the token itself
   - easier revocation
   - smaller logs if anything slips through
   - freedom to change claims without changing clients

- Bind tokens more tightly to the intended flow. Since these are single-use already, the next step is contextual binding:

   - bind the URI token to one server origin only
   - optionally bind it to a generated client nonce carried through the flow
   - reject replay from a different origin or after first successful exchange
   - consider shortening the companion session token lifetime too, especially if it remains persisted locally

- Scrub operational logging around token handling. Backend logging is already much better than Companion here, but I’d still be careful not to log raw request URLs for /api/companion/token at the ingress or proxy layer. In practice that means:

   - proxy access-log redaction for token query params
   - app-side structured logs that include jti or a hash prefix instead of the token
   - use request IDs for correlation rather than token values
