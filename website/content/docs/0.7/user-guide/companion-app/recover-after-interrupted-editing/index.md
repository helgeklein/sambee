+++
title = "Recover After Interrupted Editing"
description = "Recover desktop-editing sessions that were interrupted by a crash, a closed window, or a failed upload-back step."
+++

Use this page when a desktop-editing session was interrupted before the file uploaded back to Sambee cleanly.

## First Decide What Kind Of Interruption Happened

The most common cases are:

- the **Done Editing** window is still open, but upload did not finish
- Companion was closed or crashed during the edit session
- the computer restarted while a file was still open for editing
- Companion shows a recovery dialog the next time it starts

## If The Done Editing Window Is Still Open

Start with the information already in that window.

- If the file changed locally and you want to keep those changes, use **Upload & Close**.
- If you intentionally do not want to keep the local edits, use **Discard**.
- If the window shows an error, stop retrying blindly and decide whether the problem is connectivity, app behavior, or a version conflict.

If the edit session now shows a conflict dialog, switch to [Understand Locking And Conflicts](../../editing-files/understand-locking-and-conflicts/).

## If The Window Is Gone But Companion Is Still Running

Check Companion from the system tray or menu bar.

That is the fastest way to confirm whether the edit operation is still active and whether Companion is waiting for you to finish the workflow.

Start with these checks:

- look for any active operation that still refers to the file you were editing
- if the file still appears active, return to that session instead of opening a second edit of the same file
- if nothing looks active, restart Companion and watch for the recovery dialog on launch

## If Companion Or The Computer Closed Unexpectedly

When Companion starts again, it can show a recovery dialog for files that were still in progress.

For each file you can choose:

- **Upload**: send the local copy back to the server
- **Discard**: throw away the local copy without uploading it
- **Later**: keep the local copy and decide again on the next launch

Use **Later** when you need time to compare versions or ask someone else which copy should win.

## Do Not Ignore Conflict Prompts

If the server version changed while you were editing, recovery can still end in a conflict decision.

Do not keep retrying the upload until you understand whether you should:

- overwrite the current server version
- save your changes as a copy
- pause and compare both versions first

## When To Stop Treating It As A User-Side Recovery

Involve an administrator when:

- the Sambee service itself is unreachable
- uploads fail across multiple files or repeated sessions
- the same save-back workflow fails for more than one user in the same environment

## Related Pages

- [Open Files In Desktop Apps And Save Changes Back](../../editing-files/open-files-in-desktop-apps-and-save-changes-back/): use this for the normal desktop-editing path before something goes wrong
- [Choose Desktop Apps And Preferences](../../companion-app/choose-desktop-apps-and-preferences/): use this for routine app-choice and conflict-behavior settings
- [Understand Locking And Conflicts](../../editing-files/understand-locking-and-conflicts/): use this when recovery is blocked by a version conflict
- [Common User Problems](../../troubleshooting/common-user-problems/): use this when the interrupted session is only one symptom of a broader issue
