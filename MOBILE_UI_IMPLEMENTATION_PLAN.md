# Mobile UI Implementation Plan

**Status:** In Progress  
**Branch:** Mobile-UI-2  
**Target:** Professional mobile-first file browsing experience

---

## Overview

Transform Sambee into a professional mobile file browser following best practices from established apps (Google Drive, Dropbox, iOS Files). Key principle: **Maximize screen space for the actual file list**.

---

## Current State Analysis

### ✅ Completed (as of Nov 13, 2025)

1. **Image Preview Mobile Fix**
   - Fixed arrow key scrolling issue in ImagePreview component
   - Arrow keys no longer scroll the page behind the modal

2. **Collapsible Breadcrumbs**
   - Mobile: Shows `Root / ... / current` format
   - Desktop: Shows full path
   - Overflow menu for hidden path segments
   - Saves 40-80px vertical space on mobile

3. **Optimized Top Bar (AppBar)**
   - Hidden "Sambee" text on mobile (icon only)
   - Responsive connection dropdown (180px min on mobile, flex: 1)
   - Hidden keyboard shortcuts button on mobile
   - Removed logout button on mobile
   - Reduced margins and padding

4. **Smart Sort Controls**
   - Desktop: Full toggle button group (unchanged)
   - Mobile: Compact menu with 6 options (Name A-Z/Z-A, Size, Modified)
   - Added sort direction support (asc/desc)
   - Saves ~60% horizontal space

5. **Responsive Header Layout**
   - Stacks vertically on mobile (breadcrumbs over controls)
   - No overlap between elements
   - Maintains horizontal layout on desktop

### 📊 Space Savings Achieved

**Before:** ~264-312px header (40-47% of iPhone SE screen)  
**After:** ~150-200px header (22-30% of screen)  
**Gain:** ~65% more space for file list

---

## Implementation Roadmap

### Phase 1: Top Bar Restructure 🔄 IN PROGRESS

**Goal:** Implement hamburger menu and clean top bar structure

#### Tasks

- [ ] **1.1: Create Hamburger Menu Component**
  ```tsx
  // frontend/src/components/Mobile/HamburgerMenu.tsx
  - Drawer component (Material-UI)
  - Slides in from left
  - Contains: Logo, Root link, Settings, Logout
  - Only visible on mobile
  ```
  - **Files to modify:**
    - Create: `frontend/src/components/Mobile/HamburgerMenu.tsx`
    - Modify: `frontend/src/pages/Browser.tsx`
  - **Acceptance criteria:**
    - Menu icon appears on mobile (< 600px)
    - Drawer slides smoothly from left
    - All menu items functional
    - Desktop: No hamburger menu (current behavior)

- [ ] **1.2: Simplify Top Bar Layout**
  ```
  Mobile Top Bar Structure:
  [☰] [Current Directory Name] [↑]
  
  - ☰ = Hamburger menu
  - Current Directory Name = Breadcrumb last segment or "Root"
  - ↑ = Navigate up one level
  ```
  - **Files to modify:**
    - `frontend/src/pages/Browser.tsx` (AppBar section)
  - **Changes:**
    - Hide connection selector in top bar (move to hamburger menu)
    - Show only current directory name
    - Add "up" navigation button
    - Remove settings icon from top bar
  - **Acceptance criteria:**
    - Top bar height: 56px fixed
    - Current directory name truncates with ellipsis
    - Up button navigates to parent directory
    - Up button disabled at root

- [ ] **1.3: Move Connection Selector to Menu**
  - **Files to modify:**
    - `frontend/src/components/Mobile/HamburgerMenu.tsx`
  - **Implementation:**
    - Connection selector appears at top of hamburger menu
    - Full width within drawer
    - Shows connection name + host/share
  - **Acceptance criteria:**
    - Switching connections works from menu
    - Menu closes after selection
    - Current connection highlighted

#### Estimated Effort: 4-6 hours

---

### Phase 2: Search Bar Optimization

**Goal:** Mobile-optimized search experience

#### Tasks

- [ ] **2.1: Sticky Search Bar**
  - **Files to modify:**
    - `frontend/src/pages/Browser.tsx`
  - **Implementation:**
    ```tsx
    <Box sx={{ 
      position: 'sticky', 
      top: 0, 
      zIndex: 10,
      backgroundColor: 'background.default'
    }}>
      <TextField ... />
    </Box>
    ```
  - **Acceptance criteria:**
    - Search bar stays visible when scrolling file list
    - Smooth scroll behavior
    - No layout shifts

- [ ] **2.2: Mobile-Friendly Placeholder**
  - **Files to modify:**
    - `frontend/src/pages/Browser.tsx`
  - **Changes:**
    - Desktop: "Search files and folders... (press / to focus)"
    - Mobile: "Search..."
  - **Implementation:**
    ```tsx
    placeholder={isMobile ? "Search..." : "Search files and folders... (press / to focus)"}
    ```
  - **Acceptance criteria:**
    - Conditional placeholder based on screen size
    - No keyboard hint on mobile

