+++
title = "User Guide"
+++

Use this guide to work with SMB shares, local drives, previews, editing flows, and common file tasks in Sambee.

Start here if you want to:

- understand which workflows work entirely in the browser
- see when the companion app is required
- preview, edit, upload, download, move, rename, or delete files
- recover from preview, save-back, or local-drive problems before escalating to an administrator

If your issue is about deployment, reverse proxies, server configuration, or service health, use the Admin Guide instead. If the question is about how Sambee is implemented, use the Developer Guide instead.

## In This Guide

- [Getting Started](./getting-started/): choose the right workflow and understand what Sambee can access
- [Accessing Files](./accessing-files/): connect to SMB shares or pair local drives through Companion
- [Browsing And Navigation](./browsing-and-navigation/): move through folders efficiently on desktop and mobile
- [Viewing And Previewing Files](./viewing-and-previewing/): preview supported files and choose the right fallback when a preview is unavailable
- [Editing Files](./editing-files/): edit Markdown in the browser, continue in desktop apps, and understand save conflicts
- [Managing Files](./managing-files/): handle common file operations
- [Companion App](./companion-app/): install Companion, choose desktop-app behavior, and recover interrupted desktop-editing sessions
- [Troubleshooting](./troubleshooting/): recover from common user problems and route into deeper workflow-specific help
- [Reference](./reference/): look up supported preview formats and other stable reference material

## Common Deep Dives

- [What Happens When A File Cannot Be Previewed](./viewing-and-previewing/what-happens-when-a-file-cannot-be-previewed/): decide whether the next step is download, desktop editing, retrying, or admin escalation
- [Recover After Interrupted Editing](./companion-app/recover-after-interrupted-editing/): handle save-back sessions that were interrupted by a crash, a closed window, or a failed upload
- [Understand Locking And Conflicts](./editing-files/understand-locking-and-conflicts/): understand why Sambee blocks risky saves and what to do when more than one version exists

## Before You Begin

Sambee separates browser-only and companion-backed workflows.

- SMB share access works directly in the browser.
- Local-drive access requires Sambee Companion.
- Opening files in installed desktop apps and uploading those edits back also requires Sambee Companion.
- Mobile browsing is supported, but local drives and desktop-app workflows are desktop-first features.

For the full breakdown, start with [What Sambee Can Access](./getting-started/what-sambee-can-access/).

## Use The Right Docs Book

Sambee keeps user, admin, and contributor docs separate on purpose.

- Use this User Guide when the next step belongs to the person using Sambee day to day.
- Use the [Admin Guide](../admin-guide/) when the problem is really about provisioning, deployment, service health, or environment policy.
- Use the [Developer Guide](../developer-guide/) when the question becomes implementation-facing.

