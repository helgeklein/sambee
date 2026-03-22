# Preprocessor Registry

## Overview

`PreprocessorRegistry` is the single source of truth for file formats that must
be preprocessed before libvips can handle them.

## Location

- registry: `backend/app/services/preprocessor.py`
- consumer: `backend/app/services/image_converter.py`

## Registered Formats

The registry currently routes these formats to `ImageMagickPreprocessor`:

| Extension | Preprocessor | Description |
|-----------|--------------|-------------|
| `.psd` | ImageMagick | Photoshop Document |
| `.psb` | ImageMagick | Photoshop Big |
| `.eps` | ImageMagick | Encapsulated PostScript |
| `.ai` | ImageMagick | Adobe Illustrator |

## API

```python
from app.services.preprocessor import PreprocessorRegistry

PreprocessorRegistry.requires_preprocessing("psd")
PreprocessorRegistry.requires_preprocessing(".AI")

preprocessor = PreprocessorRegistry.get_preprocessor_for_format("psd")
result_bytes = preprocessor.convert_to_final_format(psd_bytes, "example.psd", output_format="jpeg")

formats = PreprocessorRegistry.get_supported_formats()
```

`get_preprocessor_for_format(..., preprocessor_type="imagemagick")` is allowed.

## Behavior

- there is one built-in preprocessor implementation
- the registry does not implement fallback chains
- if ImageMagick is unavailable, `PreprocessorError` is raised
- formats can still be registered dynamically with `register_format(...)`

## Adding New Formats

1. Implement a `PreprocessorInterface` subclass.
2. Register the extension in `PreprocessorRegistry._FORMAT_REGISTRY`.
3. Add file-type metadata if needed.
4. Add tests for recognition, availability, validation, and conversion.

## Design Constraints

1. One registry entry per preprocessable extension.
2. Direct in-memory conversion to the final browser format.
3. No shell execution.
4. Validation and timeout enforcement in the preprocessor layer.

## Related Documentation

- [IMAGE_PREPROCESSING_ARCHITECTURE.md](./IMAGE_PREPROCESSING_ARCHITECTURE.md)
