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
  /** Component-specific semantic colors */
  components?: {
    /** App bar colors - adapts to theme mode */
    appBar?: {
      /** Background color for the app bar */
      background: string;
      /** Text color on the app bar */
      text: string;
    };
    /** Status bar colors - adapts to theme mode */
    statusBar?: {
      /** Background color for the status bar */
      background: string;
      /** Text color on the status bar (primary) */
      text: string;
      /** Muted text color on the status bar (secondary) */
      textSecondary: string;
    };
    /** Link colors */
    link?: {
      /** Default link color */
      main: string;
      /** Link hover color */
      hover?: string;
    };
    /** PDF viewer colors */
    pdfViewer?: {
      /** Background color for PDF viewer */
      viewerBackground: string;
      /** Background color for top toolbar */
      toolbarBackground: string;
      /** Text color in top toolbar */
      toolbarText: string;
    };
    /** Image viewer colors */
    imageViewer?: {
      /** Background color for image viewer */
      viewerBackground: string;
      /** Background color for top toolbar */
      toolbarBackground: string;
      /** Text color in top toolbar */
      toolbarText: string;
    };
    /** Markdown viewer colors */
    markdownViewer?: {
      /** Background color for markdown viewer */
      viewerBackground: string;
      /** Background color for top toolbar */
      toolbarBackground: string;
      /** Text color in top toolbar */
      toolbarText: string;
      /** Text color for markdown content */
      viewerText: string;
    };
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
  components: {
    label: "Component Colors",
    description: "Semantic colors for specific UI components that adapt to theme mode",
    type: "color",
    required: false,
    fields: {
      appBar: {
        label: "App Bar",
        description: "Colors for the top application bar",
        type: "color",
        required: false,
        fields: {
          background: {
            label: "Background",
            description: "App bar background color - typically primary color in light mode, paper in dark mode",
            type: "color",
            required: false,
          },
          text: {
            label: "Text",
            description: "Text color on app bar - must contrast with background",
            type: "color",
            required: false,
          },
        },
      },
      statusBar: {
        label: "Status Bar",
        description: "Colors for the bottom status bar",
        type: "color",
        required: false,
        fields: {
          background: {
            label: "Background",
            description: "Status bar background color - typically matches app bar styling",
            type: "color",
            required: false,
          },
          text: {
            label: "Text",
            description: "Primary text color on status bar",
            type: "color",
            required: false,
          },
          textSecondary: {
            label: "Secondary Text",
            description: "Muted text color on status bar for less important information",
            type: "color",
            required: false,
          },
        },
      },
      pdfViewer: {
        label: "PDF Viewer",
        description: "Colors for PDF viewer",
        type: "color",
        required: false,
        fields: {
          viewerBackground: {
            label: "Viewer Background",
            description: "Background color for PDF viewer",
            type: "color",
            required: false,
          },
          toolbarBackground: {
            label: "Top Bar Background",
            description: "Background color for top toolbar",
            type: "color",
            required: false,
          },
          toolbarText: {
            label: "Top Bar Text",
            description: "Text color in top toolbar",
            type: "color",
            required: false,
          },
        },
      },
      imageViewer: {
        label: "Image Viewer",
        description: "Colors for image viewer",
        type: "color",
        required: false,
        fields: {
          viewerBackground: {
            label: "Viewer Background",
            description: "Background color for image viewer",
            type: "color",
            required: false,
          },
          toolbarBackground: {
            label: "Top Bar Background",
            description: "Background color for top toolbar",
            type: "color",
            required: false,
          },
          toolbarText: {
            label: "Top Bar Text",
            description: "Text color in top toolbar",
            type: "color",
            required: false,
          },
        },
      },
      markdownViewer: {
        label: "Markdown Viewer",
        description: "Colors for markdown viewer",
        type: "color",
        required: false,
        fields: {
          viewerBackground: {
            label: "Viewer Background",
            description: "Background color for markdown viewer",
            type: "color",
            required: false,
          },
          toolbarBackground: {
            label: "Top Bar Background",
            description: "Background color for top toolbar",
            type: "color",
            required: false,
          },
          toolbarText: {
            label: "Top Bar Text",
            description: "Text color in top toolbar",
            type: "color",
            required: false,
          },
          viewerText: {
            label: "Viewer Text",
            description: "Text color for markdown content",
            type: "color",
            required: false,
          },
        },
      },
    },
  },
};
