# TODO

## Settings

## Quick bar

- Add a quick bar mode to open recent files
   - Reasoning/postulate:
      - Users often work on a smallish set of files only, but they open them repeatedly.
      - We should, therefore, making it easier and faster to access files from that set.
   - Implementation:
      - Keep a list of the last n files opened
      - Sort the list by last time opened (most recent at the top)
      - Add a quick bar mode to open and filter that list (re-purpose Ctrl+P for similarity with VS Code? that would mean we'd have to come up with a new shortcut for command mode)
      - Configuration options via a new config section
         - Number of files to keep in the list
         - Exclusion
            - By category: images (all images recognized by Sambee)
            - By file type/extension
      - When a file is selected from the list, open it directly
         - Accept the same keyboard shortcuts as when regularly opening:
            - Enter/click: open in Sambee
            - Shift+Enter/click: choose a Sambee viewer
            - Ctrl+Enter/click: open in its native app
            - Ctrl+Alt+Enter/click: choose a native app
- Directory navigation:
   - Show 5 (?) most recently visited directories at the top of the list, then all others
   - This could/should be similar to what VS Code does in the navigation that opens on Ctrl+P

## Misc. commands

- Add a command to open the current file list location in a new browser tab (which keyboard shortcut to assign? Ctrl+(Shift)+Tab is needed by the browser)

## File browser

- Settings > File browser: add a setting to control whether dot directories are shown in the list
- Make file operations discoverable by adding a toolbar with icons below the bar that contains the connection list
- Dual-pane mode: Ctrl+left/right to change the location (connection+path) of the left pane to that of the right pane and vice-versa

## Markdown editor

- Keyboard shortcut for bold and italic formatting (does it already exist?)
- Search + replace (Ctrl+H)

## Theme

- import/export, e.g., as JSON

## Image viewer

- Support multi-page image files:
  - TIFF
  - ICO (test with uberAgent icon)

- Additional formats
   - DCM (medical image format)

## PDF viewer

- On mobile, allow swiping to move from page to page. Currently, only the arrows in the top bar can be used for browsing back/forward.
