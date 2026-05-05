+++
title = "Backend Architecture"
description = "Understand the FastAPI backend, what it owns, and which server-side contracts the rest of the product depends on."
+++

The backend is where Sambee's server-side behavior becomes real: authentication, API shape, SMB access, file operations, edit locks, and change notifications all converge here.

Start with:

- [Backend Overview](./backend-overview/)
- [Request Flow and Service Boundaries](./request-flow-and-service-boundaries/)
- [Image Preprocessing and Conversion Pipeline](./image-preprocessing-and-conversion-pipeline/)
- [SMB Change Notification and Directory Freshness](./smb-change-notification-and-directory-freshness/)
- [File Operations and Edit Locking](./file-operations-and-edit-locking/)

Use this section before you change browser-visible behavior that depends on the API, SMB semantics, or server-side validation.
