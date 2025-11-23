# TODO

## PDF viewer

- Fullscreen view (similar to image viewer).
- Download
- Tests on mobile
- Test coverage

## Markdown viewer

- Migrate to the same view using the full browser window as the image and PDF viewers.
- Fullscreen view (similar to the other viewers).

## Image viewer

- When browsing between images, there's a fading effect in between images (image > black > image). This causes flickering.
- Support multi-page image files:
  - TIFF
  - ICO (test with uberAgent icon)

## Configuration system

- Configuration system that reads settings from the following locations (decreasing priority):
  - Configured by the user (stored in the DB)
  - Settings file
  - Built-in defaults

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

- Apply the Python formatting rules (incl. tab width) from Smart Cover Automation
- Dependabot as GitHub Action to ensure our packages are kept on the latest versions
