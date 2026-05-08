+++
title = "Connect to an SMB Share"
+++

SMB connections are managed in Sambee's settings, which you can open via the gear icon or with the keyboard shortcut <kbd>Ctrl</kbd> + <kbd>,</kbd>.

{{< admonition type="tip" >}}
Connecting to SMB shares does not require the Sambee Companion app. Companion is only for local-drive access and desktop-app integration.
{{< /admonition >}}

## Add a New Connection

Navigate to **Settings** > **Connections**, select **Add Connection**, and fill out the form.

Hints and tips:

- **Connection name:** This is the display name for the connection in Sambee's UI.
- **Path prefix:** If you specify a subdirectory in the share, Sambee's connection root will start in that subdirectory.
- **Visibility:** Connections can be for your account only or for all users on the Sambee server.
- **Access mode:** If you want to prevent modifications to the data on the share, set this to **read only**.

## Explore Files of a Connection

To explore the files and folders in an SMB connection, locate the **Connection List** in the main UI and select the connection you want to open (keyboard shortcut: <kbd>Ctrl</kbd> + <kbd>Down</kbd>).
