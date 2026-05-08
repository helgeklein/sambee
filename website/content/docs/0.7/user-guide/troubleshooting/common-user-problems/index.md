+++
title = "Common User Problems"
+++

## Local Drives Are Not Available

Local drives in the browser require a desktop browser, Sambee Companion, and a working browser pairing.

Proceed with: [Access Local Drives](../../accessing-files/access-local-drives/).

## Open in Desktop App Does Nothing

This usually means Sambee Companion is not running, or the browser blocked the handoff to the helper app.

Check these first:

- Confirm that Sambee Companion is running on your computer.
- Allow the browser to open the `sambee://` link if the browser asks for permission.
- On Linux, confirm that the deep-link handler is registered with `xdg-mime query default x-scheme-handler/sambee`.

Start with [Install and Pair the Companion App](../../companion-app/install-and-pair-the-companion-app/) if Companion may not be installed or running yet.

Normal desktop-editing workflow: [Edit Files in Desktop Apps](../../viewing-and-editing-files/edit-files-in-desktop-apps/).

## Changes Do Not Upload Back after Editing

The Companion session may have been interrupted.

See: [File Locking & Conflict Resolution](../../viewing-and-editing-files/file-locking-and-conflict-resolution/).
