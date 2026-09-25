+++
title = "What's New"
+++

## Under the Hood

### Security Review

- OIDC sign-in now binds the callback and login grant to the browser that started the sign-in flow, preventing a grant from being redeemed in another browser.
- Only admins can list and download uploaded mobile logs; signed-in users can still upload logs for troubleshooting.
- Companion requests now use signatures tied to the HTTP method and requested URL, so a signature can't be reused for another request.
- Mobile log uploads have a size limit, and stored logs are pruned when they exceed the storage budget.
- HTML, XHTML, and SVG files, including archive members, download instead of running as active content in the viewer.
