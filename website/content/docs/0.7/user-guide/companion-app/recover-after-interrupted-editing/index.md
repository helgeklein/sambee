+++
title = "Recover After Interrupted Editing"
description = "Recover desktop-editing sessions that were interrupted by a crash, a closed window, or a failed upload step."
+++

Use this page when a desktop-editing session stopped before the file uploaded back to Sambee.

Start with the situation you see right now:

- the **Done Editing** window is still open
- the window is gone, but Companion is still running
- Companion was closed or crashed during the edit session
- the computer restarted while a file was still open for editing

## The Done Editing Window Is Still Open

Start with the information already in that window.

- If the file changed locally and you want to keep those changes, use **Upload & Close**.
- If you intentionally do not want to keep the local edits, use **Discard**.
- If the window shows an error, stop retrying blindly and decide whether the problem is connectivity, app behavior, or a version conflict.

Conflict dialog open now? Switch to [Understand Locking And Conflicts](../../editing-files/understand-locking-and-conflicts/).

## The Window Is Gone, But Companion Is Still Running

Check Companion from the system tray or menu bar.

That is the fastest way to confirm whether the edit operation is still active and whether Companion is waiting for you to finish the workflow.

Start with these checks:

- look for any active operation that still refers to the file you were editing
- if the file still appears active, return to that session instead of opening a second edit of the same file
- if nothing looks active, restart Companion and watch for the recovery dialog on launch

## Companion Or The Computer Closed Unexpectedly

When Companion starts again, it can show a recovery dialog for files that were still in progress.

For each file you can choose:

- **Upload**: send the local copy back to the server
- **Discard**: throw away the local copy without uploading it
- **Later**: keep the local copy and decide again on the next launch

Use **Later** when you need time to compare versions or ask someone else which copy should win.

## If Recovery Ends In A Conflict

If the server version changed while you were editing, recovery can still end in a conflict decision.

Do not keep retrying the upload until you understand whether you should:

- overwrite the current server version
- save your changes as a copy
- pause and compare both versions first

Need help choosing? Use [Understand Locking And Conflicts](../../editing-files/understand-locking-and-conflicts/).

## When To Involve An Administrator

Involve an administrator when:

- the Sambee service itself is unreachable
- uploads fail across multiple files or repeated sessions
- the same desktop editing workflow fails for more than one user in the same environment

When recovery is complete, return to [Open Files In Desktop Apps And Save Changes Back](../../editing-files/open-files-in-desktop-apps-and-save-changes-back/).
