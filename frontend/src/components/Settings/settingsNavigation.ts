import { translate } from "../../i18n";

export type SettingsCategory = "appearance" | "file-browser" | "connections" | "local-drives" | "admin-users" | "admin-system";
export type SettingsNavItem = SettingsCategory;
export type SettingsContentItem = SettingsNavItem;

export type SettingsSection = "personal" | "administration";

export type MobileSettingsView = "main" | SettingsNavItem;

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
  appearance: "/settings/appearance",
  "file-browser": "/settings/file-browser",
  connections: "/settings/connections",
  "local-drives": "/settings/connections/local-drives",
  "admin-users": "/settings/admin/users",
  "admin-system": "/settings/admin/system",
};

export const SETTINGS_ROUTE_BY_NAV_ITEM: Record<SettingsNavItem, string> = SETTINGS_ROUTE_BY_CATEGORY;

export const SETTINGS_SECTION_LABELS: Record<SettingsSection, string> = {
  get personal() {
    return translate("settings.sections.personal");
  },
  get administration() {
    return translate("settings.sections.administration");
  },
};

export const SETTINGS_CATEGORY_META: Record<SettingsCategory, SettingsCategoryMeta> = {
  appearance: {
    get label() {
      return translate("settings.categories.appearance.label");
    },
    get description() {
      return translate("settings.categories.appearance.description");
    },
    route: SETTINGS_ROUTE_BY_CATEGORY.appearance,
    section: "personal",
  },
  "file-browser": {
    get label() {
      return translate("settings.categories.fileBrowser.label");
    },
    get description() {
      return translate("settings.categories.fileBrowser.description");
    },
    route: SETTINGS_ROUTE_BY_CATEGORY["file-browser"],
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
  "local-drives": {
    get label() {
      return translate("settings.connectionsSubgroups.localDrives.label");
    },
    get description() {
      return translate("settings.connectionsSubgroups.localDrives.description");
    },
    route: SETTINGS_ROUTE_BY_CATEGORY["local-drives"],
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

export const SETTINGS_CATEGORY_ORDER: SettingsCategory[] = [
  "appearance",
  "file-browser",
  "connections",
  "local-drives",
  "admin-users",
  "admin-system",
];

export const DEFAULT_SETTINGS_CATEGORY: SettingsCategory = SETTINGS_CATEGORY_ORDER[0]!;

export function getSettingsCategoryLabel(category: SettingsCategory): string {
  return SETTINGS_CATEGORY_META[category].label;
}

export function getSettingsNavItemLabel(item: SettingsNavItem): string {
  return SETTINGS_CATEGORY_META[item].label;
}

export function getSettingsViewTitle(view: MobileSettingsView): string {
  return view === "main" ? translate("settings.shell.title") : getSettingsNavItemLabel(view);
}

export function getSettingsCategoryDescription(category: SettingsCategory): string {
  return SETTINGS_CATEGORY_META[category].description;
}

export function getSettingsNavItemDescription(item: SettingsNavItem): string {
  return SETTINGS_CATEGORY_META[item].description;
}

export function getSettingsContentItem(item: SettingsNavItem): SettingsContentItem {
  return item;
}

export function getSettingsParentCategory(item: SettingsNavItem): SettingsCategory | null {
  return item;
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

export function getVisibleSettingsNavItems(isAdmin: boolean): SettingsNavItem[] {
  return getVisibleSettingsSections(isAdmin).flatMap((section) => section.categories);
}

export function getSettingsNavItemByPath(pathname: string): SettingsNavItem | null {
  const categoryEntry = [...(Object.entries(SETTINGS_CATEGORY_META) as Array<[SettingsCategory, SettingsCategoryMeta]>)]
    .sort(([, leftMeta], [, rightMeta]) => rightMeta.route.length - leftMeta.route.length)
    .find(([, meta]) => pathname === meta.route || pathname.startsWith(`${meta.route}/`));

  return categoryEntry?.[0] ?? null;
}

export function getSettingsCategoryByPath(pathname: string): SettingsCategory | null {
  const item = getSettingsNavItemByPath(pathname);

  if (!item) {
    return null;
  }

  return item;
}
