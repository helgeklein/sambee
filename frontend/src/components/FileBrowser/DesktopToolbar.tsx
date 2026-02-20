import { Box, Typography } from "@mui/material";
import type React from "react";
import type { Connection } from "../../types";
import { SambeeLogo } from "../SambeeLogo";
import { ConnectionSelector } from "./ConnectionSelector";
import { DesktopToolbarActions } from "./DesktopToolbarActions";
import type { SearchProvider } from "./search/types";
import { UnifiedSearchBar } from "./UnifiedSearchBar";

interface DesktopToolbarProps {
  connections: Connection[];
  selectedConnectionId: string;
  onConnectionChange: (connectionId: string) => void;
  searchProvider: SearchProvider;
  searchInputRef?: React.RefObject<HTMLInputElement>;
  showSearch: boolean;
  onOpenSettings: () => void;
  /** Called when ESC is pressed on controls or when menus close, to focus file list */
  onBlurToFileList?: () => void;
  /** Whether the Open in App button should be shown */
  showOpenInApp?: boolean;
  /** Called when the "Open in App" button is clicked */
  onOpenInApp?: () => void;
  /** Whether companion URI generation is in progress */
  openInAppLoading?: boolean;
  /** Remove toolbar controls from Tab order (dual-pane mode uses Tab for pane switching) */
  disableTabFocus?: boolean;
}

//
// DesktopToolbar
//
export function DesktopToolbar({
  connections,
  selectedConnectionId,
  onConnectionChange,
  searchProvider,
  searchInputRef,
  showSearch,
  onOpenSettings,
  onBlurToFileList,
  showOpenInApp,
  onOpenInApp,
  openInAppLoading,
  disableTabFocus,
}: DesktopToolbarProps) {
  return (
    <>
      <SambeeLogo sx={{ mr: 2 }} />

      <Typography variant="h6" component="div">
        Sambee
      </Typography>

      <Box sx={{ flexGrow: 1 }} />

      {showSearch && (
        <Box sx={{ flexGrow: 0, width: "100%", maxWidth: { sm: 400, md: 500, lg: 600 }, mx: 2 }}>
          <UnifiedSearchBar
            provider={searchProvider}
            inputRef={searchInputRef}
            useCompactLayout={false}
            onBlurToFileList={onBlurToFileList}
            disableTabFocus={disableTabFocus}
          />
        </Box>
      )}

      <Box sx={{ flexGrow: 1 }} />

      <ConnectionSelector
        connections={connections}
        selectedConnectionId={selectedConnectionId}
        onConnectionChange={onConnectionChange}
        onAfterChange={onBlurToFileList}
        disableTabFocus={disableTabFocus}
      />

      <Box sx={{ ml: 1 }}>
        <DesktopToolbarActions
          onOpenSettings={onOpenSettings}
          onEscape={onBlurToFileList}
          showOpenInApp={showOpenInApp}
          onOpenInApp={onOpenInApp}
          openInAppLoading={openInAppLoading}
          disableTabFocus={disableTabFocus}
        />
      </Box>
    </>
  );
}
