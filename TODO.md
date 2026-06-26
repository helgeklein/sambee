# TODO

## Markdown viewer

- Tables:
   - Show tools/controls only when the cursor is in the table or the mouse is hovering above it.
      - Don't reserve space around the table for the controls. A table's visible left border, for example, should be vertically aligned with the left border of other elements on the page.
      - When the controls are shown, overlay them on top of other items that may be rendered above/below the table.
- Code blocks:
   - Show tools/controls only when the cursor is in the code block or the mouse is hovering above it.
      - Specifically: language selector for syntax highlighting and trashcan.
   - Move the language selector for syntax highlighting:
      - Move it directly beneath the bottom right of the code block.
      - Adjust keyboard navigation so that leaving the block with the arrow keys moves the cursor to the language selector.
      - Depending on whether scrolling in the language selector's list of languages needs to be activated with Shift or works with arrow down immediately, allow leaving the language selector with arrow down or tab.

## Mobile

- Browsers use default font colors (and, likely fonts) for file list links (file and directory list items). This doesn't happen on desktop and must have been introduced on mobile relatively recently.

## File list

- Make file operations discoverable by adding a toolbar with icons below the bar that contains the connection list
- When I select multiple files and then press DEL, only one is deleted instead of all of them.

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
