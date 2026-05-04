+++
title = "Choose Desktop Apps And Preferences"
description = "Choose which desktop app Sambee Companion should launch when Sambee uses Open in App, and adjust the routine preferences that affect local-drive access and desktop editing."
+++

Use this page when **Open in App** asks which app to use, keeps opening the wrong app, or you want to change routine Companion settings.

## Choose An App

When you use **Open in App** for a file type for the first time, the browser hands the request to Companion, and Companion can ask which desktop app should handle it.

You can:

- choose one of the apps Companion already found
- use **Browse for another app…** if the editor you want is not listed
- turn on **Always use this app** for that file type if you want Companion to remember the choice

## Should You Turn On Always Use This App?

Turn it on when:

- one app is the normal choice for that file type
- you do not want to pick an app every time

Leave the choice unpinned when:

- you regularly switch between different desktop apps for the same extension
- you are still testing which editor behaves best with this workflow
- the file type is uncommon enough that you want to choose deliberately each time

## Open The Companion Preferences Panel

Open the system tray or menu bar icon and choose **Preferences…** when you want to adjust the routine behavior of Companion itself rather than only one file-opening choice.

Use that panel for settings that affect many sessions, not just one file.

## Settings Most People Care About

The settings that matter most in normal use are:

- **Paired Browsers**: review which browsers can access local drives through this helper app
- **Upload conflict resolution**: choose whether Companion asks every time, always overwrites, or always saves a new copy when the server version changed while you were editing
- **Start Sambee Companion when I sign in**: recommended if you use local drives regularly
- **Desktop notifications**: decide whether edit events should create system notifications
- **Temp file cleanup**: control how long recycled temporary copies are kept after editing finishes

## Safe Starting Settings

If you want a safe starting point:

- enable **Always use this app** only after you are confident about that file type’s normal editor
- keep upload conflict resolution on **Ask me every time** if more than one person may touch the same files
- enable **Start Sambee Companion when I sign in** if local drives are part of your normal workflow

## If The Wrong App Still Opens

If Companion still opens the wrong app:

- stop and avoid editing in the wrong tool
- choose the correct app or use **Browse for another app…** the next time the app picker appears
- if Companion no longer shows the chooser and immediately opens the wrong app, use the broader troubleshooting path before continuing

Normal desktop-editing workflow: [Open Files In Desktop Apps And Save Changes Back](../../editing-files/open-files-in-desktop-apps-and-save-changes-back/).

Interrupted later: [Recover After Interrupted Editing](../../companion-app/recover-after-interrupted-editing/).

Broader Companion trouble: [Common User Problems](../../troubleshooting/common-user-problems/).
