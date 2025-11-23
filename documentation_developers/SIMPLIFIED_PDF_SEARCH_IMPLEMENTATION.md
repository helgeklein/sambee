# Simplified PDF Search Implementation Plan

## Executive Summary

**Goal:** Replace the complex Firefox-style text layer manipulation approach with pdf-helper's simpler div overlay method.

**Current Issues:**
- 600+ lines of complex code (lines 165-750 in PDFViewer.tsx)
- Text alignment issues causing search highlight misalignment in some PDFs
- Firefox-style normalization with diff mapping adds cognitive complexity
- Direct DOM manipulation of text layer spans is brittle

**Target Solution:**
- ~250 lines of simpler code (based on pdf-helper reference)
- Div overlay approach: position highlights using PDF.js transform coordinates
- No text normalization - search on original extracted text
- No DOM manipulation - text layer remains untouched
- Better accuracy due to PDF.js coordinate system

---

## Current State Analysis

### What We Have (Complex Approach)

**Text Extraction (lines 165-250):**
```typescript
// Extract text with Firefox normalization
const normalize = useCallback((text: string): [string, number[]] => {
  // Complex normalization logic with diff tracking
  const diffs: number[] = [];
  // ... 80+ lines of normalization
  return [normalized, diffs];
}, []);

// Store 3 versions of each page's text
const [pageTexts, setPageTexts] = useState<Map<number, string>>(new Map());
const [normalizedPageTexts, setNormalizedPageTexts] = useState<Map<number, string>>(new Map());
const [pageDiffs, setPageDiffs] = useState<Map<number, number[]>>(new Map());
```

**Problems:**
- Normalization introduces complexity and potential bugs
- Need to map positions between normalized and original text
- Diff array maintenance is error-prone
- No guarantee that DOM text matches extracted text exactly

**Search Logic (lines 356-410):**
```typescript
// Search in normalized text, then map back to original positions
const performSearch = useCallback((query: string) => {
  const [normalizedQuery] = normalize(query.toLowerCase());
  // Search in normalizedPageTexts
  const [originalIndex, originalLength] = getOriginalIndex(diffs, normIndex, length);
  // ... complex position mapping
}, [normalize, getOriginalIndex, normalizedPageTexts, pageDiffs]);
```

**Problems:**
- Two-phase search: normalize, then map back
- Position mapping can fail or be inaccurate
- Hard to debug when highlights are misaligned

**Highlighting (lines 450-750):**
```typescript
// Manipulate text layer spans directly
useEffect(() => {
  // Store original span text
  const textContentItems = originalTextContentRef.current.get(currentPage);
  
  // Clear and rebuild span content with highlight markers
  for (const match of convertedMatches) {
    // Firefox _convertMatches logic to find div indices
    // Split span text and insert <span class="highlight">
    appendTextToDiv(divIdx, offset, endOffset, "highlight");
  }
}, [searchText, matchLocations, currentPage]);
```

**Problems:**
- Direct DOM manipulation is fragile
- Complex span splitting logic (200+ lines)
- Text layer must be mutated, then restored
- Debug code shows DOM vs extracted text mismatches
- Doesn't work reliably across all PDFs

---

## Target Architecture (pdf-helper Approach)

### Simplified Text Extraction

**No normalization - store original text:**
```typescript
// Simple text extraction like pdf-helper
const extractAllText = async () => {
  const texts = new Map<number, string>();
  const textItems = new Map<number, TextItemData[]>();
  
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1.0 });
    
    let fullText = '';
    const items: TextItemData[] = [];
    
    textContent.items.forEach(item => {
      const itemLength = item.str.length;
      const startIndex = fullText.length;
      
      items.push({
        text: item.str,
        startIndex,
        endIndex: startIndex + itemLength,
        transform: item.transform,
        width: item.width,
        height: item.height,
      });
      
      fullText += item.str + ' '; // Space separator
    });
    
    texts.set(i, fullText);
    textItems.set(i, items);
  }
  
  setPageTexts(texts);
  setPageTextItems(textItems);
};
```

