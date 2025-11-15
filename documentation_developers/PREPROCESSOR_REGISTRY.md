# Preprocessor Registry

## Overview

The **PreprocessorRegistry** provides a centralized system for managing file format preprocessing in Sambee. It acts as a single source of truth for which file formats require preprocessing before they can be handled by libvips.

## Location

- **Registry**: `backend/app/services/preprocessor.py` → `PreprocessorRegistry`
- **Usage**: `backend/app/services/image_converter.py`

## Purpose

Before libvips can process certain exotic image formats (like Adobe Photoshop PSD/PSB files), they need to be converted to an intermediate format. The registry:

1. **Maintains format-to-preprocessor mappings** - Single source of truth
2. **Provides preprocessor discovery** - Query which formats need preprocessing
3. **Handles fallbacks** - Automatically tries alternative preprocessors
4. **Enables extensibility** - Easy to add new formats/preprocessors

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    PreprocessorRegistry                     │
│  Single source of truth for preprocessor registrations     │
└─────────────────────────────────────────────────────────────┘
                           │
                           │ manages
                           ▼
        ┌──────────────────────────────────────┐
        │     Format-to-Preprocessor Map       │
        │                                      │
        │  "psd" → GraphicsMagickPreprocessor │
        │  "psb" → GraphicsMagickPreprocessor │
        │  (extensible for future formats)    │
        └──────────────────────────────────────┘
                           │
                           │ provides
                           ▼
          ┌────────────────────────────────┐
          │   Preprocessor Implementations  │
          │                                │
          │  • GraphicsMagickPreprocessor  │
          │  • ImageMagickPreprocessor     │
          │  (with automatic fallback)     │
          └────────────────────────────────┘
```

## Registered Formats

Currently registered formats:

| Extension | Preprocessor             | Fallback             | Description           |
|-----------|--------------------------|---------------------|-----------------------|
| `.psd`    | GraphicsMagick (primary) | ImageMagick         | Photoshop Document    |
| `.psb`    | GraphicsMagick (primary) | ImageMagick         | Photoshop Big         |

## API Reference

### Check if Format Needs Preprocessing

```python
from app.services.preprocessor import PreprocessorRegistry

# Check if format requires preprocessing
if PreprocessorRegistry.requires_preprocessing("psd"):
    print("PSD files need preprocessing")

# Works with or without dot, case-insensitive
PreprocessorRegistry.requires_preprocessing(".PSD")  # True
PreprocessorRegistry.requires_preprocessing("psb")   # True
PreprocessorRegistry.requires_preprocessing("jpg")   # False
```

### Get Preprocessor for Format

```python
# Get appropriate preprocessor for a format
# Automatically handles availability checking and fallbacks
preprocessor = PreprocessorRegistry.get_preprocessor_for_format("psd")
intermediate_file = preprocessor.convert_to_intermediate(psd_file)

# Override with specific preprocessor type
preprocessor = PreprocessorRegistry.get_preprocessor_for_format(
    "psd",
    preprocessor_type="imagemagick"  # Force ImageMagick
)
```

### Get All Supported Formats

```python
# Get set of all preprocessable formats
formats = PreprocessorRegistry.get_supported_formats()
# Returns: {"psd", "psb"}
```

### Dynamic Format Registration

```python
# Register a new format at runtime
from app.services.preprocessor import PreprocessorRegistry, PreprocessorInterface

class CorelDrawPreprocessor(PreprocessorInterface):
    SUPPORTED_FORMATS = {"cdr"}
    # ... implementation ...

# Register it
PreprocessorRegistry.register_format("cdr", CorelDrawPreprocessor)

# Now CDR files will be recognized
PreprocessorRegistry.requires_preprocessing("cdr")  # True
```

## Integration Example

### Image Converter Usage

The image converter uses the registry to determine if preprocessing is needed:

```python
# In image_converter.py
from app.services.preprocessor import PreprocessorRegistry

# Extract file extension
extension = ".psd"

# Check if preprocessing needed (registry lookup)
if PreprocessorRegistry.requires_preprocessing(extension):
    # Get appropriate preprocessor (handles availability + fallbacks)
    preprocessor = PreprocessorRegistry.get_preprocessor_for_format(extension)
    
    # Convert to intermediate format
    intermediate_file = preprocessor.convert_to_intermediate(
        input_path,
        output_format="png"
    )
    
    # Process with libvips...
