# TODO

## Misc. commands

- Add a command to open the current file list location in a new browser tab (which keyboard shortcut to assign? Ctrl+(Shift)+Tab is needed by the browser)

## File list

- Settings > File browser: add a setting to control whether dot directories are shown in the list
- Dual-pane mode: Ctrl+left/right to change the location (connection+path) of the left pane to that of the right pane and vice-versa

## Companion

- Auto-update service on Windows that doesn't require user interaction (UAC prompts)
   - Does Tauri already have infrastructure for this?
   - It would have to be a system service (preferred) or scheduled task that runs with elevated rights
   - It should install new updates silently and restart Companion automatically

## Theme editor

- Settings > Appearance > Theme:
   - The theme preview should be a kind of grid.
      - Visually group themes into (display in the order below):
         - Your themes (user-managed)
         - Site themes (admin-managed)
         - Built-in themes (read-only)
      - Add an indicator for the default theme
         - Displayed in the theme's rectangle (top-left?)
         - Without requiring additional space for the rectangle
         - Initial default after installation: Sambee light
      - Only show a theme group if it has content
   - Below the theme preview area, add buttons:
      - Copy
         - Creates a copy with the same name and "(copy)" appended in the same theme group (user themes or site themes)
         - Copies of themes for which the the user doesn't have write permissions are created in "your themes"
            - Built-in themes
            - Site themes (unless the user has admin permissions)
      - Edit
         - Opens the theme editor dialog (see below)
      - Delete
         - Disabled on:
            - Built-in themes
            - Site themes (unless the user has admin permissions)
      - Set as default (requires admin permissions)
   - Buttons apply to the currently selected theme
- Theme editor dialog
   - Use our existing dialog styling and layout system
   - How to efficiently display a theme's colors? Requirements:
      - Clear & efficient UI; not much scrolling is necessary
      - Colors are displayed as hex values and as actual colors (e.g., in a small preview field next to the hex value)
   - Show all colors and allow changing colors via a modern color picker dialog (use what's available, don't reinvent)
   - Show theme properties:
      - Name
      - Description
      - Light or dark
      - Storage:
         - Your themes
         - Site themes (requires admin permissions)
   - Buttons:
      - Save
         - Disabled on:
            - Built-in themes
            - Site themes (unless the user has admin permissions)
      - Save as
         - Allow overwriting after confirmation
            - Overwriting requires the established permissions:
               - Forbidden on:
                  - Built-in themes
                  - Site themes (unless the user has admin permissions)
      - Import
         - Replaces the current values
      - Export
         - Downloads the theme definition as JSON

## Image viewer

- Support multi-page image files:
  - TIFF
  - ICO (test with uberAgent icon)

- Additional formats
   - DCM (medical image format)

## Storage

- Plugin system to support additional backends like S3 or SFTP
   - Every backend must use the new system.
   - This means we need to move the existing storage support (SMB and local drives) to the new system.

## Audio & video players

- MP3 files should be easy
- Videos probably need more dependencies

## Public upload & download links

### Issue

The Sambee backend (container) is designed to be run in an internal network, not exposed to the internet. That prevents file sharing with people who don't have access to the internal network.

### Proposal

#### File sharing service and container

Create a hardened container to be exposed to the internet. This container runs a publicly accessible file sharing service. The public container has no access to Sambee, only the other way round: When files are shared in Sambee, they are copied to the public container. Files uploaded to the public container are pulled in from Sambee.

Files stored on the public container are always end-to-end encrypted. The encryption keys are not stored on the public container. Thus, when the public container is compromised, its data is useless to attackers because the cannot decrypt it.

#### Download links

Files to be shared via download links are encrypted by Sambee. Each sharing operation uses a new, random encryption key. Encryption keys are stored by Sambee so they can be re-shared.

After encryption, Sambee uploads a file to be shared to the public container along with necessary metadata.

Sharing links include the encryption key, so users can access shared files without having to fumble with keys: decryption happens transparently upon access/download in the user's browser.

#### Uplkoad links

Upload links are created in Sambee. They are tied to a specific directory on SMB storage. Access to that directory from the Sambee backends happens with the credentials of the user creating the link.

When an upload link is created in Sambee, the backend communicates the metadata to the public container which then accepts uploads from the internet via the upload link. Uploads are encrypted in the user's browser and stored encrypted on the public container. The public container doesn't store the decryption key. Sambee periodically pulls in new uploads from the public container.

#### User-configurable sharing options

- Time limit: after which shared data is deleted by the public container
- Password: if set, it is combined with the random encryption key. Decryption needs the key (shared via the link) and the password. This enables secure sharing where the link alone is not sufficient to decrypt the data.
- Download links:
   - Max. download count
- Upload links:
   - Max. size
