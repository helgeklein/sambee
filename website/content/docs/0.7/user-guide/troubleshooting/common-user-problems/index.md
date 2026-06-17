+++
title = "Common User Problems"
+++

## Local Drives Are Not Available

Local drives in the browser require a desktop browser, Sambee Companion, and a working browser pairing for the current browser profile.

Work through this checklist:

1. Confirm that you are using a desktop browser. Local-drive access is not available on iPhone, iPad, or Android browsers.
1. Confirm that Sambee Companion is installed and running on the same computer as the browser.
1. Open **Settings** > **Local Drives** and check the current status.
1. If the browser is not paired, start pairing again for this browser.
1. If Local Drives reports that pairing needs repair, repair the pairing so Sambee can store a fresh browser-side secret.

If you still need the full setup flow, continue with [Install and Pair the Companion App](../../companion-app/install-and-pair-the-companion-app/) and [Access Local Drives](../../accessing-files/access-local-drives/).

## Open in Desktop App Does Nothing

This usually means Sambee Companion is not running, or the browser blocked the handoff to the helper app.

Check these first:

- Confirm that Sambee Companion is running on your computer.
- Allow the browser to open the `sambee://` link if the browser asks for permission.
- On Linux, confirm that the deep-link handler is registered with `xdg-mime query default x-scheme-handler/sambee`.

Start with [Install and Pair the Companion App](../../companion-app/install-and-pair-the-companion-app/) if Companion may not be installed or running yet.

Normal desktop-editing workflow: [Edit Files in Desktop Apps](../../viewing-and-editing-files/edit-files-in-desktop-apps/).

## Changes Do Not Upload Back after Editing

The desktop-editing session may have expired or been interrupted.

Typical signs are that the **Done Editing** window says the session expired, authentication failed, the lock was lost, or recovery is required.

Start by reopening the file from Sambee so Companion can establish a fresh edit session and lock context.

See: [File Locking & Conflict Resolution](../../viewing-and-editing-files/file-locking-and-conflict-resolution/).
