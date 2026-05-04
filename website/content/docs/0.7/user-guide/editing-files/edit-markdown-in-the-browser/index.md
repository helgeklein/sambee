+++
title = "Edit Markdown In The Browser"
description = "Open a Markdown file in Sambee, switch into edit mode, and save your changes without leaving the browser."
+++

Markdown is the main file type that Sambee can edit directly in the browser.

## Start From The Markdown Viewer

When you open a Markdown file, Sambee shows a rendered Markdown view first.

Use that view when you want to read the file quickly before deciding whether to edit it.

## Enter Edit Mode

When you are ready to make changes, use the edit action in the Markdown viewer.

From there you can:

- update the content in the browser
- review the result before saving
- cancel if you decide not to keep the changes

## Search Behavior

Search works a little differently depending on whether you are reading or editing.

- In rendered view, search looks through the visible Markdown content.
- In edit mode, search runs inside the editor.

## Saving Changes

Save the file when you are finished editing.

If you cancel instead, Sambee keeps the original file unchanged.

## Locking And Concurrent Changes

For files stored on a share or server, Sambee can use edit locking to reduce the risk of multiple people changing the same file at the same time.

If you run into a save problem, stale content, or a conflict warning:

- refresh the file view
- confirm nobody else is actively editing the same file
- retry only after you understand which version should win

If Sambee says it cannot acquire the edit lock, stop retrying blindly and switch to [Understand Locking And Conflicts](../../editing-files/understand-locking-and-conflicts/).

For broader editing trouble, use [Common User Problems](../../troubleshooting/common-user-problems/).
