+++
title = "Common File Management Tasks"
description = "Handle upload, download, folder creation, rename, copy, move, and delete workflows in Sambee."
+++

Sambee supports the file tasks users reach for most often in the browser, whether the files come from SMB shares or from local drives already exposed there.

## Upload And Download

Use upload when you want to place a local file into the current Sambee folder.

Use download when you want a local copy of a file from Sambee.

These are good browser-first tasks.

For SMB shares, no Companion setup is needed. For files on your computer, Sambee Companion still has to be installed, running, and paired before those local drives appear in the browser.

## Create Folders

Create a new directory in the current location when you need to organize content before uploading or moving files.

If the name is empty or invalid, Sambee rejects it instead of creating a broken folder entry.

## Rename Files And Folders

Rename works on the currently focused item.

Use it when you want to clean up names without moving the item elsewhere. If the new name matches the old one or contains invalid characters, Sambee blocks the change.

## Copy And Move

Sambee supports copy and move workflows, and dual pane is often the clearest way to prepare those operations.

A practical pattern is:

- keep the source in one pane
- open the destination in the other pane
- confirm the destination before starting the operation

If the destination already contains an item with the same name, Sambee can warn you and ask how to continue.

Some source and destination combinations may not be available. If Sambee cannot complete the operation safely, it reports the problem instead of guessing.

## Delete Files And Folders

Delete is a destructive action, so Sambee asks for confirmation before removing a file or directory.

Pause before confirming, especially when you are in a busy folder or working quickly through a keyboard-driven workflow.

## Permissions Still Matter

Sambee does not override the permissions of the underlying storage.

If an upload, rename, move, or delete action fails:

- confirm you are in the correct folder
- check whether the target already exists
- retry only if you understand what blocked the previous attempt
- involve an administrator if the failure looks like a permission or provisioning issue rather than a one-off input mistake

If the same write action fails repeatedly on the same source, treat it as an access or environment issue rather than a one-off mistake.

For two-pane copy and move work, use [Explore, Search, And Use Dual Pane](../../browsing-and-navigation/browse-search-and-use-dual-pane/).

Need file access first? Start with [What Sambee Can Access](../../getting-started/what-sambee-can-access/).

Repeated failures? Use [Common User Problems](../../troubleshooting/common-user-problems/).
