+++
title = "Choose Desktop Apps And Preferences"
description = "Choose which desktop app Companion should use for a file type, and adjust the routine preferences that affect local-drive and save-back workflows."
+++

Use this page when Companion asks which desktop app to use, keeps opening the wrong kind of app, or you want to tune the routine behavior of desktop-editing sessions.

## Choose An App The First Time

When you use **Open in App** for a file type for the first time, Companion can ask which desktop app should handle it.

At that point you can:

- choose one of the apps Companion already found
- use **Browse for another app…** if the editor you want is not listed
- turn on **Always use this app** for that file type if you want Companion to remember the choice

## Decide Whether To Remember The Choice

Remembering the app is useful when one editor is the normal answer for that file type.

Leave the choice unpinned when:

- you regularly switch between different desktop apps for the same extension
- you are still testing which editor behaves best with this workflow
- the file type is uncommon enough that you want to choose deliberately each time

## Open The Companion Preferences Panel

Open the system tray or menu bar icon and choose **Preferences…** when you want to adjust the routine behavior of Companion itself rather than only one file-opening choice.

Use that panel for settings that affect many sessions, not just one file.

## High-Value Preferences

The preferences that matter most in normal use are:

- **Paired Browsers**: review which browsers can access local drives through this companion
- **Upload conflict resolution**: choose whether Companion asks every time, always overwrites, or always saves a new copy when the server version changed while you were editing
- **Start Sambee Companion when I sign in**: recommended if you use local drives regularly
- **Desktop notifications**: decide whether edit events should create system notifications
- **Temp file cleanup**: control how long recycled temporary copies are kept after editing finishes

## Practical Defaults

If you want a safe starting point:

- enable **Always use this app** only after you are confident about that file type’s normal editor
- keep upload conflict resolution on **Ask me every time** if more than one person may touch the same files
- enable **Start Sambee Companion when I sign in** if local drives are part of your normal workflow

## If The Wrong App Still Opens

If Companion still opens the wrong app:

- choose the correct app or use **Browse for another app…** the next time the app picker appears
- avoid blind save-back attempts if the file opened in an unsuitable editor
- if Companion no longer shows the chooser and immediately opens the wrong app, stop using that workflow blindly and move to the broader troubleshooting path instead of editing in the wrong tool
- use the broader troubleshooting path if the problem is really that **Open in App** no longer behaves normally at all

## Related Pages

- [Install And Start The Companion App](../../companion-app/install-and-start-the-companion-app/): use this if Companion is not installed or not running yet
- [Open Files In Desktop Apps And Save Changes Back](../../editing-files/open-files-in-desktop-apps-and-save-changes-back/): use this for the normal desktop-editing workflow
- [Recover After Interrupted Editing](../../companion-app/recover-after-interrupted-editing/): use this when the save-back session was interrupted
- [Understand Locking And Conflicts](../../editing-files/understand-locking-and-conflicts/): use this when the issue is really version conflict handling rather than app choice
- [Common User Problems](../../troubleshooting/common-user-problems/): use this when Companion behavior is failing more broadly