**Benefits:**
- No normalization complexity
- Store original text and metadata
- Simple concatenation with spaces
- Text items include transform for positioning

### Simplified Search

**Direct regex search:**
```typescript
const performSearch = useCallback((query: string) => {
  if (!query.trim()) {
    setMatchLocations([]);
    setCurrentMatch(0);
    return;
  }
  
  const regex = new RegExp(query, 'gi');
  const matches: MatchData[] = [];
  
  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const fullText = pageTexts.get(pageNum);
    const items = pageTextItems.get(pageNum);
    if (!fullText || !items) continue;
    
    let match;
    while ((match = regex.exec(fullText)) !== null) {
      const matchPosition = match.index;
      const matchText = match[0];
      
      // Find which text item contains this match
      const containingItem = items.find(item =>
        matchPosition >= item.startIndex &&
        matchPosition < item.endIndex
      );
      
      if (containingItem) {
        matches.push({
          page: pageNum,
          index: matchPosition,
          length: matchText.length,
          item: containingItem, // Store for positioning
        });
      }
    }
  }
  
  setMatchLocations(matches);
  if (matches.length > 0) {
    setCurrentMatch(1);
    setCurrentPage(matches[0].page);
  } else {
    setCurrentMatch(0);
  }
}, [pageTexts, pageTextItems, numPages]);
```

**Benefits:**
- Simple regex search on original text
- No position mapping needed
- Find containing text item for each match
- Store item reference for highlight positioning

### Div Overlay Highlighting

**Position highlights using PDF.js coordinates:**
```typescript
useEffect(() => {
  // Clear existing highlights
  const highlightContainers = document.querySelectorAll('.pdf-highlight-container');
  highlightContainers.forEach(container => {
    container.innerHTML = '';
  });
  
  if (!searchText.trim() || matchLocations.length === 0) return;
  
  // Get viewport for current page
  const pageContainer = document.querySelector(`[data-page-number="${currentPage}"]`);
  if (!pageContainer) return;
  
  const pageCanvas = pageContainer.querySelector('canvas');
  if (!pageCanvas) return;
  
  // Calculate scale factor
  const canvasRect = pageCanvas.getBoundingClientRect();
  const scale = canvasRect.width / pageCanvas.width;
  
  // Get page viewport (from stored metadata or re-fetch)
  const viewport = pageViewports.get(currentPage);
  if (!viewport) return;
  
  // Render highlights for matches on current page
  const pageMatches = matchLocations.filter(match => match.page === currentPage);
  
  pageMatches.forEach((match, idx) => {
    const item = match.item;
    const isCurrentMatch = currentMatch > 0 && matchLocations[currentMatch - 1] === match;
    
    // Create highlight div
    const highlight = document.createElement('div');
    highlight.className = isCurrentMatch ? 'search-highlight current' : 'search-highlight';
    
    // Calculate position using PDF.js transform
    // item.transform = [scaleX, skewY, skewX, scaleY, x, y]
    const x = item.transform[4];
    const y = viewport.height - item.transform[5]; // Flip Y coordinate
    
    // Apply styles
    Object.assign(highlight.style, {
      position: 'absolute',
      left: `${x * scale}px`,
      top: `${y * scale}px`,
      width: `${item.width * scale}px`,
      height: `${item.height * scale}px`,
      backgroundColor: isCurrentMatch 
        ? 'rgba(255, 152, 0, 0.4)' // Orange for current
        : 'rgba(255, 255, 0, 0.4)', // Yellow for others
      pointerEvents: 'none',
      zIndex: 10,
    });
    
    // Add to container
    const highlightContainer = pageContainer.querySelector('.pdf-highlight-container');
    if (highlightContainer) {
      highlightContainer.appendChild(highlight);
    }
  });
  
}, [searchText, matchLocations, currentPage, currentMatch, pageViewports]);
```

**Benefits:**
- No DOM mutation of text layer
- PDF.js coordinates are accurate
- Simple absolute positioning
- Easy to add/remove highlights
- Visual appearance independent of text rendering

