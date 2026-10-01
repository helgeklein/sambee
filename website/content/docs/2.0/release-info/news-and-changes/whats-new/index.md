+++
title = "What's New"
+++

## Theme Editor

UI themes are an integral part of an app's visual presentation. As so often, flexibility is key. Some like it dark, others colorful, some require high-contrast, others prefer muted colors.

Sambee now has a multi-layer theme system. It differentiates between built-in themes, site-wide themes which only admins can manage, and users' personal themes. Any user can modify existing themes for their own use; admins can also provide themes for other users on the same Sambee server and designate a default theme for new users.

With Sambee's new theme editor, users can change all theme colors via hex values or the integrated RGBA color picker (which covers transparency in addition to color). Themes can be imported and exported, too.

## File List

### Other Changes

- Native mobile sharing is now available for single or multiple files from the file list.
- Single-file downloads are now streamed directly without buffering in memory. This speeds up downloads and effectively removes limits imposed by file size.

### Bugfixes

- Invalid file browser URLs no longer break the page or prevent the other pane from loading.
- Overlapping download requests were allowed.
- A failed background connection refresh no longer hides a recovered file listing.
- Uploads and copy or move operations no longer interfere with each other's conflict decisions.
- Renaming a file to a name that differed by case only failed on local drive connections.

## OpenID Connect (OIDC)

### Refresh Token & Offline_Access Are Now Optional

Many identity providers require the `offline_access` scope to issue refresh tokens, but some (like OneLogin) rejects that scope in the authorization code flow and can issue a refresh token without it when refresh tokens are enabled for the app.

Sambee uses a provider refresh token when one is returned, whether or not `offline_access` was requested. If no refresh token is returned, Sambee can continue issuing short-lived API tokens from the browser session for up to 8 hours by default (configurable from 1 to 24 hours). After Sambee's user session expires, the user must sign in through the identity provider again.

### Bugfixes

- OIDC login failures after password reset: OIDC login now completes reliably after an administrator resets the account’s password. Sambee ignores responses from the previous browser session while the new login finishes, reloads the user’s themes and settings, and returns to the file browser instead of the login page.

## Miscellaneous

### Local Drive Acess

Sambee now checks local-drive access before saying the browser is ready to use Companion. If the check fails, Local Drives settings distinguish between an outdated Companion, an outdated Sambee page, and a pairing that needs to be restored.

When Companion rejects a request while browsing a local drive, the file list points to the affected pane and offers a way to reload Sambee or open Local Drives, depending on what went wrong.

### Unencrypted HTTP Support

Sambee now deals with unencrypted HTTP explicitly:

- Companion pairing and operations are unavailable.
- File copying caused a `crypto.randomUUID` error. This has been fixed by implementing a fallback.
- File uploading would show `outcome uncertain` and not upload files on HTTP/1.1 connections (even over HTTPS). This has been fixed by sending files directly instead of using a streamed request body, so uploads work on HTTP/1.1 while still showing progress.
- Copying to the clipboard (used in Settings) is now disabled.

HTTP for development on `localhost` is treated as secure by browsers and continues to be supported by Sambee.

### Supported Browser Detection

If your browser is too old or lacks features Sambee needs, you'll now see a clear message instead of a blank page. The message identifies missing capabilities and links to the browser requirements so you can choose a supported browser.

## Under the Hood

### Security Review

- OIDC login now binds the callback and login grant to the browser that started the login flow, preventing a grant from being redeemed in another browser.
- Only admins can list and download uploaded mobile logs; signed-in users can still upload logs for troubleshooting.
- Companion requests now use signatures tied to the HTTP method and requested URL, so a signature can't be reused for another request.
- Mobile log uploads have a size limit, and stored logs are pruned when they exceed the storage budget.
- HTML, XHTML, and SVG files, including archive members, download instead of running as active content in the viewer.

### Python 3.14

- The backend's Python environment was upgraded from 3.13 to 3.14.

### Dependency Security

- Updated all **dependencies** with known issues or vulnerabilities to fixed versions

## Internals

- Companion build for Windows: Authenticode signing was removed from PR check builds and only remains on release workflows.
