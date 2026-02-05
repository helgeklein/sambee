/**
 * Theme constants
 *
 * Centralized definitions for shared styling values used across the application.
 * Using constants prevents magic numbers and ensures consistency.
 */

//
// Focus indicators
//

/** Focus outline width in pixels for keyboard navigation */
export const FOCUS_OUTLINE_WIDTH_PX = 3;

/** Focus outline offset in pixels */
export const FOCUS_OUTLINE_OFFSET_PX = 0;

//
// Touch targets (WCAG 2.5.5)
//

/** Minimum touch target size for WCAG 2.5.5 compliance */
export const TOUCH_TARGET_MIN_SIZE_PX = 44;

//
// Z-Index scale
//

/** Hierarchical z-index values for layering UI elements */
export const Z_INDEX = {
  /** Sticky headers within scrollable content */
  STICKY_HEADER: 10,
  /** Overlays and dropdowns */
  OVERLAY: 100,
  /** MUI modal default */
  MODAL: 1300,
  /** Viewer toolbars (above everything) */
  VIEWER_TOOLBAR: 9999,
} as const;

//
// Toolbar dimensions
//

/** Toolbar heights matching MUI AppBar */
export const TOOLBAR_HEIGHT = {
  MOBILE_PX: 56,
  DESKTOP_PX: 64,
} as const;

//
// Page input field sizing
//

/** Dimensions for page number input fields in PDF/document viewers */
export const PAGE_INPUT = {
  WIDTH_MOBILE_PX: 40,
  WIDTH_DESKTOP_PX: 60,
  PADDING_MOBILE_PX: 4,
  PADDING_DESKTOP_PX: 6,
} as const;

//
// Scrollbar styling
//

export const SCROLLBAR = {
  WIDTH_PX: 12,
  THUMB_BORDER_RADIUS_PX: 8,
  THUMB_MIN_HEIGHT_PX: 24,
  THUMB_BORDER_PX: 3,
} as const;

//
// Responsive typography
//

/** Responsive font sizes for common use cases */
export const RESPONSIVE_FONT_SIZE = {
  /** Body text: smaller on mobile, larger on desktop */
  BODY: { xs: "0.875rem", sm: "1.25rem" },
  /** Input fields: 16px on iOS to prevent zoom on focus */
  INPUT_IOS_SAFE: { xs: "16px", sm: "14px" },
  /** Smaller captions */
  CAPTION: { xs: "0.7rem", sm: "0.875rem" },
} as const;

//
// Search highlight colors
//

/** Colors for search result highlighting */
export const SEARCH_HIGHLIGHT = {
  /** Orange highlight for current/active match */
  CURRENT_MATCH: "rgba(255, 152, 0, 0.4)",
  /** Yellow highlight for other matches */
  OTHER_MATCHES: "rgba(255, 255, 0, 0.4)",
} as const;
