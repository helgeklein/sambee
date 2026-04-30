+++
title = "Common User Problems"
description = "Solve the most common user-facing problems involving SMB access, local drives, previews, Companion, and save-back workflows."
+++

Use this page when something that normally works in Sambee stops working in the browser or in a Companion-backed desktop flow.

## I Cannot See The SMB Share I Expected

Check these first:

- you are signed in to the correct Sambee account
- the share was actually made available to you
- you selected the right connection or storage source

If no suitable SMB connection exists at all, the next step belongs to an administrator. For the normal browser-side SMB path, go back to [Connect To An SMB Share](../../accessing-files/connect-to-an-smb-share/).

## Local Drives Are Not Available

Local drives require all of the following:

- a desktop browser on Windows, macOS, or Linux
- Sambee Companion installed
- Companion running
- this browser paired with Companion on this computer

If Sambee says the current pairing needs repair, pair this browser again.

Use [Access Local Drives And Pair Your Browser](../../accessing-files/access-local-drives-and-pair-your-browser/) for the full pairing, repair, and unpair flow.

If you are on iOS or Android, switch to a desktop browser for this workflow.

## A File Will Not Preview

Not every file type has an in-browser preview.

If Sambee cannot preview a file:

- use the download path if you only need a local copy
- use **Open in App** if a desktop-app workflow is available and appropriate
- check [Supported File Formats](../../reference/supported-file-formats/) if you are unsure whether the format is expected to preview in the browser

If you need help deciding whether this is a format limit or a temporary viewer problem, use [What Happens When A File Cannot Be Previewed](../../viewing-and-previewing/what-happens-when-a-file-cannot-be-previewed/).

## Open In App Does Nothing

This is usually one of these problems:

- Sambee Companion is not running
- the browser blocked or forgot the `sambee://` permission
- the current computer is not the one that should handle the desktop workflow

Start Companion, retry the action, and watch for a browser prompt asking whether to open the link externally.

If the problem is really app choice rather than launch behavior, use [Choose Desktop Apps And Preferences](../../companion-app/choose-desktop-apps-and-preferences/).

## Changes Do Not Upload Back After Editing

Check these first:

- the **Done Editing** window is still open
- you used **Upload & Close** rather than closing the desktop app and assuming upload would happen automatically
- the Sambee service is still reachable

If a conflict occurred because the source file changed while you were editing, follow the conflict resolution prompt instead of retrying blindly.

If the session was interrupted or the **Done Editing** window is gone, use [Recover After Interrupted Editing](../../companion-app/recover-after-interrupted-editing/).

If the problem is really about choosing between two versions, use [Understand Locking And Conflicts](../../editing-files/understand-locking-and-conflicts/).

## The Wrong App Opens, Or My Editor Is Missing

On first use for a file type, Companion may ask which desktop app to use.

If the expected app does not appear:

- choose a different app if it is listed
- use the manual browse or chooser flow if Companion offers it
- retry after installing the editor if it is missing from the system entirely

Use [Choose Desktop Apps And Preferences](../../companion-app/choose-desktop-apps-and-preferences/) for the app picker and the routine Companion settings that affect this flow.

## When To Escalate

You have probably reached an admin issue rather than a user issue when:

- no SMB connection exists for the share you need
- every browser action fails for the same storage source
- the service itself appears down
- Companion download metadata or distribution is missing from your environment

At that point, move the issue to the Admin Guide or involve the administrator responsible for the Sambee deployment.

## Related Pages

- [Connect To An SMB Share](../../accessing-files/connect-to-an-smb-share/): use this for the normal SMB-access path before the problem escalates
- [Access Local Drives And Pair Your Browser](../../accessing-files/access-local-drives-and-pair-your-browser/): use this for the full local-drive pairing and repair path
- [What Happens When A File Cannot Be Previewed](../../viewing-and-previewing/what-happens-when-a-file-cannot-be-previewed/): use this when the preview problem needs a more specific fallback decision
- [Choose Desktop Apps And Preferences](../../companion-app/choose-desktop-apps-and-preferences/): use this when the real issue is app choice or routine Companion settings
- [Recover After Interrupted Editing](../../companion-app/recover-after-interrupted-editing/): use this when a desktop-editing session was interrupted
