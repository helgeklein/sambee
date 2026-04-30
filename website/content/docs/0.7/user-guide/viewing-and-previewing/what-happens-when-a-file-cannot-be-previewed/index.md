+++
title = "What Happens When A File Cannot Be Previewed"
description = "Understand the difference between unsupported and temporarily unavailable previews, and choose the right next step when Sambee cannot show a file in the browser."
+++

Use this page when Sambee does not show the in-browser preview you expected.

## Start With The Simplest Question

First decide which situation you are in:

- the file type is not meant to preview in the browser
- the viewer exists, but it is temporarily unavailable right now
- the file opened, but the browser viewer is not the right tool for the work you need to do

## When The Format Is Not Supported

If Sambee reports that the viewer is unsupported, treat that as a format limitation rather than a broken browser session.

Your next step is usually one of these:

- download the file if you only need a local copy
- use **Open in App** if you need to continue in an installed desktop app and Companion is available
- check [Supported File Formats](../../reference/supported-file-formats/) if you are not sure whether the format is expected to preview in Sambee

## When The Viewer Is Temporarily Unavailable

If Sambee reports that the viewer is unavailable, the file browser is still usable even though that viewer could not load right now.

This is different from an unsupported format. It usually means the viewer itself could not load, not that the file type can never preview.

Try these steps in order:

- close the viewer message and confirm the file browser still works
- retry the preview once
- if you only need the file content immediately, use download or a desktop-app workflow instead of retrying repeatedly

If the same problem keeps happening across multiple files that should normally preview, it may be an administrator issue rather than something you can fix from the browser alone.

## When A Preview Exists But Is Still Not Enough

Some files open in a browser viewer, but you may still need a different path.

Common examples include:

- you need to edit the file rather than only inspect it
- the file is large enough that a local desktop app is more practical
- the preview shows a simplified or converted version that is good enough for inspection but not for final work

In those cases, use the preview as a quick inspection step and then switch to the workflow that matches your goal.

## When To Stop Troubleshooting As A User

Involve an administrator when:

- files that normally preview no longer open for anyone
- the same viewer fails across many supported files
- the wider Sambee service appears unavailable, not just the preview itself

## Related Pages

- [Preview Supported Files](../../viewing-and-previewing/preview-supported-files/): use this for the normal browser-preview path
- [Supported File Formats](../../reference/supported-file-formats/): use this for the stable summary of user-facing preview coverage
- [Open Files In Desktop Apps And Save Changes Back](../../editing-files/open-files-in-desktop-apps-and-save-changes-back/): use this when preview is not enough and you need a desktop editor
- [Common User Problems](../../troubleshooting/common-user-problems/): use this when the preview issue is part of a broader user-facing failure
