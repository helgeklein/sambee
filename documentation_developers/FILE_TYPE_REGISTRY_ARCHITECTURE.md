# File Type Registry Architecture

## Overview

The File Type Registry is a **centralized, single-source-of-truth** system for managing all file type information in Sambee's frontend. It consolidates what was previously scattered across multiple files into one elegant, maintainable data structure.

## Architecture

### Core Component

**File:** `/workspace/frontend/src/utils/FileTypeRegistry.ts`

This file contains:
1. **Type definitions** - TypeScript interfaces for type safety
2. **Registry data** - A single array with all file type definitions
3. **Index maps** - Fast lookup tables for performance
4. **Query functions** - Helper functions to access registry data

### Data Structure

Each file type is defined with a single entry:

```typescript
interface FileTypeDefinition {
  extensions: string[];           // ['.jpg', '.jpeg']
  mimeTypes: string[];             // ['image/jpeg']
  category: FileCategory;          // 'image' | 'document' | 'text' | etc.
  previewComponent?: () => Promise<{ default: PreviewComponent }>;
  icon: IconIdentifier;            // 'image' | 'pdf' | 'code' | etc.
  color: string;                   // '#00b4d8'
  description?: string;            // 'JPEG Image'
}
```

### Example Entry

```typescript
{
  extensions: [".heic", ".heif"],
  mimeTypes: ["image/heic", "image/heif"],
  category: "image",
  previewComponent: () => import("../components/Preview/ImagePreview"),
  icon: "image",
  color: "#0096c7",
  description: "HEIC/HEIF Image",
}
```

## Key Benefits

### 1. Single Source of Truth
- **One entry** defines everything about a file type
- No duplication across multiple files
- Easy to keep synchronized
- Less chance of inconsistencies

### 2. Easy Maintenance
- Adding a new file type = adding ONE entry
- Changing file type behavior = editing ONE place
- Removing a file type = deleting ONE entry

### 3. Type Safety
- Full TypeScript support
- Compile-time checks for all properties
- Autocomplete in editors
- Catch errors before runtime

### 4. Performance
- Pre-built index maps for O(1) lookups
- Lazy-loaded preview components
- No regex matching on every query

### 5. Flexibility
- Easy to add new categories
- Simple to extend with new properties
- Preview components are optional
- Supports multiple extensions per type
- Supports multiple MIME types per type

## Integration Points

### 1. File Icons (`fileIcons.tsx`)
Delegates to the registry for icon and color information:

```typescript
const iconInfo = getFileIconInfo({ filename, isDirectory });
const IconComponent = iconComponents[iconInfo.icon];
return <IconComponent sx={{ color: iconInfo.color }} />;
```

### 2. Browser Component (`Browser.tsx`)
Imports directly from the registry to determine file handling:

```typescript
import { getPreviewComponent, isImageFile } from "../utils/FileTypeRegistry";

// Check if file has preview
if (hasPreviewSupport(file.mimeType)) {
  openPreview(file);
}

// Get appropriate icon
const icon = getFileIcon({ filename: file.name, isDirectory: file.isDirectory });
```

### 3. Preview Components (`ImagePreview.tsx`, `MarkdownPreview.tsx`)
Import type definitions from the registry:

```typescript
import type { PreviewComponentProps } from "../../utils/FileTypeRegistry";

export const ImagePreview: React.FC<PreviewComponentProps> = ({ ... }) => {
  // Component implementation
};
```

## Query Functions

### `getFileTypeByExtension(filename: string)`
Returns file type definition by filename.

```typescript
const fileType = getFileTypeByExtension("document.pdf");
// Returns: { extensions: [".pdf"], mimeTypes: ["application/pdf"], ... }
```

### `getFileTypeByMime(mimeType: string)`
Returns file type definition by MIME type.

```typescript
const fileType = getFileTypeByMime("image/heic");
// Returns: { extensions: [".heic", ".heif"], ... }
```

### `isImageFile(filename: string)`
Quick check if file is an image.

```typescript
if (isImageFile("photo.jpg")) {
  // Enable gallery mode
}
```

### `isMarkdownFile(filename: string)`
Quick check if file is Markdown.

```typescript
if (isMarkdownFile("README.md")) {
  // Use markdown preview
}
```

### `getPreviewComponent(mimeType: string)`
Gets preview component for MIME type (async, lazy-loaded).

```typescript
const Preview = await getPreviewComponent("image/png");
if (Preview) {
  return <Preview {...props} />;
}
```

### `hasPreviewSupport(mimeType: string)`
Checks if preview is available (sync, no loading).

```typescript
if (hasPreviewSupport(file.mimeType)) {
  showPreviewButton();
}
```

### `getFileIcon({ filename, isDirectory })`
Gets icon identifier and color for display.

