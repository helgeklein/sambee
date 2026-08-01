import { useState, type ReactNode } from "react";
import { SettingsPage } from "../components/Settings/SettingsPage";
import { ConnectionSettings } from "./ConnectionSettings";

interface ConnectionsSettingsProps {
  isAdmin?: boolean;
  onConnectionsChanged?: () => void;
  dialogSafeHeader?: boolean;
  forceDesktopLayout?: boolean;
}

export function ConnectionsSettings({
  isAdmin,
  onConnectionsChanged,
  dialogSafeHeader = false,
  forceDesktopLayout = false,
}: ConnectionsSettingsProps) {
  const [footerSecondaryActions, setFooterSecondaryActions] = useState<ReactNode>(null);

  return (
    <SettingsPage
      category="connections"
      dialogSafeHeader={dialogSafeHeader}
      contentSx={{ px: 0, minWidth: 0 }}
      footerSecondaryActions={footerSecondaryActions}
    >
      <ConnectionSettings
        isAdmin={isAdmin}
        onConnectionsChanged={onConnectionsChanged}
        forceDesktopLayout={forceDesktopLayout}
        showHeader={false}
        contentPadding="none"
        onFooterSecondaryActionsChange={setFooterSecondaryActions}
      />
    </SettingsPage>
  );
}
