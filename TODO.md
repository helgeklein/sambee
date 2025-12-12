# TODO

## Next steps

- PWA
- Frontend: friendlier message when the backend is unreachable (currently: something went wrong)
- Admin UI
- Authentication system
   - OAuth/OIDC

### Apply improvements from image to other viewers

- Once all has been fixed.

## PDF viewer

- Download: currently error
- Tests on mobile
- Test coverage

## Image viewer

- Support multi-page image files:
  - TIFF
  - ICO (test with uberAgent icon)

## Configuration system

- Configuration system that reads settings from the following locations (decreasing priority):
  - Configured by the user (stored in the DB)
  - Settings file
  - Built-in defaults

## Docker

- Add a healthcheck to the prod Dockerfile

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