```typescript
const { icon, color } = getFileIcon({ filename: "script.py", isDirectory: false });
// Returns: { icon: "code", color: "#3776ab" }
```

### `getFileTypesByCategory(category: FileCategory)`
Gets all file types in a category.

```typescript
const images = getFileTypesByCategory("image");
// Returns array of all image file type definitions
```

## File Categories

```typescript
type FileCategory =
  | "image"        // Photos, graphics
  | "document"     // PDFs, Word docs
  | "text"         // Plain text, Markdown
  | "video"        // Videos
  | "audio"        // Music, sound
  | "archive"      // ZIP, RAR, TAR
  | "code"         // Source code files
  | "spreadsheet"  // Excel, CSV
  | "directory"    // Folders
  | "other";       // Unknown types
```

## Icon Identifiers

```typescript
type IconIdentifier =
  | "image"       // ImageIcon (photos)
  | "text"        // TextSnippetIcon (text files)
  | "pdf"         // PictureAsPdfIcon (PDFs)
  | "doc"         // DescriptionIcon (documents)
  | "spreadsheet" // TableChartIcon (Excel/CSV)
  | "code"        // CodeIcon (source code)
  | "video"       // MovieIcon (videos)
  | "audio"       // AudioFileIcon (music)
  | "archive"     // ArchiveIcon (compressed files)
  | "folder"      // FolderIcon (directories)
  | "file";       // InsertDriveFileIcon (unknown)
```

## Adding a New File Type

### Minimal Example
```typescript
// In FILE_TYPE_REGISTRY array:
{
  extensions: [".new"],
  mimeTypes: ["application/x-new"],
  category: "other",
  icon: "file",
  color: "#757575",
}
```

### Full Example (with preview)
```typescript
{
  extensions: [".pdf"],
  mimeTypes: ["application/pdf"],
  category: "document",
  previewComponent: () => import("../components/Preview/PdfPreview"),
  icon: "pdf",
  color: "#ff0000",
  description: "PDF Document",
}
```

## Migration from Old System

### Before (3 separate files)
```typescript
// PreviewRegistry.ts
const PREVIEW_REGISTRY = new Map([
  [/^image\/jpeg$/, () => import("./ImagePreview")],
]);

// fileIcons.tsx
if (["jpg", "jpeg"].includes(ext)) {
  return <ImageIcon sx={{ color: "#00b4d8" }} />;
}

// Browser.tsx
const mimeTypeMap = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};
```

### After (1 entry in registry)
```typescript
// FileTypeRegistry.ts
{
  extensions: [".jpg", ".jpeg"],
  mimeTypes: ["image/jpeg"],
  category: "image",
  previewComponent: () => import("../components/Preview/ImagePreview"),
  icon: "image",
  color: "#00b4d8",
  description: "JPEG Image",
}
```

## Performance Characteristics

- **Extension lookup:** O(1) via HashMap
- **MIME type lookup:** O(1) via HashMap
- **Category query:** O(n) linear scan (rare operation)
- **Preview loading:** Lazy (only loads when needed)
- **Memory footprint:** ~50KB for entire registry

## Future Enhancements

Potential additions to file type definitions:
- `maxPreviewSize?: number` - Size limit for previews
- `thumbnail?: boolean` - Enable thumbnail generation
- `searchable?: boolean` - Include in file content search
- `editable?: boolean` - Supports in-browser editing
- `defaultApp?: string` - System app for opening
- `validationSchema?: ZodSchema` - Content validation

## Testing

The registry is tested through existing component tests:
- `fileIcons.test.tsx` - Icon rendering
- `Browser-*.test.tsx` - File browsing and preview
- Integration tests - End-to-end workflows

To add tests for a new file type:
```typescript
it("displays correct icon for PDF files", () => {
  const icon = getFileIcon({ filename: "doc.pdf", isDirectory: false });
  expect(icon.icon).toBe("pdf");
  expect(icon.color).toBe("#ff0000");
});
```

## Best Practices

1. **Unique colors** - Choose distinctive colors for each format
2. **Common extensions first** - Put `.jpg` before `.jpeg`
3. **Standard MIME types** - Use official IANA MIME types
4. **Descriptive names** - Use clear, user-friendly descriptions
5. **Lazy loading** - Always use dynamic imports for preview components
6. **Category accuracy** - Pick the most appropriate category
7. **Multiple extensions** - Group variants (`.tif`, `.tiff`) together
8. **MIME type variants** - Include all known variants (`.heic`, `.heif`)

## Related Documentation

- [Adding New File Types](./ADDING_NEW_FILE_TYPES.md) - Step-by-step guide
- [Preview Support](../documentation/PREVIEW_SUPPORT.md) - User-facing docs
- [Server-Side Image Conversion](./SERVER_SIDE_IMAGE_CONVERSION.md) - Backend processing
