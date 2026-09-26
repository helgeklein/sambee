+++
title = "What's New"
+++

## File List

### Other Changes

- Bugfix: Invalid file browser URLs no longer break the page or prevent the other pane from loading.
- Bugfix: Overlapping download requests were allowed.
- Single files, including files inside ZIP archives, now stream directly to the browser without buffering the whole download in the app. A preparation notice appears only when the handoff takes longer; the browser handles download progress and cancellation afterward. Multi-item archive downloads remain a separate, size-limited operation.
- Bugfix: A failed background connection refresh no longer hides a recovered file listing.
- Bugfix: Uploads and copy or move operations no longer interfere with each other's conflict decisions.

## Under the Hood

### Security Review

- OIDC sign-in now binds the callback and login grant to the browser that started the sign-in flow, preventing a grant from being redeemed in another browser.
- Only admins can list and download uploaded mobile logs; signed-in users can still upload logs for troubleshooting.
- Companion requests now use signatures tied to the HTTP method and requested URL, so a signature can't be reused for another request.
- Mobile log uploads have a size limit, and stored logs are pruned when they exceed the storage budget.
- HTML, XHTML, and SVG files, including archive members, download instead of running as active content in the viewer.
