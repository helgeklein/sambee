+++
title = "Common User Problems"
description = "Solve the most common user problems involving SMB access, local-drive browser access, previews, Open in App, and desktop editing."
+++

Use this page when something stopped working and you are not sure which full task page to open next.

Start with the symptom that matches yours:

- I cannot see the SMB share I expected
- Local drives are not available
- A file will not preview
- **Open in App** does nothing
- Changes do not upload back after editing
- The wrong app opens, or my editor is missing

## I Cannot See The SMB Share I Expected

Check whether the right shared connection is visible to you, or whether you need to add your own private SMB connection.

If your account cannot create private connections and the shared one you need is missing, ask an administrator.

Full access path: [Connect To An SMB Share](../../accessing-files/connect-to-an-smb-share/).

## Local Drives Are Not Available

Local drives in the browser require a desktop browser, Sambee Companion, and a working browser pairing.

Full local-drive path: [Access Local Drives And Pair Your Browser](../../accessing-files/access-local-drives-and-pair-your-browser/).

## A File Will Not Preview

Start with [What Happens When A File Cannot Be Previewed](../../viewing-and-previewing/what-happens-when-a-file-cannot-be-previewed/) to decide whether preview is unsupported, temporarily unavailable, or simply not enough for your task.

## Open In App Does Nothing

This usually means Sambee Companion is not running yet, or the browser blocked the handoff to the helper app.

Start with [Install And Start The Companion App](../../companion-app/install-and-start-the-companion-app/) if Companion may not be installed or running yet.

Normal desktop-editing workflow: [Open Files In Desktop Apps And Save Changes Back](../../editing-files/open-files-in-desktop-apps-and-save-changes-back/).

## Changes Do Not Upload Back After Editing

Interrupted session: [Recover After Interrupted Editing](../../companion-app/recover-after-interrupted-editing/).

Version choice prompt: [Understand Locking And Conflicts](../../editing-files/understand-locking-and-conflicts/).

Normal workflow again: [Open Files In Desktop Apps And Save Changes Back](../../editing-files/open-files-in-desktop-apps-and-save-changes-back/).

## The Wrong App Opens, Or My Editor Is Missing

App choice and Companion preferences: [Choose Desktop Apps And Preferences](../../companion-app/choose-desktop-apps-and-preferences/).

## When To Escalate

You have probably reached an admin issue rather than a user issue when:

- no shared SMB connection exists for the share you need and your account cannot create private ones
- every browser action fails for the same storage source
- the service itself appears down
- Companion is not available for your environment

At that point, move the issue to the Admin Guide or involve the administrator responsible for the Sambee deployment.
