# TODO

## Image preview

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

- Which preprocessors to enable (e.g., GraphicsMagick)
- Per preprocessors:
  - Maximum file size to process
  - Conversion timeout

## Code & infrastructure

- Apply the Python formatting rules (incl. tab width) from Smart Cover Automation
- Dependabot as GitHub Action to ensure our packages are kept on the latest versions

## Tests

### Image conversion

- Automated conversion tests for all supported image files
  - ✅ Design document created: `backend/tests/IMAGE_TESTING_DESIGN.md`
  - ✅ Test image generation script: `scripts/setup-test-images.sh`
  - ✅ Test data structure and manifest defined
  - TODO: Implement simplified test file using auto-generated test images
  - TODO: Integrate with CI/CD pipeline
  - TODO: CMYK→RGB colorspace conversion accuracy verification