+++
title = "Open Files In Desktop Apps And Save Changes Back"
description = "Use Open in App with Sambee Companion installed and running so the browser can open a file in a desktop app and return the updated version to its source location."
+++

Use this workflow when the browser is not the right editor for the file you need to change.

## Before You Start

You need:

- Sambee Companion installed on your computer
- Sambee Companion running
- a compatible installed desktop app for the file type you want to open

Need Companion first? Start with [Install And Start The Companion App](../../companion-app/install-and-start-the-companion-app/).

Sambee starts this workflow from the browser. Sambee Companion handles the temporary local copy, the desktop-app handoff, and the upload back to the source location.

## Good To Know Before You Edit

- The first time you use **Open in App** for a file type, Companion may ask which desktop app should open it.
- Conflict handling can depend on your Companion settings.
- App choice or conflict settings: [Choose Desktop Apps And Preferences](../../companion-app/choose-desktop-apps-and-preferences/).
- Conflict prompt background: [Understand Locking And Conflicts](../../editing-files/understand-locking-and-conflicts/).

## What This Workflow Does

1. In Sambee, select the file and choose **Open in App**.
2. The browser hands the request to Sambee Companion.
3. On first use for a file type, choose which desktop app should open it.
4. Companion downloads a temporary local copy.
5. Companion opens that copy in your desktop app.
6. You edit the file locally while the **Done Editing** window stays open.

This lets you keep working in the desktop app you already know.

## Finish The Editing Session

When you finish in the desktop app, return to the **Done Editing** window.

- Use **Upload & Close** to send the updated file back to its source location.
- Use **Discard** if you do not want to keep the local changes.

Closing the desktop app by itself does not upload the file.

## Large Files And Version Conflicts

Some files trigger extra confirmation or conflict handling.

- Very large files may ask for confirmation before the local download starts.
- If the file on the server changed while you were editing, Sambee Companion may ask how to resolve the conflict.
- Depending on Companion settings, you may be asked what to do, or Companion may follow the default conflict action you already chose.

To change the default conflict behavior ahead of time, use [Choose Desktop Apps And Preferences](../../companion-app/choose-desktop-apps-and-preferences/).

## If Something Goes Wrong

The most common user-facing problems are:

- **Open in App** does nothing because Sambee Companion is not running or the browser blocked the handoff
- the expected desktop app is not selected yet
- the upload does not complete after editing

Session interrupted and the **Done Editing** window is gone? Use [Recover After Interrupted Editing](../../companion-app/recover-after-interrupted-editing/).

For broader **Open in App** or Companion trouble, use [Common User Problems](../../troubleshooting/common-user-problems/).
