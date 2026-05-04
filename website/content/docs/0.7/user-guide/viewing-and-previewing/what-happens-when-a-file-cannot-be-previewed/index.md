+++
title = "What Happens When A File Cannot Be Previewed"
description = "Understand the difference between unsupported and temporarily unavailable previews, and choose the right next step when Sambee cannot show a file in the browser."
+++

Use this page when Sambee does not show the in-browser preview you expected.

## Start With The Message Sambee Shows

Look at the preview message and use the matching path.

| What you see | What it means | What to do next |
|---|---|---|
| Sambee says the format is not supported | This file type does not preview in the browser | Download the file or use **Open in App** |
| Sambee says the preview could not load | The file type may still be supported, but the viewer failed right now | Retry once, then use another path if needed |
| The preview opens, but it is not enough | The browser viewer is fine for inspection, but not for your actual task | Switch to editing or downloading |

## When The Format Is Not Supported

If Sambee reports that the viewer is unsupported, treat that as a format limitation rather than a broken browser session.

Your next step is usually one of these:

- download the file if you only need a local copy
- use **Open in App** if you need to continue in an installed desktop app and Sambee Companion is installed and running on your computer
- check [Supported File Formats](../../reference/supported-file-formats/) if you are not sure whether the format is expected to preview in Sambee

## When The Preview Should Work But Fails Right Now

If Sambee reports that the viewer is unavailable, the file browser is still usable even though that viewer could not load right now.

This is different from an unsupported format. It usually means the viewer itself could not load, not that the file type can never preview.

Try these steps in order:

- close the viewer message and confirm the file browser still works
- retry the preview once
- if you only need the file content immediately, use download or a desktop-app workflow instead of retrying repeatedly

If the same problem keeps happening across multiple files that should normally preview, it may be an administrator issue rather than something you can fix from the browser alone.

## When You Can Preview The File But Still Need More

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

For broader preview trouble, use [Common User Problems](../../troubleshooting/common-user-problems/).
