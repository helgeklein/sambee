+++
title = "Understand Locking And Conflicts"
description = "Understand why Sambee blocks risky edits, what edit locks do, and how to choose between overwrite, save-as-copy, or waiting when more than one version exists."
+++

Use this page when Sambee blocks edit mode, warns that another version exists, or asks how you want to resolve a changed file.

Sambee uses two protections that are easy to confuse:

- **Edit locks** stop browser editing before you start.
- **Conflicts** happen later when Sambee Companion tries to upload a desktop-edited file back to the server after that file changed remotely.

## Why These Warnings Exist

Locking and conflict prompts exist to reduce the risk of:

- two people overwriting each other's work without noticing
- uploading an older local copy over a newer server version
- losing track of which copy is the one you actually want to keep

## Edit Locks In Browser Markdown Editing

When you enter edit mode on a Markdown file stored on a share or server, Sambee can try to acquire an edit lock first.

If it cannot, you may be blocked from entering edit mode until the conflict is understood.

When that happens:

- refresh the file view
- confirm nobody else is actively editing the same file
- retry once after returning to the read-only preview
- stop retrying if the same lock problem keeps happening and decide who should own the next edit

## Conflicts After Desktop Editing

If the file on the server changed while you were editing in a desktop app, Companion can show a conflict dialog before uploading your edited local copy back to the server.

The choices are:

- **Overwrite Server Version**: replace the current server copy with your local version
- **Save as Copy**: keep both versions by uploading your local file as a separate copy
- **Cancel**: leave the edit session open without uploading yet

## How To Choose Safely

Use these rules of thumb:

- overwrite only if you are sure your local version should replace the current server version
- save as copy when you need time to compare both versions or preserve everyone’s work
- cancel when you still need to inspect the current server copy or ask someone else what should win

## Default Conflict Behavior

Companion preferences can keep conflict handling on **Ask me every time**, or switch it to always overwrite or always save as a new copy.

To change that setting, use [Choose Desktop Apps And Preferences](../../companion-app/choose-desktop-apps-and-preferences/).

If more than one person may touch the same files, **Ask me every time** is usually the safest default.

## When To Stop Retrying

Do not keep retrying save or upload actions without understanding which version should win.

Involve an administrator or the other person working on the file when:

- you do not know whether the server copy or the local copy should win
- the same conflict keeps returning after you thought it was resolved
- the wider Sambee service appears unstable, not just the current file

After that, return to the workflow you were using:

- [Edit Markdown In The Browser](../../editing-files/edit-markdown-in-the-browser/) for browser editing
- [Open Files In Desktop Apps And Save Changes Back](../../editing-files/open-files-in-desktop-apps-and-save-changes-back/) for desktop editing