- [ ] **2.3: Search Bar Size Optimization**
  - **Changes:**
    - Reduce padding on mobile
    - Smaller input height (44px touch target minimum)
    - Compact clear button
  - **Acceptance criteria:**
    - Touch-friendly (min 44x44px tap target)
    - Visually balanced on small screens

#### Estimated Effort: 2-3 hours

---

### Phase 3: File List Header

**Goal:** Clean, mobile-optimized list header with sorting

#### Tasks

- [ ] **3.1: Consolidate List Header**
  - **Current state:** Breadcrumbs + controls in Paper, separate from list
  - **Target state:** Sorting controls at top of file list Paper
  - **Files to modify:**
    - `frontend/src/pages/Browser.tsx`
  - **Layout:**
    ```
    ┌─────────────────────────────────┐
    │ Search...                   [×] │ ← Sticky search
    ├─────────────────────────────────┤
    │ [🔄] [Sort] [124 items]         │ ← List header (inside Paper)
    ├─────────────────────────────────┤
    │ 📁 Documents                    │
    │ 📁 Photos                       │
    │ 📄 report.pdf                   │
    └─────────────────────────────────┘
    ```
  - **Acceptance criteria:**
    - Header inside file list Paper component
    - Compact layout on mobile
    - Desktop: Can maintain current spacing

- [ ] **3.2: Compact Item Counter**
  - **Changes:**
    - Mobile: Show only count "124" without "items" label
    - Desktop: Keep full label "124/150 items"
  - **Implementation:**
    ```tsx
    label={isMobile 
      ? `${sortedAndFilteredFiles.length}`
      : `${sortedAndFilteredFiles.length}/${files.length} item${files.length !== 1 ? 's' : ''}`
    }
    ```
  - **Acceptance criteria:**
    - Saves ~40px horizontal space on mobile
    - Tooltip shows full info on hover

#### Estimated Effort: 2-3 hours

---

### Phase 4: Pull-to-Refresh Gesture

**Goal:** Native mobile reload experience

#### Tasks

- [ ] **4.1: Install Dependencies**
  ```bash
  npm install react-use-gesture
  ```

- [ ] **4.2: Implement Pull-to-Refresh**
  - **Files to modify:**
    - `frontend/src/pages/Browser.tsx`
  - **Implementation:**
    ```tsx
    import { useGesture } from 'react-use-gesture'
    
    const bind = useGesture({
      onDrag: ({ movement: [, my], velocity, direction: [, yDir] }) => {
        if (my > 80 && yDir > 0 && velocity > 0.2) {
          loadFiles(currentPath, true); // Refresh
        }
      }
    })
    ```
  - **Visual feedback:**
    - Show loading spinner when pulling
    - Threshold: 80px pull distance
    - Haptic feedback (if available)
  - **Acceptance criteria:**
    - Works only on mobile
    - Smooth animation
    - Prevents pull-to-refresh on desktop
    - Only triggers at top of scroll (scrollTop === 0)

- [ ] **4.3: Add Pull Indicator**
  - **Create component:**
    - `frontend/src/components/Mobile/PullToRefresh.tsx`
  - **Features:**
    - Animated refresh icon
    - "Pull to refresh" / "Release to refresh" text
    - Smooth spring animation
  - **Acceptance criteria:**
    - Indicator appears during pull
    - Icon rotates/animates
    - Disappears after refresh

#### Estimated Effort: 4-5 hours

---

### Phase 5: Final Polish & Testing

**Goal:** Professional, production-ready mobile experience

#### Tasks

- [ ] **5.1: Visual Consistency**
  - Ensure consistent spacing (8px grid system)
  - Touch targets minimum 44x44px
  - Proper focus states for accessibility
  - Test on multiple screen sizes:
    - iPhone SE (375x667) - smallest
    - iPhone 14 (390x844) - standard
    - Pixel 5 (393x851) - Android reference
    - iPad Mini (768x1024) - small tablet

- [ ] **5.2: Performance Testing**
  - Measure scroll performance (60fps target)
  - Test with 1000+ file lists
  - Virtual scrolling smooth on mobile
  - Lazy load images/previews
  - Bundle size impact (< 5KB increase)

- [ ] **5.3: Interaction Testing**
  - All touch gestures work correctly
  - No accidental taps (proper spacing)
  - Swipe gestures don't conflict
  - Keyboard appears/dismisses smoothly
  - Form inputs don't zoom on focus (font-size >= 16px)

- [ ] **5.4: Cross-browser Testing**
  - Mobile Safari (iOS)
  - Chrome Mobile (Android)
  - Firefox Mobile
  - Samsung Internet
  - Test safe area insets (notch support)