---

## Migration Steps

### Phase 1: Preparation (30 minutes)

**Create backup and branch:**
```bash
git checkout -b simplify-pdf-search
git commit -am "Checkpoint before simplifying PDF search"
```

**Document current test coverage:**
```bash
cd frontend
npm run test -- PDFViewer.test.tsx --coverage
```

**Review failing tests from complex approach:**
- Check if any tests are skipped or commented out
- Document edge cases that were problematic

### Phase 2: Simplify Text Extraction (1 hour)

**Remove normalization logic:**
1. Delete `normalize()` function (lines 165-245)
2. Delete `getOriginalIndex()` function (lines 150-163)
3. Remove state: `normalizedPageTexts`, `pageDiffs`
4. Add state: `pageTextItems` to store text item metadata

**Update text extraction:**
```typescript
// New interface
interface TextItemData {
  text: string;
  startIndex: number;
  endIndex: number;
  transform: number[];
  width: number;
  height: number;
}

const [pageTextItems, setPageTextItems] = useState<Map<number, TextItemData[]>>(new Map());

// Simplified extraction in handleDocumentLoadSuccess
const strBuf: string[] = [];
const items: TextItemData[] = [];

for (const textItem of textContent.items) {
  const itemLength = textItem.str.length;
  const startIndex = strBuf.join('').length;
  
  items.push({
    text: textItem.str,
    startIndex,
    endIndex: startIndex + itemLength,
    transform: textItem.transform,
    width: textItem.width,
    height: textItem.height,
  });
  
  strBuf.push(textItem.str);
  strBuf.push(' '); // Add space separator
}

const pageText = strBuf.join('');
texts.set(i, pageText);
textItemsMap.set(i, items);
```

**Test:** Verify text extraction still works, search returns correct text.

### Phase 3: Simplify Search Logic (45 minutes)

**Update `performSearch()`:**
1. Remove normalized query logic
2. Remove position mapping with `getOriginalIndex()`
3. Use simple regex on original text
4. Store text item reference with each match

**New search implementation:**
```typescript
const performSearch = useCallback((query: string) => {
  if (!query.trim() || pageTexts.size === 0) {
    setMatchLocations([]);
    setCurrentMatch(0);
    return;
  }
  
  const regex = new RegExp(escapeRegex(query), 'gi');
  const matches: Array<{
    page: number;
    index: number;
    length: number;
    item: TextItemData;
  }> = [];
  
  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const fullText = pageTexts.get(pageNum);
    const items = pageTextItems.get(pageNum);
    if (!fullText || !items) continue;
    
    let match;
    while ((match = regex.exec(fullText)) !== null) {
      const matchPosition = match.index;
      const matchText = match[0];
      
      const containingItem = items.find(item =>
        matchPosition >= item.startIndex &&
        matchPosition < item.endIndex
      );
      
      if (containingItem) {
        matches.push({
          page: pageNum,
          index: matchPosition,
          length: matchText.length,
          item: containingItem,
        });
      }
    }
  }
  
  setMatchLocations(matches);
  if (matches.length > 0) {
    setCurrentMatch(1);
    setCurrentPage(matches[0].page);
  } else {
    setCurrentMatch(0);
  }
}, [pageTexts, pageTextItems, numPages]);

// Helper to escape regex special characters
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
```

**Test:** Verify search finds correct matches, counts are accurate.

### Phase 4: Replace Highlighting (2-3 hours)

**Remove text layer manipulation:**
1. Delete entire highlight effect (lines 450-750)
2. Remove `originalTextContentRef`
3. Remove Firefox `_convertMatches` logic

**Add viewport storage:**
```typescript
const [pageViewports, setPageViewports] = useState<Map<number, PageViewport>>(new Map());

// Store viewport when extracting text
for (let i = 1; i <= pdf.numPages; i++) {
  const page = await pdf.getPage(i);
  const viewport = page.getViewport({ scale: 1.0 });
  viewports.set(i, viewport);
  // ... rest of text extraction
}
```

