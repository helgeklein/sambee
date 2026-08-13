# TODO

## Settings

## Quick bar

- Repurpose the quick bar mode for filtering files in the current directory into a full-featured file search function
   - Overview:
      - Complement the comprehensive directory navigation (ctrl+k) with an equally feature-rich file search.
      - Restriction: We cannot index all files for performance reasons.
   - Reasoning/postulate:
      - Users often work on a smallish set of files only, but they open them repeatedly.
      - Users are also often interested in the files in the current directory.
      - We should, therefore, making it easier and faster to access files from the combined set of:
         - Recently opened files
         - Files in the current directory
   - Implementation:
      - Change the keyboard shortcut "ctrl+alt+f" to "/"
      - Change the quick bar mode from "Filter" to "File search"
      - Keep a list of the last n files opened
         - Via any of Sambee's means (integrated viewers as well as through Companion)
      - Show search results in 2 groups:
         - Group 1: recently opened files
            - Show the most recent matching files
            - Maximum: 10 (configurable)
            - Most recent at the top
            - Shift+del to delete the currently selected item from the recent files list/table
         - Group 2: files in the current directory
            - Maximum: same as for group 1
      - Configuration options:
         - New admin config category "File Search"
            - Number of files to keep in the recent file list (default: 50)
            - Exclusion
               - By category:
                  - images (all images recognized by Sambee)
                  - what else makes sense?
               - By file type/extension
         - Existing user category "File Browser":
            - Add action "Clear recent files"
      - When a file is selected from the list, open it directly
         - Accept the same keyboard shortcuts as when regularly opening:
            - Enter/click: open in Sambee
            - Shift+Enter/click: choose a Sambee viewer
            - Ctrl+Enter/click: open in its native app
            - Ctrl+Alt+Enter/click: choose a native app
      - Storage:
         - Store the recent files per user in a dedicated table in the backend's DB
         - Add or update a file's record on an open attempt via the browser
            - This is important in relation to Companion. We don't want to introduce a new API that records native file open success/error.
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
