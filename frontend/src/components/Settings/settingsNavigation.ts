import { translate } from "../../i18n";

export type SettingsCategory = "preferences" | "connections" | "admin-users" | "admin-system";

export type SettingsSection = "personal" | "administration";

export type MobileSettingsView = "main" | SettingsCategory;

export interface VisibleSettingsSection {
  section: SettingsSection;
  label: string;
  categories: SettingsCategory[];
}

interface SettingsCategoryMeta {
  label: string;
  description: string;
  route: string;
  section: SettingsSection;
  adminOnly?: boolean;
}

export const SETTINGS_ROUTE_BY_CATEGORY: Record<SettingsCategory, string> = {
  preferences: "/settings/preferences",
  connections: "/settings/connections",
  "admin-users": "/settings/admin/users",
  "admin-system": "/settings/admin/system",
};

export const SETTINGS_SECTION_LABELS: Record<SettingsSection, string> = {
  get personal() {
    return translate("settings.sections.personal");
  },
  get administration() {
    return translate("settings.sections.administration");
  },
};

export const SETTINGS_CATEGORY_META: Record<SettingsCategory, SettingsCategoryMeta> = {
  preferences: {
    get label() {
      return translate("settings.categories.preferences.label");
    },
    get description() {
      return translate("settings.categories.preferences.description");
    },
    route: SETTINGS_ROUTE_BY_CATEGORY.preferences,
    section: "personal",
  },
  connections: {
    get label() {
      return translate("settings.categories.connections.label");
    },
    get description() {
      return translate("settings.categories.connections.description");
    },
    route: SETTINGS_ROUTE_BY_CATEGORY.connections,
    section: "personal",
  },
  "admin-users": {
    get label() {
      return translate("settings.categories.adminUsers.label");
    },
    get description() {
      return translate("settings.categories.adminUsers.description");
    },
    route: SETTINGS_ROUTE_BY_CATEGORY["admin-users"],
    section: "administration",
    adminOnly: true,
  },
  "admin-system": {
    get label() {
      return translate("settings.categories.adminSystem.label");
    },
    get description() {
      return translate("settings.categories.adminSystem.description");
    },
    route: SETTINGS_ROUTE_BY_CATEGORY["admin-system"],
    section: "administration",
    adminOnly: true,
  },
};

export const SETTINGS_CATEGORY_ORDER: SettingsCategory[] = ["preferences", "connections", "admin-users", "admin-system"];

export function getSettingsCategoryLabel(category: SettingsCategory): string {
  return SETTINGS_CATEGORY_META[category].label;
}

export function getSettingsViewTitle(view: MobileSettingsView): string {
  return view === "main" ? translate("settings.shell.title") : getSettingsCategoryLabel(view);
}

export function getSettingsCategoryDescription(category: SettingsCategory): string {
  return SETTINGS_CATEGORY_META[category].description;
}

export function getVisibleSettingsCategories(isAdmin: boolean): SettingsCategory[] {
  return SETTINGS_CATEGORY_ORDER.filter((category) => {
    const meta = SETTINGS_CATEGORY_META[category];
    return !meta.adminOnly || isAdmin;
  });
}

export function getVisibleSettingsSections(isAdmin: boolean): VisibleSettingsSection[] {
  return (["personal", "administration"] as SettingsSection[])
    .map((section) => ({
      section,
      label: SETTINGS_SECTION_LABELS[section],
      categories: getVisibleSettingsCategories(isAdmin).filter((category) => SETTINGS_CATEGORY_META[category].section === section),
    }))
    .filter((entry) => entry.categories.length > 0);
}

export function getSettingsCategoryByPath(pathname: string): SettingsCategory | null {
  const entry = (Object.entries(SETTINGS_CATEGORY_META) as Array<[SettingsCategory, SettingsCategoryMeta]>).find(
    ([, meta]) => meta.route === pathname
  );

  return entry?.[0] ?? null;
}