```

## Fallback Behavior

The registry automatically handles preprocessor fallbacks:

1. **Primary preprocessor unavailable**: Try registered fallback
2. **All preprocessors unavailable**: Raise `PreprocessorError` with helpful message

Example:
```python
# If GraphicsMagick is not installed, registry automatically tries ImageMagick
preprocessor = PreprocessorRegistry.get_preprocessor_for_format("psd")
# Returns: ImageMagickPreprocessor (fallback)

# If neither is available
preprocessor = PreprocessorRegistry.get_preprocessor_for_format("psd")
# Raises: PreprocessorError("No available preprocessor for format 'psd'...")
```

## Adding New Formats

To add support for a new file format:

### 1. Create Preprocessor Implementation

```python
# In backend/app/services/preprocessor.py

class PDFPreprocessor(PreprocessorInterface):
    """Preprocessor for PDF files using Ghostscript."""
    
    SUPPORTED_FORMATS = {"pdf"}
    
    def check_availability(self) -> bool:
        # Check if ghostscript is installed
        try:
            result = subprocess.run(
                ["gs", "--version"],
                capture_output=True,
                timeout=5,
                check=False
            )
            return result.returncode == 0
        except (subprocess.SubprocessError, FileNotFoundError):
            return False
    
    def convert_to_intermediate(
        self, input_path: Path, output_format: str = "png"
    ) -> Path:
        # Convert PDF to PNG using ghostscript
        # ... implementation ...
        pass
```

### 2. Register in Registry

```python
# In PreprocessorRegistry._FORMAT_REGISTRY

_FORMAT_REGISTRY: dict[str, type[PreprocessorInterface]] = {
    # Existing formats
    "psd": GraphicsMagickPreprocessor,
    "psb": GraphicsMagickPreprocessor,
    
    # New format
    "pdf": PDFPreprocessor,
}
```

### 3. Update File Type Registry

```python
# In backend/app/utils/file_type_registry.py

FILE_TYPE_REGISTRY: list[FileTypeDefinition] = [
    # ... existing entries ...
    
    FileTypeDefinition(
        extensions=(".pdf",),
        mime_types=("application/pdf",),
        category=FileCategory.DOCUMENT,
        requires_conversion=True,  # ← Needs preprocessing
        description="PDF Document",
    ),
]
```

### 4. Add Tests

```python
# In backend/tests/test_preprocessor.py

class TestPDFPreprocessor:
    def test_check_availability(self):
        preprocessor = PDFPreprocessor()
        # Test availability check
    
    def test_convert_pdf(self, tmp_path):
        # Test PDF conversion
        pass
```

That's it! The registry will automatically:
- Recognize PDF as needing preprocessing
- Provide the correct preprocessor
- Handle errors gracefully

## Design Principles

1. **Single Source of Truth**: All format registrations in `_FORMAT_REGISTRY`
2. **Fail Gracefully**: Clear error messages when preprocessors unavailable
3. **Automatic Fallbacks**: Try alternative preprocessors without user intervention
4. **Type Safe**: Strong typing for format mappings
5. **Extensible**: Easy to add new formats via registration

## Benefits Over Previous Approach

**Before** (hardcoded checks):
```python
# Scattered throughout codebase
needs_preprocessing = extension in {"psd", "psb"}
```

**After** (registry-based):
```python
# Centralized, discoverable, extensible
needs_preprocessing = PreprocessorRegistry.requires_preprocessing(extension)
```

**Advantages**:
- ✅ Single place to add new formats
- ✅ Query-able (what formats are supported?)
- ✅ Automatic fallback handling
- ✅ Consistent with FileTypeRegistry pattern
- ✅ Type-safe format-to-preprocessor mappings
- ✅ Easier testing (mock registry vs scattered checks)

## Testing

See `backend/tests/test_preprocessor.py` → `TestPreprocessorRegistry` for comprehensive tests covering:
- Format recognition (requires_preprocessing)
- Preprocessor retrieval (get_preprocessor_for_format)
- Supported formats listing (get_supported_formats)
- Dynamic registration (register_format)
- Fallback behavior
- Error handling

## Related Documentation

- [Preprocessing Architecture](./PREPROCESSING_ARCHITECTURE.md) - Overall preprocessing design
- [PSD Implementation](./PSD_IMPLEMENTATION_SUMMARY.md) - PSD-specific implementation
- [Preprocessing Quick Reference](./PREPROCESSING_QUICK_REF.md) - Quick reference guide
