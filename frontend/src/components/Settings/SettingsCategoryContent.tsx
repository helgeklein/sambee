import { AdvancedSettings } from "../../pages/AdvancedSettings";
import { ConnectionsSettings } from "../../pages/ConnectionsSettings";
import { FileBrowserSettings } from "../../pages/FileBrowserSettings";
import { LocalDrivesSettings } from "../../pages/LocalDrivesSettings";
import { AppearanceSettings } from "../../pages/PreferencesSettings";
import { UserManagementSettings } from "../../pages/UserManagementSettings";
import { getSettingsNavItemDescription, getSettingsNavItemLabel, type SettingsNavItem } from "./settingsNavigation";

interface SettingsCategoryContentProps {
  item: SettingsNavItem;
  isAdmin: boolean;
  onConnectionsChanged?: () => void;
  dialogSafeHeader?: boolean;
  forceDesktopLayout?: boolean;
  setMobileBackHandler?: (handler: (() => void) | null) => void;
}

export function SettingsCategoryContent({
  item,
  isAdmin,
  onConnectionsChanged,
  dialogSafeHeader = false,
  forceDesktopLayout = false,
}: SettingsCategoryContentProps) {
  switch (item) {
    case "appearance":
      return <AppearanceSettings />;
    case "file-browser":
      return <FileBrowserSettings />;
    case "connections":
      return (
        <ConnectionsSettings
          onConnectionsChanged={onConnectionsChanged}
          dialogSafeHeader={dialogSafeHeader}
          forceDesktopLayout={forceDesktopLayout}
        />
      );
    case "local-drives":
      return (
        <LocalDrivesSettings
          onConnectionsChanged={onConnectionsChanged}
          sectionTitle={getSettingsNavItemLabel("local-drives")}
          sectionDescription={getSettingsNavItemDescription("local-drives")}
        />
      );
    case "admin-system":
      return isAdmin ? <AdvancedSettings dialogSafeHeader={dialogSafeHeader} /> : null;
    case "admin-users":
      return isAdmin ? <UserManagementSettings dialogSafeHeader={dialogSafeHeader} /> : null;
  }
}
