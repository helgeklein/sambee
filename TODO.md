# TODO

## Next steps

- Theme:
   - import/export, e.g., as JSON
   - Apparently, the selected theme is only stored locally in the browser. Store it in the backend DB per user instead.
- Frontend: the UI should stay responsive even when the backend is temporarily unavailable
   - Requires downloading all assets to the browser and keeping them there
- Admin UI
- Authentication system
   - OAuth/OIDC

## Image viewer

- Support multi-page image files:
  - TIFF
  - ICO (test with uberAgent icon)

## Markdown viewer

- Add search

## Configuration system

- Configuration system that reads settings from the following locations (decreasing priority):
  - Configured by the user (stored in the DB)
  - Settings file
  - Built-in defaults

## Docker

- The healthcheck doesn't seem to be working

## Settings

### Advanced

#### SMB backends

- SMB read chunk size

#### Preprocessors

- Which preprocessors to enable (e.g., ImageMagick)
- Per preprocessors:
  - Maximum file size to process
  - Conversion timeout

## Code & infrastructure

- Dependabot as GitHub Action to ensure our packages are kept on the latest versions
