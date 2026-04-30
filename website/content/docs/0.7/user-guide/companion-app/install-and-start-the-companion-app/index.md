+++
title = "Install And Start The Companion App"
description = "Install Sambee Companion on Windows, macOS, or Linux so you can use local drives and desktop-app workflows."
+++

Sambee Companion is the desktop helper that unlocks local-drive access and desktop-app editing workflows.

You do not need it for normal browser-based SMB access.

## Get The Installer

If Sambee shows a local-drives setup screen, use the **Download for this computer** action there when it is available.

If your environment distributes Companion another way, use the installer source your administrator or Sambee deployment provides.

## Install On Your Platform

### Windows

Run the installer and follow the prompts.

If you expect to use local drives regularly, keep the startup option enabled so Companion is available when you sign in.

### macOS

Open the disk image or installer package you were given and place **Sambee Companion** where you normally install desktop apps.

### Linux

Install the package type that matches your system.

- For `.deb` packages, install with your normal package workflow.
- For AppImage builds, make the file executable and launch it.

## Start Companion

After installation, start Sambee Companion and leave it running while you use local-drive or desktop-app workflows.

On Windows and Linux it normally lives in the system tray. On macOS it normally appears in the menu bar.

## What Happens The First Time You Use It

When a browser action hands control to Companion for the first time:

- the browser may ask for permission to open the `sambee://` link
- Companion may ask you to confirm which desktop app should open a file type
- after that first approval, later actions are usually smoother unless you change apps or browser permissions

## What Companion Enables

Once Companion is installed and running, you can:

- pair this browser for local-drive access
- open supported files in installed desktop apps
- upload those desktop edits back to their source location

The next setup step for local files is [Access Local Drives And Pair Your Browser](../../accessing-files/access-local-drives-and-pair-your-browser/).

If Companion is already installed and you mainly want to change startup or conflict behavior, use [Choose Desktop Apps And Preferences](../../companion-app/choose-desktop-apps-and-preferences/).

## Related Pages

- [Access Local Drives And Pair Your Browser](../../accessing-files/access-local-drives-and-pair-your-browser/): use this to unlock local-drive browsing in the current browser
- [Open Files In Desktop Apps And Save Changes Back](../../editing-files/open-files-in-desktop-apps-and-save-changes-back/): use this for the normal desktop-editing workflow after installation
- [Choose Desktop Apps And Preferences](../../companion-app/choose-desktop-apps-and-preferences/): use this for app-choice and routine Companion settings
- [Recover After Interrupted Editing](../../companion-app/recover-after-interrupted-editing/): use this when a later save-back session is interrupted
