+++
title = "Open Files In Desktop Apps And Save Changes Back"
description = "Use Sambee Companion to open a file in an installed desktop app, finish editing, and return the updated file to its source location."
+++

Use this workflow when the browser is not the right editor for the file you need to change.

## Before You Start

You need:

- Sambee Companion installed on this computer
- Companion running
- a compatible installed desktop app for the file type you want to open

If Companion is not ready yet, start with [Install And Start The Companion App](../../companion-app/install-and-start-the-companion-app/).

## Open The File In A Desktop App

1. In Sambee, select the file you want to edit.
2. Use the **Open in App** action.
3. On first use for a file type, choose the desktop app you want Sambee Companion to use.
4. Let the file open locally in that app.

Companion downloads the file to a temporary local location and opens it for you.

## Finish The Editing Session

While you work, Companion keeps a small **Done Editing** window visible as a reminder that this file is part of a save-back workflow.

When you are finished:

- use **Upload & Close** to send the updated file back to its source location
- use **Discard** if you do not want to upload the local changes

## Large Files And Conflicts

Some files trigger extra confirmation or conflict handling.

- Very large files may ask for confirmation before the local download starts.
- If the file on the server changed while you were editing, Sambee Companion may ask how to resolve the conflict.
- Depending on Companion settings, the result may be an overwrite prompt, a save-as-copy flow, or another user-facing resolution choice.

If you want to change the default conflict behavior ahead of time, use [Choose Desktop Apps And Preferences](../../companion-app/choose-desktop-apps-and-preferences/).

## If Something Goes Wrong

The most common user-facing problems are:

- **Open in App** does nothing because Companion is not running or the browser blocked the deep link
- the expected desktop app is not selected yet
- the upload does not complete after editing

If the session was interrupted and the **Done Editing** window is gone, use [Recover After Interrupted Editing](../../companion-app/recover-after-interrupted-editing/).

For the broader symptom path, use [Common User Problems](../../troubleshooting/common-user-problems/).

## Related Pages

- [Choose Desktop Apps And Preferences](../../companion-app/choose-desktop-apps-and-preferences/): use this for app choice, startup behavior, and conflict settings
- [Recover After Interrupted Editing](../../companion-app/recover-after-interrupted-editing/): use this when the session was interrupted before upload finished
- [Understand Locking And Conflicts](../../editing-files/understand-locking-and-conflicts/): use this when the problem is really about version conflicts rather than launching the editor
- [Common User Problems](../../troubleshooting/common-user-problems/): use this when the desktop-editing issue is part of a broader Companion problem
