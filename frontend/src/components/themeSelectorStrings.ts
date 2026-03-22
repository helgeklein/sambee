import { translate } from "../i18n";

const BUILT_IN_THEME_KEYS = {
  "sambee-light": {
    description: "themeSelector.builtInThemes.sambeeLight.description",
    name: "themeSelector.builtInThemes.sambeeLight.name",
  },
  "sambee-dark": {
    description: "themeSelector.builtInThemes.sambeeDark.description",
    name: "themeSelector.builtInThemes.sambeeDark.name",
  },
} as const;

function getBuiltInThemeKeys(themeId: string) {
  return BUILT_IN_THEME_KEYS[themeId as keyof typeof BUILT_IN_THEME_KEYS];
}

export const THEME_SELECTOR_STRINGS = {
  get DIALOG_TITLE() {
    return translate("themeSelector.dialogTitle");
  },
  get OPEN_BUTTON_LABEL() {
    return translate("themeSelector.openButtonLabel");
  },
  get PRIMARY_COLOR_PREVIEW() {
    return translate("themeSelector.previewPrimaryColor");
  },
  modeLabel(mode: "light" | "dark") {
    return translate(mode === "dark" ? "themeSelector.modes.dark" : "themeSelector.modes.light");
  },
  themeDescription(theme: { description?: string; id: string }) {
    const keys = getBuiltInThemeKeys(theme.id);
    if (keys) {
      return translate(keys.description);
    }

    return theme.description ?? "";
  },
  themeName(theme: { id: string; name: string }) {
    const keys = getBuiltInThemeKeys(theme.id);
    if (keys) {
      return translate(keys.name);
    }

    return theme.name;
  },
};
