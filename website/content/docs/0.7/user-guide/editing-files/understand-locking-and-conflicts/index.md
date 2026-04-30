+++
title = "Understand Locking And Conflicts"
description = "Understand why Sambee blocks risky edits, what edit locks do, and how to choose between overwrite, save-as-copy, or waiting when more than one version exists."
+++

Use this page when Sambee blocks edit mode, warns that another version exists, or asks how you want to resolve a changed file.

## What Sambee Is Protecting You From

Locking and conflict prompts exist to reduce the risk of:

- two people overwriting each other's work without noticing
- uploading an older local copy over a newer server version
- losing track of which copy is the one you actually want to keep

These are not the same kind of warning.

- A lock problem can block browser edit mode before you start changing the file.
- A conflict can appear later when Companion tries to upload your desktop-app changes back to the server.

## Browser Markdown Editing Uses Edit Locks

When you enter edit mode on a Markdown file on a server-backed connection, Sambee can try to acquire an edit lock first.

If it cannot, you may be blocked from entering edit mode until the conflict is understood.

When that happens:

- refresh the file view
- confirm nobody else is actively editing the same file
- retry once after returning to the read-only preview
- stop retrying if the same lock problem keeps happening and decide who should own the next edit

## Desktop Editing Can Hit Upload Conflicts

If the file on the server changed while you were editing in a desktop app, Companion can show a conflict dialog before uploading your local copy.

The choices are:

- **Overwrite Server Version**: replace the current server copy with your local version
- **Save as Copy**: keep both versions by uploading your local file as a separate copy
- **Cancel**: leave the edit session open without uploading yet

## How To Choose Safely

Use these rules of thumb:

- overwrite only if you are sure your local version should replace the current server version
- save as copy when you need time to compare both versions or preserve everyone’s work
- cancel when you still need to inspect the current server copy or ask someone else what should win

## Preferences Can Change The Default Conflict Behavior

Companion preferences can keep conflict handling on **Ask me every time**, or switch it to always overwrite or always save as a new copy.

If more than one person may touch the same files, **Ask me every time** is usually the safest default.

## When To Stop Retrying

Do not keep retrying save or upload actions without understanding which version should win.

Involve an administrator or the other person working on the file when:

- you do not know whether the server copy or the local copy is authoritative
- the same conflict keeps returning after you thought it was resolved
- the wider Sambee service appears unstable, not just the current file

## Related Pages

- [Edit Markdown In The Browser](../../editing-files/edit-markdown-in-the-browser/): use this when the locked file is a Markdown file being edited in-browser
- [Open Files In Desktop Apps And Save Changes Back](../../editing-files/open-files-in-desktop-apps-and-save-changes-back/): use this when the conflict happened after desktop editing
- [Choose Desktop Apps And Preferences](../../companion-app/choose-desktop-apps-and-preferences/): use this to control the default conflict behavior in Companion
- [Recover After Interrupted Editing](../../companion-app/recover-after-interrupted-editing/): use this when the editing session was interrupted before you finished resolving it
- [Common User Problems](../../troubleshooting/common-user-problems/): use this when you need the broader symptom-based troubleshooting path
