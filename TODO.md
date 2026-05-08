# TODO

## Markdown editor

- Table editing: UI is gross and ugly
- Inline code styling

## Quick Bar

- General:
   - There's no way to switch the quickbar between modes with the mouse, e.g. from command mode to smart navigation.
      - Solution:
         - Always show the chip indicating the mode, even in smart navigation mode.
         - When the chip is click, display a list with all modes for the user to select from.
- Command mode:
   - Doesn't filter out unhandled keystrokes so backspace bubbles up to the file list and causes directory navigation
   - `Rename focused item` doesn't work. Focus issue?
   - `Show keyboard shortcuts` opens the shortcut modal beneath (z-index) the still-open quick bar dropdown

## File list

- Make file operations discoverable by adding a toolbar with icons below the bar that contains the connection list

## Authentication system

- OAuth/OIDC

## Theme

- import/export, e.g., as JSON

## Image viewer

- Support multi-page image files:
  - TIFF
  - ICO (test with uberAgent icon)

- Additional formats
   - DCM (medical image format)

## Text viewer and editor

- Support various text-based files
