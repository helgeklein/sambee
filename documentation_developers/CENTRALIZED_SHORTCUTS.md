# Centralized Keyboard Shortcuts System

## Overview

The keyboard shortcuts system provides a centralized, declarative way to manage keyboard shortcuts across all viewers in the application. Instead of scattering shortcut definitions and tooltip strings across multiple files, everything is defined in one place and reused throughout the app.

## Architecture

### Components

1. **`/frontend/src/config/shortcuts.ts`**: Central registry of all keyboard shortcut definitions
2. **`/frontend/src/hooks/useKeyboardShortcuts.ts`**: React hook for handling keyboard shortcuts
3. **Viewer Components**: Use shortcuts from the registry and inject handlers

### Key Features

- **Single source of truth**: All shortcut keys and labels defined in one file
- **App-wide reusability**: Same shortcuts used across PDF viewer, image viewer, etc.
- **Auto-generated labels**: Display labels auto-generated from shortcut configuration
- **Type safety**: TypeScript interfaces ensure consistency
- **Declarative API**: No imperative event handling code in components

## File Structure

```
frontend/src/
├── config/
│   └── shortcuts.ts              # Centralized shortcut definitions
├── hooks/
│   └── useKeyboardShortcuts.ts   # Hook for handling shortcuts
└── components/
    └── Viewer/
        ├── PDFViewer.tsx         # Uses shortcuts from config
        ├── ImageViewer.tsx       # Uses shortcuts from config
        └── ViewerControls.tsx    # Uses shortcuts for tooltips
```

## Shortcut Definition

### `shortcuts.ts`

Defines shortcut configurations grouped by scope:

```typescript
// Common shortcuts used across all viewers
export const COMMON_SHORTCUTS = {
  CLOSE: {
    id: "close",
    keys: "Escape",
    description: "Close",
    label: "Esc",
    allowInInput: true,
  },
  DOWNLOAD: {
    id: "download",
    keys: "s",
    description: "Download",
    label: "Ctrl+S",
    ctrl: true,
  },
} as const;

// PDF-specific shortcuts
export const PDF_SHORTCUTS = {
  SEARCH: {
    id: "search",
    keys: "f",
    description: "Search",
    label: "Ctrl+F",
    ctrl: true,
    allowInInput: true,
  },
  NEXT_PAGE_ARROW: {
    id: "next-page-arrow",
    keys: "ArrowRight",
    description: "Next page",
    label: "Right / D",
  },
  // ... more shortcuts
} as const;

// Image viewer shortcuts
export const IMAGE_SHORTCUTS = {
  // ... image-specific shortcuts
} as const;
```

### Shortcut Properties

- **`id`**: Unique identifier (string)
- **`keys`**: Key(s) to trigger the shortcut (string or string[])
- **`description`**: Human-readable description (string)
- **`label`**: Display label for tooltips (string, optional - auto-generated if omitted)
- **`ctrl`**: Requires Ctrl/Cmd modifier (boolean, optional)
- **`shift`**: Requires Shift modifier (boolean, optional)
- **`alt`**: Requires Alt modifier (boolean, optional)
- **`allowInInput`**: Works when text inputs are focused (boolean, optional)

## Usage

### In Viewer Components

```typescript
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import { COMMON_SHORTCUTS, PDF_SHORTCUTS } from "../../config/shortcuts";

const PDFViewer = () => {
  // ... component state and handlers
  
  useKeyboardShortcuts({
    shortcuts: [
      // Spread shortcut config and add handler
      {
        ...COMMON_SHORTCUTS.CLOSE,
        handler: onClose,
      },
      {
        ...COMMON_SHORTCUTS.DOWNLOAD,
        handler: handleDownload,
      },
      {
        ...PDF_SHORTCUTS.SEARCH,
        handler: handleOpenSearch,
      },
      {
        ...PDF_SHORTCUTS.NEXT_PAGE_ARROW,
        handler: () => handlePageChange(currentPage + 1),
        enabled: currentPage < numPages, // Optional conditional enabling
      },
      // ... more shortcuts
    ],
    inputSelector: 'input[placeholder="Search..."]', // Optional custom selector
  });
  
  return <div>...</div>;
};
```

### In Control Components (for Tooltips)

```typescript
import { withShortcut } from "../../hooks/useKeyboardShortcuts";
import { COMMON_SHORTCUTS, PDF_SHORTCUTS } from "../../config/shortcuts";

const ViewerControls = () => {
  return (
    <IconButton
      onClick={onDownload}
      title={withShortcut(COMMON_SHORTCUTS.DOWNLOAD)}
      aria-label="Download"
    >
      <Download />
    </IconButton>
  );
};
```

The `withShortcut()` function formats the shortcut as: `"Download (Ctrl+S)"`

## Key Auto-Formatting

The system automatically formats special keys for better display:

- `ArrowRight` → `Right`
- `ArrowLeft` → `Left`
- `ArrowUp` → `Up`
- `ArrowDown` → `Down`
- `Escape` → `Esc`
- `" "` (space) → `Space`

Multi-key shortcuts are joined with ` / `:
- `keys: ["d", "D", "ArrowRight"]` → `"Right / D"`

## Modifiers