**Add highlight container to JSX:**
```tsx
{Array.from(new Array(numPages), (_, index) => (
  <div
    key={`page_${index + 1}`}
    data-page-number={index + 1}
    className="relative"
  >
    <Page
      pageNumber={index + 1}
      scale={scale}
      renderTextLayer={true}
      renderAnnotationLayer={false}
    />
    {/* Highlight overlay container */}
    <div className="pdf-highlight-container absolute inset-0 pointer-events-none" />
  </div>
))}
```

**Implement div overlay highlighting:**
```typescript
useEffect(() => {
  // Clear all highlights first
  const containers = document.querySelectorAll('.pdf-highlight-container');
  containers.forEach(container => {
    container.innerHTML = '';
  });
  
  if (!searchText.trim() || matchLocations.length === 0) return;
  
  // Render highlights for current page
  const pageContainer = document.querySelector(`[data-page-number="${currentPage}"]`);
  if (!pageContainer) return;
  
  const canvas = pageContainer.querySelector('canvas');
  if (!canvas) return;
  
  const viewport = pageViewports.get(currentPage);
  if (!viewport) return;
  
  // Calculate scale
  const canvasRect = canvas.getBoundingClientRect();
  const scaleX = canvasRect.width / canvas.width;
  
  // Render highlights
  const pageMatches = matchLocations.filter(m => m.page === currentPage);
  const highlightContainer = pageContainer.querySelector('.pdf-highlight-container');
  if (!highlightContainer) return;
  
  pageMatches.forEach(match => {
    const item = match.item;
    const isCurrentMatch = currentMatch > 0 && 
      matchLocations[currentMatch - 1] === match;
    
    const highlight = document.createElement('div');
    highlight.style.position = 'absolute';
    highlight.style.left = `${item.transform[4] * scaleX}px`;
    highlight.style.top = `${(viewport.height - item.transform[5]) * scaleX}px`;
    highlight.style.width = `${item.width * scaleX}px`;
    highlight.style.height = `${item.height * scaleX}px`;
    highlight.style.backgroundColor = isCurrentMatch 
      ? 'rgba(255, 152, 0, 0.4)' 
      : 'rgba(255, 255, 0, 0.4)';
    highlight.style.pointerEvents = 'none';
    highlight.style.zIndex = '10';
    
    highlightContainer.appendChild(highlight);
  });
}, [searchText, matchLocations, currentPage, currentMatch, pageViewports]);
```

**Test:** 
- Verify highlights appear in correct positions
- Test with PDFs that had alignment issues before
- Verify zoom changes highlight positions correctly

### Phase 5: State Cleanup (30 minutes)

**Remove unused state:**
```typescript
// DELETE these
const [normalizedPageTexts, setNormalizedPageTexts] = useState<Map<number, string>>(new Map());
const [pageDiffs, setPageDiffs] = useState<Map<number, number[]>>(new Map());
const originalTextContentRef = useRef<Map<number, string[]>>(new Map());

// KEEP these (updated)
const [pageTexts, setPageTexts] = useState<Map<number, string>>(new Map());
const [pageTextItems, setPageTextItems] = useState<Map<number, TextItemData[]>>(new Map());
const [pageViewports, setPageViewports] = useState<Map<number, PageViewport>>(new Map());
const [matchLocations, setMatchLocations] = useState<Array<{
  page: number;
  index: number;
  length: number;
  item: TextItemData;
}>>([]);
```

**Update interfaces:**
```typescript
interface TextItemData {
  text: string;
  startIndex: number;
  endIndex: number;
  transform: number[];
  width: number;
  height: number;
}

interface MatchLocation {
  page: number;
  index: number;
  length: number;
  item: TextItemData;
}
```

### Phase 6: Update Tests (1-2 hours)

**Remove tests for deleted functionality:**
- Delete tests for `normalize()`
- Delete tests for `getOriginalIndex()`
- Delete tests for text layer manipulation

