+++
title = "Edit Files in Desktop Apps"
+++

Sambee can open files in installed desktop apps through its Companion helper. If the file is on a local drive, the desktop app can access it directly. In that case, Companion opens the app with the original file path.

If the file is on one of Sambee's SMB connections, the desktop app cannot access it directly. In that case, Companion opens a temporary local copy in the desktop app and synchronizes your changes back to the original location.

The remainder of this page describes the second case.

## Before You Begin

You need:

- Sambee Companion installed and running on your computer.
- A desktop app that can open the file type you want to edit.

Need Companion first? Start with [Install and Pair the Companion App](../../companion-app/install-and-pair-the-companion-app/).

## Start the Editing Workflow

In Sambee, right-click the file and choose **Open in companion app**, or press <kbd>Ctrl</kbd> + <kbd>Enter</kbd>.

{{< admonition type="tip" >}}
Sambee hands the request to Companion through a `sambee://` link. When your browser asks whether to allow that link to open, choose **yes**.
{{< /admonition >}}

{{< admonition type="note" >}}
If your Sambee site is behind a proxy server, Companion may show a separate **Sambee Authentication** window before opening the file. Sign in there and then continue the desktop-editing workflow.
{{< /admonition >}}

### What Happens Under the Hood

Companion handles the rest of the edit session:

- It acquires an edit lock for the file on the file share.
- It downloads the file and stores a temporary local copy.
- If needed, it asks you which desktop app should open the file.
- It opens the local copy in that app.
- It shows a **Done Editing** window, which you use to upload the modified local copy when you are done.

## Choose an App to Open the File

The first time you open a file type, Companion may show an app picker listing the installed apps available for that file type. Choose an app from the list for that extension and optionally remember that choice for later. For app-selection help, use [Desktop App Picker](../../companion-app/desktop-app-picker/).

## Finish the Editing Session

Closing the desktop app by itself does not upload the file and does not finish the session. Uploading is initiated in the **Done Editing** window.

- Changed file: use **Done Editing — Hold to Upload**.
- Unchanged file: use **Done Editing — Hold to Close**.
- Do not want to keep the local changes: use **Discard Changes — Hold**.
