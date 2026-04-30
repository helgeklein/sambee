+++
title = "Connect To An SMB Share"
description = "Browse an SMB share directly in the browser and understand the most common reasons a share might not appear or load."
+++

SMB shares are the standard browser-based access path in Sambee. You do not need Sambee Companion for this workflow.

## Before You Start

To browse an SMB share, you need:

- a Sambee account that can sign in successfully
- at least one SMB connection made available to you
- network access to the Sambee service

If the share has not been added yet or you do not have permission to use it, involve an administrator.

## Browse A Share

1. Open Sambee and choose the SMB connection you want to use.
2. Wait for the first directory listing to load.
3. Open folders to move deeper into the share.
4. Use breadcrumbs or parent-directory navigation to move back up.
5. Open a supported file if you want to preview it before downloading or editing.

## What You Can Do Without Companion

Once the share is open in the browser, you can stay entirely in the web UI for common tasks such as:

- browsing folders
- previewing supported files
- downloading files
- uploading files, if you have permission
- renaming, deleting, creating folders, and similar file-management tasks
- editing Markdown files in the browser

## When You Do Need Companion

You only need Companion if you want to leave the browser workflow, for example to:

- open a file in an installed desktop app
- return those desktop edits to the original Sambee location
- browse local drives on the same computer

If that is your goal, continue to [Install And Start The Companion App](../../companion-app/install-and-start-the-companion-app/).

## Common Problems

### No SMB connection appears

This usually means the connection has not been added for you yet, or you do not have access to it. Contact an administrator.

### The share appears, but folders do not load

Try refreshing the file list. If the problem continues, the likely cause is on the service or storage side rather than in your browser session.

### I expected local drives, not SMB shares

Local drives are a different access path. Use [Access Local Drives And Pair Your Browser](../access-local-drives-and-pair-your-browser/).

## When To Involve An Administrator

Involve an administrator when:

- no SMB connection appears for the share you actually need
- the same share consistently fails to load after a refresh
- the same storage source fails for more than one user

## Related Pages

- [Browse, Search, And Use Dual Pane](../../browsing-and-navigation/browse-search-and-use-dual-pane/): use this once the share is open and you want to move through it efficiently
- [Common File Management Tasks](../../managing-files/common-file-management-tasks/): use this when the share is open and you want to upload, download, rename, copy, move, or delete items
- [Common User Problems](../../troubleshooting/common-user-problems/): use this when the SMB issue is only one part of a broader user-facing failure
