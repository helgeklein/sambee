import { AdvancedSettings } from "../../pages/AdvancedSettings";
import { ConnectionsSettings } from "../../pages/ConnectionsSettings";
import { PreferencesSettings } from "../../pages/PreferencesSettings";
import { UserManagementSettings } from "../../pages/UserManagementSettings";
import type { SettingsCategory } from "./settingsNavigation";

interface SettingsCategoryContentProps {
  category: SettingsCategory;
  isAdmin: boolean;
  onConnectionsChanged?: () => void;
  dialogSafeHeader?: boolean;
  forceDesktopLayout?: boolean;
}

export function SettingsCategoryContent({
  category,
  isAdmin,
  onConnectionsChanged,
  dialogSafeHeader = false,
  forceDesktopLayout = false,
}: SettingsCategoryContentProps) {
  switch (category) {
    case "preferences":
      return <PreferencesSettings />;
    case "connections":
      return (
        <ConnectionsSettings
          onConnectionsChanged={onConnectionsChanged}
          dialogSafeHeader={dialogSafeHeader}
          forceDesktopLayout={forceDesktopLayout}
        />
      );
    case "admin-system":
      return isAdmin ? <AdvancedSettings dialogSafeHeader={dialogSafeHeader} /> : null;
    case "admin-users":
      return isAdmin ? <UserManagementSettings dialogSafeHeader={dialogSafeHeader} /> : null;
  }
}
