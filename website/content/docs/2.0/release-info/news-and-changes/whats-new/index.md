+++
title = "What's New"
+++

## File List

### Other Changes

- Native mobile sharing is now available for single or multiple files from the file list.
- Single-file downloads are now streamed directly without buffering in memory. This speeds up downloads and effectively removes limits imposed by file size.

### Bugfixes

- Invalid file browser URLs no longer break the page or prevent the other pane from loading.
- Overlapping download requests were allowed.
- A failed background connection refresh no longer hides a recovered file listing.
- Uploads and copy or move operations no longer interfere with each other's conflict decisions.

## Under the Hood

### Security Review

- OIDC sign-in now binds the callback and login grant to the browser that started the sign-in flow, preventing a grant from being redeemed in another browser.
- Only admins can list and download uploaded mobile logs; signed-in users can still upload logs for troubleshooting.
- Companion requests now use signatures tied to the HTTP method and requested URL, so a signature can't be reused for another request.
- Mobile log uploads have a size limit, and stored logs are pruned when they exceed the storage budget.
- HTML, XHTML, and SVG files, including archive members, download instead of running as active content in the viewer.
