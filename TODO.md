# TODO

## Bugs

## Misc. commands

- Add a command to open the current file list location in a new browser tab (which keyboard shortcut to assign? Ctrl+(Shift)+Tab is needed by the browser)

## File list

- Settings > File browser: add a setting to control whether dot directories are shown in the list
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