Modifiers are automatically added to labels:
- `ctrl: true` → Adds `Ctrl+` (or `Cmd+` on macOS)
- `shift: true` → Adds `Shift+`
- `alt: true` → Adds `Alt+`

Example:
```typescript
{
  keys: "r",
  description: "Rotate left",
  shift: true,
}
```
Generates label: `"Shift+R"`

## Benefits

### Before (Decentralized)

**Problems:**
- Shortcut keys defined in PDFViewer.tsx
- Display labels defined separately in pdfShortcuts.ts
- Tooltip helpers specific to PDF viewer
- Duplication when adding shortcuts to ImageViewer
- Easy to have inconsistencies

```typescript
// PDFViewer.tsx
const handleKeyDown = (event: KeyboardEvent) => {
  if (event.key === 's' && event.ctrlKey) {
    handleDownload();
  }
  // ... 140+ more lines
};

// pdfShortcuts.ts
export const PDF_SHORTCUTS = {
  DOWNLOAD: "Ctrl+S",
};

// ViewerControls.tsx
import { PDF_SHORTCUTS } from "./pdfShortcuts";
title={`Download (${PDF_SHORTCUTS.DOWNLOAD})`}
```

### After (Centralized)

**Benefits:**
- Single source of truth for all shortcuts
- Keys and labels defined together
- Auto-generated labels from configuration
- Easy to reuse across viewers
- Type-safe and consistent

```typescript
// config/shortcuts.ts
export const COMMON_SHORTCUTS = {
  DOWNLOAD: {
    id: "download",
    keys: "s",
    description: "Download",
    label: "Ctrl+S",
    ctrl: true,
  },
};

// PDFViewer.tsx
useKeyboardShortcuts({
  shortcuts: [{ ...COMMON_SHORTCUTS.DOWNLOAD, handler: handleDownload }],
});

// ViewerControls.tsx
title={withShortcut(COMMON_SHORTCUTS.DOWNLOAD)}
```

## Adding New Shortcuts

1. **Define in `config/shortcuts.ts`:**
   ```typescript
   export const PDF_SHORTCUTS = {
     // ... existing shortcuts
     PRINT: {
       id: "print",
       keys: "p",
       description: "Print",
       label: "Ctrl+P", // or omit for auto-generation
       ctrl: true,
     },
   };
   ```

2. **Use in viewer component:**
   ```typescript
   useKeyboardShortcuts({
     shortcuts: [
       {
         ...PDF_SHORTCUTS.PRINT,
         handler: handlePrint,
       },
     ],
   });
   ```

3. **Add tooltip to control button:**
   ```typescript
   <IconButton
     title={withShortcut(PDF_SHORTCUTS.PRINT)}
     onClick={handlePrint}
   >
     <Print />
   </IconButton>
   ```

## Testing

The system maintains compatibility with existing tests. Tests can:
- Simulate keyboard events as before
- Assert on button tooltips using `withShortcut()` output
- Verify shortcuts are registered correctly

Example:
```typescript
it("downloads on Ctrl+S", () => {
  render(<PDFViewer {...props} />);
  
  fireEvent.keyDown(window, {
    key: "s",
    ctrlKey: true,
  });
  
  expect(mockDownloadHandler).toHaveBeenCalled();
});
```

## Future Enhancements

Possible improvements:
- **Help dialog**: Show all available shortcuts in a modal
- **Customization**: Allow users to customize shortcuts
- **Context-aware**: Show different shortcuts based on current view/mode
- **Conflicts detection**: Warn about conflicting shortcuts at build time
- **Platform-specific**: Different shortcuts for Windows/Mac/Linux

## Related Files

- `frontend/src/config/shortcuts.ts` - Shortcut definitions
- `frontend/src/hooks/useKeyboardShortcuts.ts` - Hook implementation
- `frontend/src/components/Viewer/PDFViewer.tsx` - PDF viewer usage
- `frontend/src/components/Viewer/ImageViewer.tsx` - Image viewer usage
- `frontend/src/components/Viewer/ViewerControls.tsx` - Tooltip usage
- `documentation_developers/KEYBOARD_SHORTCUTS_REFACTORING.md` - Original refactoring doc

## Migration Guide

For components using old keyboard shortcut patterns:

1. Import centralized shortcuts:
   ```typescript
   import { COMMON_SHORTCUTS, PDF_SHORTCUTS } from "../../config/shortcuts";
   import { useKeyboardShortcuts, withShortcut } from "../../hooks/useKeyboardShortcuts";
   ```

2. Replace imperative event handling:
   ```typescript
   // OLD:
   useEffect(() => {
     const handleKeyDown = (event: KeyboardEvent) => {
       if (event.key === 's' && event.ctrlKey) handleDownload();
       // ...
     };
     window.addEventListener('keydown', handleKeyDown);
     return () => window.removeEventListener('keydown', handleKeyDown);
   }, [dependencies]);
   
   // NEW:
   useKeyboardShortcuts({
     shortcuts: [
       { ...COMMON_SHORTCUTS.DOWNLOAD, handler: handleDownload },
     ],
   });
   ```

3. Update tooltips:
   ```typescript
   // OLD:
   title="Download (Ctrl+S)"
   
   // NEW:
   title={withShortcut(COMMON_SHORTCUTS.DOWNLOAD)}
   ```

4. Remove old shortcut definition files (like `pdfShortcuts.ts`)