- [ ] **5.5: Accessibility Audit**
  - Screen reader navigation works
  - Proper ARIA labels
  - Color contrast meets WCAG AA
  - Keyboard-only navigation possible
  - Focus trap in modals

- [ ] **5.6: Update Tests**
  - Add mobile-specific tests
  - Test hamburger menu interactions
  - Test pull-to-refresh
  - Update existing tests for new layout
  - Ensure 132+ tests still pass

#### Estimated Effort: 6-8 hours

---

## Technical Specifications

### Component Structure

```
frontend/src/
├── components/
│   └── Mobile/
│       ├── HamburgerMenu.tsx          (NEW)
│       ├── PullToRefresh.tsx          (NEW)
│       └── MobileHeader.tsx           (NEW - extracted from Browser)
├── pages/
│   └── Browser.tsx                    (MODIFY - major refactor)
```

### State Management

**New state needed:**
```tsx
const [drawerOpen, setDrawerOpen] = useState(false);
const [isPulling, setIsPulling] = useState(false);
const [pullDistance, setPullDistance] = useState(0);
```

### Breakpoints

Following Material-UI standard:
- `xs`: 0-599px (mobile)
- `sm`: 600-959px (tablet)
- `md`: 960px+ (desktop)

Mobile-first: Default to mobile layout, enhance for larger screens.

### Hamburger Menu Contents

```
┌─────────────────────────────────────┐
│ [Sambee Logo]                       │
│                                     │
│ Connection: [Dropdown selector]    │
│                                     │
├─────────────────────────────────────┤
│ 🏠 Root                             │
│ ⚙️  Settings                        │
│ 🚪 Logout                           │
└─────────────────────────────────────┘
```

---

## Files to Modify

### Priority 1 (Core Changes)

1. **`frontend/src/pages/Browser.tsx`**
   - Major refactoring required
   - Extract mobile header logic
   - Implement conditional layouts
   - Add gesture handling
   - **Lines affected:** ~200+ changes

2. **`frontend/src/components/Mobile/HamburgerMenu.tsx`** (NEW)
   - ~150 lines
   - Drawer component
   - Menu items
   - Connection selector integration

3. **`frontend/src/components/Mobile/PullToRefresh.tsx`** (NEW)
   - ~100 lines
   - Gesture detection
   - Visual indicator
   - Animation logic

### Priority 2 (Supporting Changes)

4. **`frontend/src/pages/Browser.tsx`** (Search section)
   - Make search sticky
   - Update placeholder logic
   - ~20 lines

5. **`frontend/src/components/Mobile/MobileHeader.tsx`** (NEW)
   - Extract mobile-specific header
   - ~80 lines
   - Cleaner separation of concerns

### Testing

6. **`frontend/src/pages/__tests__/Browser-mobile.test.tsx`** (NEW)
   - Mobile-specific interaction tests
   - Hamburger menu tests
   - Pull-to-refresh tests
   - ~200 lines

7. **Update existing tests:**
   - `Browser-interactions.test.tsx`
   - `Browser-navigation.test.tsx`
   - `Browser-rendering.test.tsx`

---

## Design Decisions & Rationale

### Why Hamburger Menu?

- **Industry Standard:** Used by Google Drive, Dropbox, iOS Files
- **Space Efficiency:** Maximizes file list viewport
- **Progressive Disclosure:** Settings/actions hidden until needed
- **Touch-Friendly:** Large tap target, edge swipe gesture

### Why Sticky Search?

- **Accessibility:** Always available without scrolling
- **Common Pattern:** Gmail, Google Drive, file managers
- **Performance:** Search is frequent action on mobile

### Why Pull-to-Refresh?

- **Native Feel:** Expected mobile behavior
- **No UI Clutter:** No refresh button needed
- **Muscle Memory:** Users do this automatically
- **Satisfying:** Tactile feedback

### Why Vertical Stacking? (Already Implemented)

- **Prevents Overlap:** Guaranteed no collision on small screens
- **Predictable Layout:** Users know where to find things
- **Flexible:** Adapts to any screen width

---

## Success Metrics

### Performance
- [ ] First Contentful Paint < 1.5s on 3G
- [ ] Time to Interactive < 3s on 3G
- [ ] 60fps scroll performance on file lists
- [ ] Bundle size increase < 5KB (gzipped)

### Usability
- [ ] Max 2 taps to access any feature
- [ ] All touch targets ≥ 44x44px
- [ ] No horizontal scrolling required
- [ ] Safe area respected (notch, home indicator)

### Functionality
- [ ] All desktop features accessible on mobile
- [ ] No regressions in existing tests
- [ ] Works offline (PWA consideration for future)

### Accessibility
- [ ] WCAG AA compliance
- [ ] Screen reader compatible
- [ ] Keyboard navigation preserved
- [ ] Color contrast ratio > 4.5:1

