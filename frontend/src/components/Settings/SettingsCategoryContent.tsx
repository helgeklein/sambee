import { AboutSettings } from "../../pages/AboutSettings";
import { AccountSettings } from "../../pages/AccountSettings";
import { AdvancedSettings } from "../../pages/AdvancedSettings";
import { AuthenticationSettings } from "../../pages/AuthenticationSettings";
import { ConnectionsSettings } from "../../pages/ConnectionsSettings";
import { FileBrowserSettings } from "../../pages/FileBrowserSettings";
import { FileSearchSettings } from "../../pages/FileSearchSettings";
import { LocalDrivesSettings } from "../../pages/LocalDrivesSettings";
import { NetworkSettings } from "../../pages/NetworkSettings";
import { AppearanceSettings } from "../../pages/PreferencesSettings";
import { SmbSettings } from "../../pages/SmbSettings";
import { TextEditorSettings } from "../../pages/TextEditorSettings";
import { UserManagementSettings } from "../../pages/UserManagementSettings";
import { SettingsCategoryDescription } from "./SettingsCategoryDescription";
import { getSettingsNavItemLabel, type SettingsNavItem } from "./settingsNavigation";

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
    case "account":
      return <AccountSettings dialogSafe={dialogSafeHeader} />;
    case "file-browser":
      return <FileBrowserSettings />;
    case "text-editor":
      return <TextEditorSettings />;
    case "connections":
      return (
        <ConnectionsSettings
          isAdmin={isAdmin}
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
          sectionDescription={<SettingsCategoryDescription category="local-drives" />}
        />
      );
    case "admin-network":
      return isAdmin ? <NetworkSettings /> : null;
    case "admin-authentication":
      return isAdmin ? <AuthenticationSettings /> : null;
    case "admin-smb":
      return isAdmin ? <SmbSettings dialogSafeHeader={dialogSafeHeader} /> : null;
    case "admin-file-search":
      return isAdmin ? <FileSearchSettings /> : null;
    case "admin-system":
      return isAdmin ? <AdvancedSettings dialogSafeHeader={dialogSafeHeader} /> : null;
    case "admin-about":
      return isAdmin ? <AboutSettings dialogSafeHeader={dialogSafeHeader} /> : null;
    case "admin-users":
      return isAdmin ? <UserManagementSettings dialogSafeHeader={dialogSafeHeader} /> : null;
  }
}
