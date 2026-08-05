/**
 * Shared TextField props for filename / path inputs.
 *
 * Disables browser helpers (spell-check, auto-correct, auto-capitalize,
 * auto-complete) that are unhelpful for file/path names, and prevents
 * ligatures that can make characters ambiguous in monospace contexts.
 */

import type { SxProps, Theme } from "@mui/material";

/** HTML input attributes appropriate for filename / path fields. */
export const FILENAME_INPUT_PROPS = {
  autoCorrect: "off",
  autoCapitalize: "off",
  spellCheck: false,
} as const;

/** Base TextField props shared by every inline-labelled filename / path input. */
export const FILENAME_FIELD_PROPS = {
  autoComplete: "off",
  fullWidth: true,
} as const;

/**
 * Sx mixin that disables font ligatures inside the input element.
 * Merge with any component-specific `sx` using spread or array syntax.
 */
export const FILENAME_INPUT_SX: SxProps<Theme> = {
  "& input": { fontVariantLigatures: "none" },
};
