+++
title = "Common User Problems"
+++

Use this page when something stopped working and you are not sure which full task page to open next.

Start with the symptom that matches yours:

- I cannot see the SMB share I expected
- Local drives are not available
- A file will not preview
- **Open in App** does nothing
- Changes do not upload back after editing
- The wrong app opens, or my editor is missing

## I Cannot See the SMB Share I Expected

Check whether the right shared connection is visible to you, or whether you need to add your own private SMB connection.

If your account cannot create private connections and the shared one you need is missing, ask an administrator.

Full access path: [Connect to an SMB Share](../../accessing-files/connect-to-an-smb-share/).

## Local Drives Are Not Available

Local drives in the browser require a desktop browser, Sambee Companion, and a working browser pairing.

Full local-drive path: [Access Local Drives](../../accessing-files/access-local-drives/).

## A File Will Not Preview

Start with [What Happens When a File Cannot Be Previewed](../../viewing-and-previewing/what-happens-when-a-file-cannot-be-previewed/) to decide whether preview is unsupported, temporarily unavailable, or simply not enough for your task.

## Open in App Does Nothing

This usually means Sambee Companion is not running yet, or the browser blocked the handoff to the helper app.

Check these first:

- confirm Sambee Companion is running on this computer
- allow the browser to open the `sambee://` link if the browser asked for permission
- on Linux, confirm the deep-link handler is registered with `xdg-mime query default x-scheme-handler/sambee`

Start with [Install and Pair the Companion App](../../companion-app/install-and-pair-the-companion-app/) if Companion may not be installed or running yet.

Normal desktop-editing workflow: [Open Files in Desktop Apps and Save Changes Back](../../editing-files/open-files-in-desktop-apps-and-save-changes-back/).

## Changes Do Not Upload Back after Editing

Interrupted session: [Recover after Interrupted Editing](../../companion-app/recover-after-interrupted-editing/).

Version choice prompt: [Understand Locking and Conflicts](../../editing-files/understand-locking-and-conflicts/).

Normal workflow again: [Open Files in Desktop Apps and Save Changes Back](../../editing-files/open-files-in-desktop-apps-and-save-changes-back/).

## The Wrong App Opens, or My Editor Is Missing

App choice and Companion preferences: [Choose Desktop Apps and Preferences](../../companion-app/choose-desktop-apps-and-preferences/).

## When to Escalate

You have probably reached an admin issue rather than a user issue when:

- no shared SMB connection exists for the share you need and your account cannot create private ones
- every browser action fails for the same storage source
- the service itself appears down
- Companion is not available for your environment

At that point, move the issue to the Admin Guide or involve the administrator responsible for the Sambee deployment.