**Add tests for new functionality:**
```typescript
describe('Simplified Text Extraction', () => {
  it('extracts text with spaces between items', async () => {
    // Test that text is concatenated with spaces
  });
  
  it('stores text item metadata', async () => {
    // Test that transform, width, height are stored
  });
});

describe('Simplified Search', () => {
  it('finds matches using regex', async () => {
    // Test regex search on original text
  });
  
  it('finds containing text item for each match', async () => {
    // Test that match.item is correct
  });
});

describe('Div Overlay Highlighting', () => {
  it('renders highlight divs with correct positions', async () => {
    // Test that divs are created with transform coordinates
  });
  
  it('highlights current match differently', async () => {
    // Test orange vs yellow highlighting
  });
  
  it('clears highlights when search changes', async () => {
    // Test cleanup
  });
});
```

**Run full test suite:**
```bash
npm run test -- PDFViewer.test.tsx
```

### Phase 7: Integration Testing (1 hour)

**Test with real PDFs:**
1. Text-based PDFs (should work well)
2. PDFs with complex layouts (tables, columns)
3. PDFs that had alignment issues before
4. Large PDFs (performance test)

**Test all interactions:**
- Search finds all matches
- Next/previous navigation works
- Current match highlighted differently
- Zoom changes update highlight positions
- Page changes clear/re-render highlights correctly

### Phase 8: Cleanup and Polish (30 minutes)

**Remove debug code:**
- Remove all `console.log` statements
- Remove commented-out code

**Add documentation:**
```typescript
/**
 * Extracts text from all pages of the PDF.
 * Stores original text and text item metadata (position, size) for highlighting.
 */
const extractAllText = async () => { ... }

/**
 * Searches for query across all pages using regex.
 * Finds the text item containing each match for positioning highlights.
 */
const performSearch = useCallback((query: string) => { ... }, []);

/**
 * Renders highlight divs over the PDF canvas using PDF.js transform coordinates.
 * Current match is highlighted in orange, others in yellow.
 */
useEffect(() => { ... }, [searchText, matchLocations, currentPage]);
```

**Run final checks:**
```bash
npm run lint
npm run type-check
npm run test
npm run build
```

---

## Code Comparison

### Before: Text Layer Manipulation (Complex)

**Lines of code:** ~600 lines
- Text extraction: 80 lines (normalize function)
- Search: 60 lines (position mapping)
- Highlighting: 300 lines (DOM manipulation)
- Support code: 160 lines (refs, state, helpers)

**Complexity:**
- Normalization with diff tracking
- Position mapping between normalized and original
- Firefox _convertMatches algorithm
- Direct DOM mutation of text layer spans
- Text content restoration

**Pros:**
- Follows Firefox reference implementation
- Highlights integrated with text layer

**Cons:**
- Complex and hard to understand
- Text alignment issues in some PDFs
- DOM vs extracted text mismatches
- Brittle span manipulation

### After: Div Overlay (Simple)

**Lines of code:** ~250 lines
- Text extraction: 30 lines (simple concatenation)
- Search: 40 lines (regex search)
- Highlighting: 60 lines (div creation)
- Support code: 120 lines (state, effects)

**Complexity:**
- Simple text concatenation with spaces
- Direct regex search on original text
- PDF.js transform for positioning
- Overlay divs, no DOM mutation

**Pros:**
- Much simpler to understand
- PDF.js coordinates are accurate
- No text layer mutation
- Easier to debug and maintain
- Better separation of concerns

**Cons:**
- Highlights are separate from text layer
- Must handle zoom/scale changes
- Extra div layer overhead (minimal)

---

## Testing Strategy

### Unit Tests

**Text Extraction:**
- ✅ Extracts text from all pages
- ✅ Concatenates with spaces
- ✅ Stores text item metadata
- ✅ Handles empty pages
- ✅ Handles pages with no text

