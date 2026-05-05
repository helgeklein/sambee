+++
title = "Install and Start the Companion App"
description = "Install Sambee Companion on Windows, macOS, or Linux so the Sambee browser app can connect to local drives and hand files to desktop apps."
+++

Sambee Companion is the desktop helper app that runs alongside the Sambee browser app.

Once it is installed and running, Sambee can show local drives on your computer in the browser and can hand files off to desktop apps through **Open in App**.

You do not need it for normal browser-based SMB access.

## Get the Installer

If Sambee shows a local-drives setup screen, use the **Download for this computer** action there when it is available.

If your environment distributes Companion another way, use the installer source your administrator or Sambee deployment provides.

## Install on Your Platform

### Windows

Run the installer and follow the prompts.

If you expect to use local drives regularly, keep the startup option enabled so Companion is available when you sign in.

### Macos

Open the disk image or installer package you were given and place **Sambee Companion** where you normally install desktop apps.

### Linux

Install the package type that matches your system.

- For `.deb` packages, install with your normal package workflow.
- For AppImage builds, make the file executable and launch it.

## Start Companion

After installation, start Sambee Companion and leave it running while you use local-drive or desktop-app workflows.

On Windows and Linux it normally lives in the system tray. On macOS it normally appears in the menu bar.

## Managed Network Environments

If your Sambee deployment uses HTTPS, Companion follows the desktop environment you already use.

- it uses the operating system's proxy settings when a proxy is required
- it trusts certificates from the operating system's native certificate store
- internal or company-managed root certificates normally work as long as they are installed correctly in that store

That means Companion usually fits into the same desktop trust model as your browser and other installed apps.

## What Happens the First Time You Use It

When a browser action hands control to Companion for the first time:

- the browser may ask for permission to open the `sambee://` link
- Companion may ask you to confirm which desktop app should open a file type
- after that first approval, later actions are usually smoother unless you change apps or browser permissions

## What Companion Enables

Once Companion is installed and running, you can:

- pair your browser so local drives on your computer appear in Sambee
- use **Open in App** to open supported files in installed desktop apps
- upload those desktop edits back to their source location

## Automatic Updates

Companion checks for updates in the background.

When a newer verified build is available, Companion can download and install it automatically.

Normal editing work takes priority. If a desktop-editing session is active, Companion waits for a safe time instead of interrupting that workflow.

If your environment controls Companion distribution centrally, your administrator may also decide which builds are available.

## Uninstall Companion

If you no longer need Companion on a computer, remove it with the normal platform workflow.

### Windows

Open **Settings** -> **Apps** -> **Installed apps**, find **Sambee Companion**, and uninstall it.

### Macos

Remove **Sambee Companion** from Applications the same way you remove other desktop apps.

### Linux

- for `.deb` installs, remove the package with your package manager, for example `sudo apt remove sambee-companion`
- for AppImage installs, stop using the app and delete the AppImage file

## Choose Your Next Companion Task

After Companion is installed and running, the next step depends on what you want to do:

- Files on your computer: [Access Local Drives and Pair Your Browser](../../accessing-files/access-local-drives-and-pair-your-browser/).
- Desktop app editing: [Open Files in Desktop Apps and Save Changes Back](../../editing-files/open-files-in-desktop-apps-and-save-changes-back/).
- App choice, startup behavior, or conflict settings: [Choose Desktop Apps and Preferences](../../companion-app/choose-desktop-apps-and-preferences/).

Interrupted later? Use [Recover after Interrupted Editing](../../companion-app/recover-after-interrupted-editing/).
