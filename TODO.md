# TODO

## Settings

### Styling

- Apply the new dialog styling to dialogs we missed previously:
   - "Choose viewer"
- Apply the new dialog styling to the settings pages, too, e.g.:
   - 2-column design on desktop, 1-column on smaller devices
   - background colors, etc.

## Misc. commands

- Add a command to open the current file list location in a new browser tab (which keyboard shortcut to assign? Ctrl+(Shift)+Tab is needed by the browser)

## File list

- Zip files and other types of archives: inspection, extraction, and creation
   - ENTER should open an archive like a normal directory, i.e., display its contents
      - The user should then be able to navigate the (virtualized) archive contents like any other directory
   - Alt+F9 should extract an archive:
      - Single-pane mode: extract to subdir of current dir, ask for target subdir name (default: name of archive without extension)
      - Dual-pane mode: extract to the current dir in the other pane after asking for confirmation
   - Alt+F5 should create an archive with the currently selected files and dirs
      - Single-pane mode: create the archive in current dir, ask for type (e.g., zip) and archive name
      - Dual-pane mode: create the archive in the other pane's dir, ask for type (e.g., zip) and archive name
   - Codepages used for extracting file/dir names should be autodetected
   - Can we support other types of archives in addition to zip, too, while keeping dependencies minimal?
      - The inspection feature probably makes it necessary to support each type archive both in the backend and in companion
- Settings > File browser: add a setting to control whether dot directories are shown in the list
- Make file operations discoverable by adding a toolbar with icons below the bar that contains the connection list
- Dual-pane mode: Ctrl+left/right to change the location (connection+path) of the left pane to that of the right pane and vice-versa

## Theme

- Visual theme designer
   - changes should be reflected in the UI instantly
   - import/export
   - marketplace to share and rate themes, accessible from the product's UI

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
