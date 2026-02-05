/**
 * Extend Material-UI theme types to include our custom component semantic tokens
 */

import "@mui/material/styles";

declare module "@mui/material/styles" {
  interface Palette {
    appBar?: {
      background: string;
      text: string;
      focus?: string;
    };
    statusBar?: {
      background: string;
      text: string;
      textSecondary: string;
    };
  }

  interface PaletteOptions {
    appBar?: {
      background: string;
      text: string;
      focus?: string;
    };
    statusBar?: {
      background: string;
      text: string;
      textSecondary: string;
    };
  }
}
