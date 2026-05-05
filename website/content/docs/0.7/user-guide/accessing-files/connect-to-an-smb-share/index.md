+++
title = "Connect to an SMB Share"
description = "Open and explore an SMB share directly in the browser, whether the connection was shared with you or created for your own account."
+++

SMB shares are network folders. In Sambee, they open directly in the browser. You do not need Sambee Companion for this workflow.

Depending on your Sambee setup, you may see:

- **shared connections** created by an administrator for other users to access
- **private connections** that you create and manage for your own account

## Before You Start

To open and explore an SMB share, you need:

- a Sambee account that can sign in successfully
- at least one SMB connection listed in Sambee, either shared with you or created by you
- network access to the Sambee service

If no SMB connection exists yet, the next step depends on your account:

- if you can manage private SMB connections, add one in **SMB Connections**
- if you cannot create connections for yourself, ask an administrator to create or share one

Already see the connection in Sambee? Jump to [Explore a Share](#explore-a-share).

## Shared and Private Connections

Sambee can show two kinds of SMB connections:

- **Shared connections**: created by an administrator and visible to more than one user
- **My connections**: private SMB connections visible only to your account

When your role allows private connections, open **SMB Connections** and use **Add Connection** when the share is missing.

If your account does not let you create connections, you may only see shared connections. In that case, ask an administrator to create or share the connection you need.

## Explore a Share

1. Open Sambee and choose the SMB connection you want to use.
2. Wait for the first directory listing to load.
3. Open folders to move deeper into the share.
4. Use breadcrumbs or parent-directory navigation to move back up.
5. Open a supported file if you want to preview it before downloading or editing.

Missing connection? Add it first in **SMB Connections** if your role allows private connections.

## What You Can Do in the Browser Alone

Once the share is open in the browser, you can stay entirely in the web UI for common tasks such as:

- exploring folders
- previewing supported files
- downloading files
- uploading files, if you have permission
- renaming, deleting, creating folders, and similar file-management tasks
- editing Markdown files in the browser

## Next Steps after Access Works

Now that the share is open, choose the next task:

- [Dual-Pane Mode](../../browsing-and-navigation/dual-pane-mode/): move through folders faster
- [Preview Supported Files](../../viewing-and-previewing/preview-supported-files/): inspect files in the browser
- [Common File Management Tasks](../../managing-files/common-file-management-tasks/): upload, download, rename, copy, move, and delete files
- [Edit Markdown in the Browser](../../editing-files/edit-markdown-in-the-browser/): edit Markdown without leaving Sambee
- [Install and Start the Companion App](../../companion-app/install-and-start-the-companion-app/): enable local drives in the browser or use **Open in App** when you need to leave the browser-only workflow

## Common Problems

### No SMB Connection Appears

Start with these questions:

- Does your account allow private SMB connections?
- Is the connection supposed to be a shared connection from an administrator?

If you can create private connections, open **SMB Connections** and add the share there.

If you cannot create connections, or the share should already be shared with you, contact an administrator.

### The Share Appears, but Folders Do Not Load

Try refreshing the file list. If the problem continues, the likely cause is on the service or storage side rather than in your browser session.

### I Expected Local Drives, Not SMB Shares

For local drives instead, use [Access Local Drives and Pair Your Browser](../access-local-drives-and-pair-your-browser/).

## When to Involve an Administrator

Involve an administrator when:

- you cannot create private SMB connections and the shared connection you need is missing
- a shared connection should exist but does not appear
- the same share consistently fails to load after a refresh
- the same storage source fails for more than one user

For broader SMB trouble, use [Common User Problems](../../troubleshooting/common-user-problems/).
