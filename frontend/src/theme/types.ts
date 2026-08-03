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
    /** MUI compatibility value. Standard application surfaces use default instead. */
    paper?: string;
  };
  /** Standard UI foreground colors. Use semantic exceptions for disabled, status, and content-rendering colors. */
  text?: {
    /** High-emphasis text for headings, values, active labels, and primary task information. */
    primary?: string;
    /** Supporting text and passive icons for descriptions, metadata, captions, and helper copy. */
    secondary?: string;
  };
  /** Action/interaction colors */
  action?: {
    selected?: string;
    /** Darker selected state for controls that need stronger contrast than the default selection fill. */
    selectedDarker?: string;
    /** Legacy custom-theme focus override. New themes derive focus from the primary palette. */
    focus?: string;
  };
  /** Component-specific semantic colors */
  components?: {
    /** Link colors */
    link?: {
      /** Default link color */
      main: string;
      /** Link hover color */
      hover?: string;
    };
    /** Search highlight colors shared across viewers and editors */
    search?: {
      /** Background color for non-current search matches */
      otherMatch: string;
      /** Background color for the current/selected search match */
      currentMatch: string;
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
      /** Selected-state background for the secondary markdown editor toolbar */
      secondaryToolbarSelected?: string;
    };
    /** Alert message styles for info/success/warning/error states */
    alert?: {
      /** Info alert colors */
      info: {
        background: string;
        text: string;
        icon: string;
      };
      /** Success alert colors */
      success: {
        background: string;
        text: string;
        icon: string;
      };
      /** Warning alert colors */
      warning: {
        background: string;
        text: string;
        icon: string;
      };
      /** Error alert colors */
      error: {
        background: string;
        text: string;
        icon: string;
      };
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
    description: "Defines default, high-emphasis, and pressed interactive color roles",
    type: "color",
    required: true,
    fields: {
      main: {
        label: "Main",
        description: "Default color for primary controls and selected navigation",
        type: "color",
        required: true,
      },
      light: {
        label: "Light Variant",
        description: "High-emphasis color for dark-mode hover and emphasis states",
        type: "color",
        required: false,
      },
      dark: {
        label: "Dark Variant",
        description: "Pressed and contrast-sensitive color for light-mode controls",
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
    description: "Controls the standard application surface and MUI compatibility values",
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
        description: "Compatibility value for Material UI; standard app surfaces use Default Background",
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
      selected: {
        label: "Selected State",
        description: "Background color for selected items in the file list",
        type: "color",
        required: false,
      },
      selectedDarker: {
        label: "Selected State Darker",
        description: "Stronger selected background for controls that need extra contrast, such as secondary editor toolbars",
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
      search: {
        label: "Search Highlights",
        description: "Colors for current and non-current search matches across viewers and editors",
        type: "color",
        required: false,
        fields: {
          otherMatch: {
            label: "Other Matches",
            description: "Background color for search matches that are not currently selected",
            type: "color",
            required: false,
          },
          currentMatch: {
            label: "Current Match",
            description: "Background color for the currently selected search match",
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
          secondaryToolbarSelected: {
            label: "Secondary Toolbar Selected",
            description: "Selected background color for buttons in the secondary markdown editor toolbar",
            type: "color",
            required: false,
          },
        },
      },
    },
  },
};
