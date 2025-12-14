import type { PaletteMode } from "@mui/material";

//
// Theme types
//

/**
 * Theme configuration that can be persisted and switched
 */
export interface ThemeConfig {
  /** Unique identifier for the theme */
  id: string;
  /** Display name of the theme */
  name: string;
  /** Theme description */
  description?: string;
  /** Light or dark mode */
  mode: PaletteMode;
  /** Primary color palette */
  primary: {
    main: string;
    light?: string;
    dark?: string;
    contrastText?: string;
  };
  /** Secondary color palette */
  secondary: {
    main: string;
    light?: string;
    dark?: string;
    contrastText?: string;
  };
  /** Background colors */
  background?: {
    default?: string;
    paper?: string;
  };
  /** Text colors */
  text?: {
    primary?: string;
    secondary?: string;
  };
  /** Action/interaction colors */
  action?: {
    hover?: string;
    selected?: string;
  };
}

//
// Theme schema for UI builder
//

/**
 * Field type in theme schema
 */
export type ThemeFieldType = "text" | "color" | "select";

/**
 * Schema definition for a theme field
 */
export interface ThemeFieldSchema {
  /** Field label for UI */
  label: string;
  /** Description shown to users */
  description: string;
  /** Input type */
  type: ThemeFieldType;
  /** Whether field is required */
  required: boolean;
  /** Options for select fields */
  options?: readonly string[];
  /** Nested schema for object fields */
  fields?: Record<string, ThemeFieldSchema>;
}

/**
 * Complete theme schema with metadata for all fields
 * Used by theme builder UI to generate forms and validation
 */
export const THEME_SCHEMA: Record<string, ThemeFieldSchema> = {
  id: {
    label: "Theme ID",
    description: "Unique identifier for the theme (lowercase, no spaces)",
    type: "text",
    required: true,
  },
  name: {
    label: "Theme Name",
    description: "Display name shown in the theme selector",
    type: "text",
    required: true,
  },
  description: {
    label: "Description",
    description: "Brief description of the theme's style and purpose",
    type: "text",
    required: false,
  },
  mode: {
    label: "Theme Mode",
    description: "Controls whether the theme uses light backgrounds with dark text or vice versa",
    type: "select",
    required: true,
    options: ["light", "dark"] as const,
  },
  primary: {
    label: "Primary Color",
    description: "Used for main interactive elements like buttons, links, and the app bar",
    type: "color",
    required: true,
    fields: {
      main: {
        label: "Main",
        description: "The dominant brand color used throughout the app",
        type: "color",
        required: true,
      },
      light: {
        label: "Light Variant",
        description: "Used for hover states and subtle highlights",
        type: "color",
        required: false,
      },
      dark: {
        label: "Dark Variant",
        description: "Used for pressed states and emphasis",
        type: "color",
        required: false,
      },
      contrastText: {
        label: "Contrast Text",
        description: "Text color on primary backgrounds - ensures readability on primary colored elements",
        type: "color",
        required: false,
      },
    },
  },
  secondary: {
    label: "Secondary Color",
    description: "Used for accents, secondary buttons, and complementary elements",
    type: "color",
    required: true,
    fields: {
      main: {
        label: "Main",
        description: "Complements the primary color for variety",
        type: "color",
        required: true,
      },
      light: {
        label: "Light Variant",
        description: "Used for hover states on secondary elements",
        type: "color",
        required: false,
      },
      dark: {
        label: "Dark Variant",
        description: "Used for pressed states on secondary elements",
        type: "color",
        required: false,
      },
      contrastText: {
        label: "Contrast Text",
        description: "Text color on secondary backgrounds - ensures readability on secondary colored elements",
        type: "color",
        required: false,
      },
    },
  },
  background: {
    label: "Background Colors",
    description: "Controls the overall page and surface colors",
    type: "color",
    required: false,
    fields: {
      default: {
        label: "Default Background",
        description: "Main page background color",
        type: "color",
        required: false,
      },
      paper: {
        label: "Paper Background",
        description: "Color for elevated surfaces like cards and dialogs",
        type: "color",
        required: false,
      },
    },
  },
  text: {
    label: "Text Colors",
    description: "Controls the color of text throughout the application",
    type: "color",
    required: false,
    fields: {
      primary: {
        label: "Primary Text",
        description: "Main body text color for maximum readability",
        type: "color",
        required: false,
      },
      secondary: {
        label: "Secondary Text",
        description: "Muted text for less important information and labels",
        type: "color",
        required: false,
      },
    },
  },
  action: {
    label: "Action Colors",
    description: "Controls the colors for interactive states like hover and selection",
    type: "color",
    required: false,
    fields: {
      hover: {
        label: "Hover State",
        description: "Background color when hovering over interactive elements like file list items",
        type: "color",
        required: false,
      },
      selected: {
        label: "Selected State",
        description: "Background color for selected items in the file list",
        type: "color",
        required: false,
      },
    },
  },
};
