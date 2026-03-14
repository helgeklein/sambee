export type SettingsCategory = "appearance" | "browser" | "smb-connections" | "local-drives";

export type MobileSettingsView = "main" | SettingsCategory;

interface SettingsCategoryMeta {
  label: string;
  description: string;
  route: string;
}

export const SETTINGS_ROUTE_BY_CATEGORY: Record<SettingsCategory, string> = {
  appearance: "/settings/appearance",
  browser: "/settings/browser",
  "smb-connections": "/settings/smb-connections",
  "local-drives": "/settings/local-drives",
};

export const SETTINGS_CATEGORY_META: Record<SettingsCategory, SettingsCategoryMeta> = {
  appearance: {
    label: "Appearance",
    description: "Theme and display options",
    route: SETTINGS_ROUTE_BY_CATEGORY.appearance,
  },
  browser: {
    label: "Browser",
    description: "Navigation and file browser behavior",
    route: SETTINGS_ROUTE_BY_CATEGORY.browser,
  },
  "smb-connections": {
    label: "SMB Connections",
    description: "Manage SMB share connections",
    route: SETTINGS_ROUTE_BY_CATEGORY["smb-connections"],
  },
  "local-drives": {
    label: "Local Drives",
    description: "Manage Sambee Companion pairing and local-drive access",
    route: SETTINGS_ROUTE_BY_CATEGORY["local-drives"],
  },
};

export function getSettingsCategoryLabel(category: SettingsCategory): string {
  return SETTINGS_CATEGORY_META[category].label;
}

export function getSettingsCategoryDescription(category: SettingsCategory): string {
  return SETTINGS_CATEGORY_META[category].description;
}

export function getSettingsCategoryByPath(pathname: string): SettingsCategory | null {
  const entry = (Object.entries(SETTINGS_CATEGORY_META) as Array<[SettingsCategory, SettingsCategoryMeta]>).find(
    ([, meta]) => meta.route === pathname
  );

  return entry?.[0] ?? null;
}
