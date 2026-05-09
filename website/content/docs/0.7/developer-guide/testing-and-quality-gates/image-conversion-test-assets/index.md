+++
title = "Image Conversion Test Assets"
+++

Sambee uses generated image fixtures to test the image-conversion and preprocessing pipeline without bloating the repository with large checked-in binaries.

These fixtures exist to verify real conversion behavior, especially around colorspace handling where naive expectations are often wrong.

## Why These Assets Exist

The backend conversion pipeline has to do more than just decode files successfully.

- CMYK inputs must convert into browser-safe RGB output without silent inversion or broken ICC handling
- RGB inputs should preserve color rather than drifting during conversion
- preprocessable vector formats such as EPS and AI need realistic fixtures, not only mocked unit tests
- grayscale and Lab examples protect less-common conversion paths

That is why the repo includes a generated fixture workflow instead of relying only on synthetic unit-level mocks.

## Where the Generated Assets Live

The generation workflow populates `backend/tests/test_data/`.

Current layout:

- `backend/tests/test_data/images/cmyk/`
- `backend/tests/test_data/images/rgb/`
- `backend/tests/test_data/images/special/`
- `backend/tests/test_data/expected/`
- `backend/tests/test_data/metadata/manifest.json`
- `backend/tests/test_data/.gitignore`

The generated image set is intentionally small.

- 4 CMYK fixtures
- 4 RGB fixtures
- 2 special-colorspace fixtures

Those ten files are enough to exercise the main conversion and preprocessing paths without turning the repo into an asset dump.

## What the Current Fixture Set Covers

### CMYK Fixtures

The CMYK set covers:

- PSD
- TIFF
- EPS
- AI

These are the highest-value fixtures because CMYK conversion is where incorrect assumptions are most likely.

Important rule: CMYK inputs do not convert to the naive pure RGB values contributors often expect.

Examples from the real tests:

- CMYK cyan does not become pure `(0, 255, 255)`
- CMYK magenta does not become pure `(255, 0, 255)`
- CMYK yellow does not become pure `(255, 255, 0)`
- CMYK black does not become pure `(0, 0, 0)`

The expected values in `backend/tests/test_image_conversion_real.py` reflect real ICC-profile conversion output, and those test expectations are the current source of truth for assertion behavior.

### RGB Fixtures

The RGB set verifies that already-browser-friendly color inputs do not get unintentionally altered during conversion.

Those fixtures cover:

- PSD
- TIFF
- EPS
- AI

The expectation there is preservation rather than major transformation.

### Special Colorspaces

The special set currently includes:

- grayscale PSD
- Lab TIFF

These protect lesser-used but still important conversion paths.

## How the Assets Are Generated

The supported entry point is:

```bash
./scripts/setup-test-images
```

That script:

- creates the test-data directory structure
- generates raster fixtures with ImageMagick
- generates EPS and AI fixtures with hand-crafted PostScript instead of relying on ImageMagick to produce trustworthy CMYK vector output
- writes `metadata/manifest.json`
- writes `backend/tests/test_data/.gitignore` so the generated artifacts do not become repository noise

The vector-generation choice is deliberate. Hand-crafted PostScript gives the tests explicit `DeviceCMYK` or `DeviceRGB` behavior that is more reliable than hoping a generic export path preserves the intended colorspace semantics.

## Manifest Versus Test Assertions

Treat the manifest as generated inventory metadata, not as the sole assertion source for the image-conversion tests.

The real backend assertions currently live in `backend/tests/test_image_conversion_real.py`, including:

- colorspace expectations
- color-distance tolerances
- converter-path expectations such as preprocessor usage

That distinction matters because fixture metadata can drift if contributors update the script but forget the test semantics, or vice versa.

## How the Tests Use the Assets

The main integration coverage lives in `backend/tests/test_image_conversion_real.py`.

That file:

- auto-generates the fixtures through an autouse module-scoped fixture when they are missing
- loads the generated manifest for iteration over the asset set
- uses `pyvips` to inspect colorspace and average color values
- verifies conversion output from `convert_image_for_viewer(...)`
- checks preprocessable formats through `PreprocessorRegistry`

The tests are marked as integration tests because they exercise real decoding and conversion behavior rather than only mocked internals.

## Supported Commands

To generate the assets explicitly:

```bash
./scripts/setup-test-images
```

To run the real image-conversion integration suite:

```bash
cd backend && pytest tests/test_image_conversion_real.py -v
```

To focus on CMYK behavior:

```bash
cd backend && pytest tests/test_image_conversion_real.py -k cmyk -v
```

To pair the tests with backend coverage for the conversion service:

```bash
cd backend && pytest tests/test_image_conversion_real.py --cov=app/services/image_converter
```

## Tolerances and Performance Expectations

The current suite intentionally allows some color-distance tolerance.

- CMYK conversion assertions allow wider tolerance because ICC-based conversion is not a byte-for-byte identity transform
- RGB preservation assertions use tighter thresholds because the expected result is much closer to the source color intent

The same suite also keeps a simple performance guard so tiny generated fixtures do not regress into unexpectedly slow conversions.

## When to Change the Fixture Set

Update the generated assets when:

- you add support for a new preprocessable format
- you change CMYK or colorspace handling in a way that should be locked down by a real fixture
- you discover a real-world conversion regression that a small generated file can reproduce reliably

When you add or change assets, update all three layers together:

1. `scripts/setup-test-images`
2. `backend/tests/test_image_conversion_real.py`
3. the generated manifest or any related inventory description that the script emits

Do not treat the assets as static binaries that should be edited by hand.

## Troubleshooting

### Assets Missing

If the fixtures are missing, rerun:

```bash
./scripts/setup-test-images
```

The test module can generate them automatically, but explicit generation is usually the fastest way to confirm the local environment is healthy.

### Imagemagick Missing

The generator expects ImageMagick 7 with the supported wrapper path or binary on `PATH`.

If the script reports that `magick` is missing, run the repo's supported system-dependency setup first:

```bash
./scripts/install-system-deps
```

### Color Mismatches

If color assertions change unexpectedly:

- verify that the local environment still has the expected ImageMagick and ICC-profile support
- check whether the backend conversion path changed intentionally
- compare the actual average color output from the failing test before changing tolerances or expected values

Do not update expected colors casually. CMYK expectations in particular exist to catch exactly that sort of silent behavior drift.