---

## Risk Assessment

### High Risk
- **Layout Regressions:** Extensive Browser.tsx changes
  - *Mitigation:* Comprehensive tests, gradual rollout
  
- **Performance Impact:** Additional components/state
  - *Mitigation:* Code splitting, lazy loading, profiling

### Medium Risk
- **Touch Gesture Conflicts:** Pull-to-refresh vs scroll
  - *Mitigation:* Proper gesture detection, thresholds
  
- **Cross-browser Compatibility:** Safari quirks
  - *Mitigation:* Early testing on real devices

### Low Risk
- **User Confusion:** New menu structure
  - *Mitigation:* Follows industry standards, intuitive icons

---

## Testing Strategy

### Unit Tests
- Hamburger menu component
- Pull-to-refresh logic
- Mobile header rendering
- Conditional layout switches

### Integration Tests
- Menu → connection change → file load
- Pull gesture → refresh → updated list
- Search → filter → results
- Navigation up → parent directory

### E2E Tests
- Full mobile user journey
- Connection selection through menu
- File browsing with touch
- Preview opening/closing

### Manual Testing Checklist
- [ ] iPhone SE (smallest screen)
- [ ] iPhone 14 Pro (notch)
- [ ] iPad (tablet breakpoint)
- [ ] Pixel 5 (Android reference)
- [ ] Galaxy Fold (ultra-narrow)
- [ ] Landscape orientation
- [ ] Dark mode
- [ ] VoiceOver/TalkBack

---

## Rollout Plan

### Stage 1: Feature Flag (Optional)
```tsx
const MOBILE_UI_V2_ENABLED = localStorage.getItem('mobile-ui-v2') === 'true';
```
- Enable for testing without affecting production
- Easy rollback if issues found

### Stage 2: Beta Testing
- Deploy to staging environment
- Internal team testing
- Gather feedback

### Stage 3: Gradual Rollout
- 10% of mobile users
- Monitor metrics (errors, performance)
- Increase to 50%, then 100%

### Stage 4: Cleanup
- Remove feature flag
- Remove old mobile code paths
- Update documentation

---

## Future Enhancements (Out of Scope)

These build on the mobile UI but are separate projects:

- [ ] **Swipe Actions:** Swipe left for preview/delete
- [ ] **Long Press Context Menu:** Hold file for options
- [ ] **Bottom Navigation:** Easier thumb reach for common actions
- [ ] **Floating Action Button:** Quick access (e.g., upload)
- [ ] **Grid View Toggle:** Switch between list/grid
- [ ] **Haptic Feedback:** Vibration on interactions
- [ ] **Offline Mode:** PWA with service worker
- [ ] **Voice Search:** Search via microphone

---

## Timeline Estimate

| Phase | Tasks | Hours | Calendar Days |
|-------|-------|-------|---------------|
| Phase 1: Top Bar Restructure | 3 tasks | 4-6h | 1-2 days |
| Phase 2: Search Bar | 3 tasks | 2-3h | 0.5-1 day |
| Phase 3: File List Header | 2 tasks | 2-3h | 0.5-1 day |
| Phase 4: Pull-to-Refresh | 3 tasks | 4-5h | 1-2 days |
| Phase 5: Polish & Testing | 6 tasks | 6-8h | 2-3 days |
| **Total** | **17 tasks** | **18-25h** | **5-9 days** |

*Assumes single developer, part-time work (~3h/day)*

---

## Dependencies

### Required NPM Packages
```json
{
  "react-use-gesture": "^9.1.3"  // Pull-to-refresh gestures
}
```

### No Breaking Changes
- All existing functionality preserved
- Desktop experience unchanged
- Backward compatible

---

## Documentation Updates Needed

- [ ] Update README.md with mobile features
- [ ] Add mobile screenshots
- [ ] Document hamburger menu contents
- [ ] Update keyboard shortcuts (mobile exclusions)
- [ ] Add mobile testing guide

---

## Review Checklist

Before marking this plan complete:

- [ ] All 17 tasks completed
- [ ] 132+ tests passing
- [ ] No lint errors
- [ ] Build successful
- [ ] Performance metrics met
- [ ] Accessibility audit passed
- [ ] Real device testing completed
- [ ] Documentation updated
- [ ] Code reviewed
- [ ] Production deployment successful

---

## Notes

- **Current branch:** Mobile-UI-2 (continue working here)
- **Related docs:** 
  - `MOBILE_UX_ANALYSIS.md` (comprehensive analysis)
  - `DEVELOPMENT_PLAN.md` (overall project plan)
- **Coordination:** Frontend changes only, no backend modifications needed
- **Design assets:** Using Material-UI components (consistent with existing UI)

---

**Last Updated:** November 13, 2025  
**Next Review:** After Phase 1 completion