**Search:**
- ✅ Finds exact matches (case-insensitive)
- ✅ Finds multiple matches on same page
- ✅ Finds matches across multiple pages
- ✅ Handles special regex characters
- ✅ Updates match count correctly
- ✅ Navigates to first match
- ✅ Clears matches when query is empty

**Highlighting:**
- ✅ Renders divs for matches on current page
- ✅ Current match has different style (orange vs yellow)
- ✅ Highlights update when page changes
- ✅ Highlights clear when search clears
- ✅ Highlight positions update with zoom

### Integration Tests

**Real PDF Testing:**
- Test with sample text PDFs
- Test with complex layout PDFs (tables, columns)
- Test with PDFs that had issues before
- Test with large PDFs (100+ pages)

**User Workflows:**
- Search → navigate → zoom → verify highlights stay aligned
- Search → change page → verify correct highlights
- Search → clear → verify highlights removed
- Search → new search → verify highlights update

### Edge Cases

- Scanned PDFs (no text layer) - search disabled, message shown
- Encrypted PDFs - error handling
- Very long search queries
- Special characters in search
- Matches that span multiple text items (may not highlight perfectly)

---

## Rollback Plan

If the simplified approach doesn't work:

1. **Revert commit:**
   ```bash
   git checkout React-pdf
   git branch -D simplify-pdf-search
   ```

2. **Polish complex approach instead:**
   - Remove debug console.log
   - Add more comments
   - Document known limitations
   - Ship what we have

3. **Hybrid option:**
   - Keep text extraction simple
   - Keep search simple
   - Only use div overlays for highlighting
   - Still 50% simpler

---

## Success Criteria

**Functionality:**
- ✅ Search finds all matches accurately
- ✅ Highlights appear in correct positions (no alignment issues)
- ✅ Navigation between matches works correctly
- ✅ Current match is visually distinct
- ✅ Zoom changes maintain highlight accuracy
- ✅ All 36 existing tests pass (after updates)

**Code Quality:**
- ✅ Reduced from ~600 to ~250 lines of search code
- ✅ No debug console.log statements
- ✅ Well-documented functions
- ✅ Passes linter and type checks
- ✅ Test coverage maintained or improved

**Performance:**
- ✅ Text extraction completes in <5s for large PDFs
- ✅ Search executes in <500ms
- ✅ Highlighting renders in <100ms
- ✅ No UI blocking

**User Experience:**
- ✅ No visible regressions from current implementation
- ✅ Highlights more accurate than before
- ✅ Better with PDFs that had alignment issues

---

## Timeline Estimate

| Phase | Description | Duration |
|-------|-------------|----------|
| 1 | Preparation | 30 min |
| 2 | Simplify text extraction | 1 hour |
| 3 | Simplify search | 45 min |
| 4 | Replace highlighting | 2-3 hours |
| 5 | State cleanup | 30 min |
| 6 | Update tests | 1-2 hours |
| 7 | Integration testing | 1 hour |
| 8 | Cleanup and polish | 30 min |
| **Total** | | **7-9 hours** |

**Recommended schedule:**
- Day 1 (4 hours): Phases 1-3 (text extraction and search)
- Day 2 (4 hours): Phase 4 (highlighting implementation)
- Day 3 (2-3 hours): Phases 5-8 (testing and polish)

---

## Next Steps

1. **Review this plan with the team**
2. **Create branch: `simplify-pdf-search`**
3. **Start with Phase 1 (Preparation)**
4. **Work through phases sequentially**
5. **Test thoroughly after each phase**
6. **Document any deviations or issues**
7. **Update this document with learnings**

---

## References

- **pdf-helper source:** https://github.com/MilossGIT/PDF-Helper/blob/main/src/components/PDFViewer/index.jsx
- **PDF.js API:** https://mozilla.github.io/pdf.js/api/
- **react-pdf docs:** https://github.com/wojtekmaj/react-pdf
- **Current implementation:** `/workspace/frontend/src/components/Viewer/PDFViewer.tsx`
- **Analysis document:** `/workspace/documentation_developers/PDF_LIBRARY_ANALYSIS.md`
