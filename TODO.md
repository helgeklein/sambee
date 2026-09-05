# TODO

## Zip Archives

- Individual member extraction:
   - We already support previewing individual members
   - Add support for selecting and extracting members via file list's existing UI for non-virtual directories (e.g., space to select, F5 to copy)
   - Member-level extraction probably only makes sense in dual-pane view

## Bugs

- Image viewer: while swiping through images in a directory (not an archive), rendering the last image (in either direction) times out.
- Text and Markdown editors: there are still text selection highlighting issues.

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
