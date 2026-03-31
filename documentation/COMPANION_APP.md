# Sambee Companion App

The Sambee Companion is a lightweight desktop application that lets you open files from your Sambee web interface directly in native desktop editors (Word, Photoshop, LibreOffice, etc.). When you're done editing, the changed file is automatically uploaded back to the SMB share.

## How It Works

1. **Click "Open in App"** in the Sambee web interface (toolbar button, context menu, or `Ctrl+Enter`)
2. The Companion receives the request via a secure deep link
3. The file is downloaded to a temporary location and opened in your preferred application
4. A small "Done Editing" window appears — click **Upload & Close** when finished
5. The modified file is uploaded back to the server and the temp copy is cleaned up

The Companion runs quietly in your system tray. No browser extensions or manual setup are required beyond initial installation. Local Drives access requires the companion to be running, so starting it automatically when you sign in is recommended.

## Installation

### Windows

1. Download the installer from the dedicated [Sambee Companion Releases](https://github.com/helgeklein/sambee-companion/releases) page
2. Run the installer and follow the prompts
3. Leave **Start Sambee Companion when I sign in** enabled if you want Local Drives access to be available immediately after logging in
4. The Companion starts automatically and appears in the system tray

### macOS

1. Download the `.dmg` file from the dedicated [Sambee Companion Releases](https://github.com/helgeklein/sambee-companion/releases) page
2. Open the disk image and drag **Sambee Companion** to your Applications folder
3. Launch the app — it will appear in the menu bar

### Linux

Download the appropriate package for your distribution from the dedicated [Sambee Companion Releases](https://github.com/helgeklein/sambee-companion/releases) page:

- `.deb` for Debian/Ubuntu
- `.AppImage` for other distributions

For the `.deb` package:

```bash
sudo dpkg -i sambee-companion_*.deb
```

For the AppImage:

```bash
chmod +x Sambee-Companion_*.AppImage
./Sambee-Companion_*.AppImage
```

## First Use

When you click **Open in App** in the Sambee web interface for the first time:

1. Your browser asks for permission to open the `sambee://` link — click **Allow** (and optionally check "Always allow")
2. The Companion opens and asks which application to use for the file type
3. Choose your preferred application (optionally check "Always use this app" to remember your choice)
4. The file downloads and opens in the selected application

On subsequent uses, the file opens automatically in your chosen application.

## System Tray

The Companion lives in your system tray (Windows/Linux) or menu bar (macOS). Right-click the tray icon to see:

- **Active operations** — files currently being edited, with their status
- **Preferences…** — open the settings panel
- **Quit Sambee Companion** — exit the application

## Preferences

Access preferences from the system tray menu → **Preferences…**

### Paired Browsers

A list of browser origins that are allowed to access local drives through this companion. Removing one forces that browser to pair again before it can use Local Drives.

### Startup

Enable **Start Sambee Companion when I sign in** to keep the companion available for Local Drives without launching it manually. On Windows, the installer offers the same setting during setup.

### Upload Conflict Resolution

Controls what happens if the file on the server was modified by someone else while you were editing:

| Option | Behavior |
|---|---|
| **Ask me every time** (default) | Shows a dialog letting you choose to overwrite, save as a new copy, or cancel |
| **Always overwrite** | Automatically replaces the server copy with your version |
| **Always save as copy** | Automatically saves your version alongside the original with a modified filename |

### Desktop Notifications

Enable or disable system notifications for edit events such as successful uploads or errors.

### Temp File Cleanup

How many days to keep temporary file copies after editing is complete (default: 7 days). Expired files are cleaned up automatically when the Companion starts.

## Editing Workflow Details

### The "Done Editing" Window

When a file is opened for editing, a small always-on-top window appears showing:

- The filename being edited
- The application used to open it
- Whether the file has been modified
- An **Upload & Close** button to save changes back to the server
- A **Discard** button to abandon changes

You can continue working in other applications — the Done Editing window stays visible as a reminder.

### Large Files

Files larger than 50 MB trigger a confirmation dialog before downloading. This prevents accidental downloads of very large files over slow connections.

### Recovering From Crashes

If the Companion or your computer crashes while editing, on next launch you'll see a recovery dialog listing any in-progress files. For each file you can:

- **Upload** — save the local copy back to the server
- **Discard** — delete the local copy without uploading
- **Dismiss** — keep the local copy for later (it will appear again on next launch)

## Auto-Updates

The Companion checks for updates automatically in the background. Updates come from Sambee's dedicated Companion release feed and are verified with the embedded updater signature before installation. When an update is available, it downloads and installs silently. The next time the Companion launches, you'll be running the latest version.

## Troubleshooting

### "Open in App" does nothing

- Make sure the Companion is running (look for the Sambee icon in your system tray)
- If you use Local Drives regularly, enable **Start Sambee Companion when I sign in** in Preferences so the companion is already running after login
- Check that your browser allowed the `sambee://` deep link. Some browsers require re-allowing after updates
- On Linux, verify the deep-link handler is registered: `xdg-mime query default x-scheme-handler/sambee`

### File doesn't upload after editing

- Check that the Sambee server is reachable from your network
- Look at the "Done Editing" window for error messages
- If the window is missing, check the system tray for active operations

### Application picker doesn't show my editor

- Click **Browse…** at the bottom of the app picker to manually locate the application executable
- The chosen application is remembered per file extension

### The Companion won't start

- **Windows:** Check Windows Event Viewer for crash logs
- **macOS:** Check Console.app for crash reports
- **Linux:** Run from a terminal to see log output: `sambee-companion`

### Resetting preferences

Preferences are stored in your OS-specific app data directory:

- **Windows:** `%APPDATA%\app.sambee.companion\`
- **macOS:** `~/Library/Application Support/app.sambee.companion/`
- **Linux:** `~/.local/share/app.sambee.companion/`

Delete the `user-preferences.json` and `app-preferences.json` files to reset all settings.

### Log files

The Companion writes log files to:

- **Windows:** `%LOCALAPPDATA%\Sambee\Companion\logs\sambee-companion.log`
- **macOS:** `~/Library/Application Support/app.sambee.companion/logs/sambee-companion.log`
- **Linux:** `~/.local/share/sambee-companion/logs/sambee-companion.log`

### WebView2 data (Windows only)

On Windows, the embedded Edge WebView2 browser engine stores its runtime data (GPU cache, local storage, etc.) in `%LOCALAPPDATA%\app.sambee.companion\EBWebView\`. This directory is managed automatically by the WebView2 runtime and can be safely deleted — it will be recreated on next launch.

## Uninstalling

### Windows

Use **Settings → Apps → Installed apps** and search for "Sambee Companion", then click **Uninstall**.

### macOS

Drag **Sambee Companion** from Applications to the Trash.

### Linux

For `.deb` installations:

```bash
sudo apt remove sambee-companion
```

For AppImage installations, simply delete the AppImage file.
