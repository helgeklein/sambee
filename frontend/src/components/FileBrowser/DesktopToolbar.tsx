import { Box, Typography } from "@mui/material";
import type React from "react";
import { SambeeLogo } from "../SambeeLogo";
import { DesktopToolbarActions } from "./DesktopToolbarActions";
import type { SearchProvider } from "./search/types";
import type { UnifiedSearchBarModeOption } from "./UnifiedSearchBar";
import { UnifiedSearchBar } from "./UnifiedSearchBar";

interface DesktopToolbarProps {
  searchProvider: SearchProvider;
  searchActivationToken?: number;
  searchInputRef?: React.RefObject<HTMLInputElement>;
  showSearch: boolean;
  onOpenSettings: () => void;
  /** Called when ESC is pressed on controls or when menus close, to focus file list */
  onBlurToFileList?: () => void;
  searchQueryValue?: string;
  onSearchQueryValueChange?: (value: string) => void;
  disableSearchDropdown?: boolean;
  suppressSearchDropdown?: boolean;
  onSearchArrowDownToFileList?: () => void;
  /** Remove toolbar controls from Tab order (dual-pane mode uses Tab for pane switching) */
  disableTabFocus?: boolean;
  modeOptions?: UnifiedSearchBarModeOption[];
}

//
// DesktopToolbar
//
export function DesktopToolbar({
  searchProvider,
  searchActivationToken,
  searchInputRef,
  showSearch,
  onOpenSettings,
  onBlurToFileList,
  searchQueryValue,
  onSearchQueryValueChange,
  disableSearchDropdown,
  suppressSearchDropdown,
  onSearchArrowDownToFileList,
  disableTabFocus,
  modeOptions,
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
            activationToken={searchActivationToken}
            inputRef={searchInputRef}
            useCompactLayout={false}
            onBlurToFileList={onBlurToFileList}
            queryValue={searchQueryValue}
            onQueryValueChange={onSearchQueryValueChange}
            disableDropdown={disableSearchDropdown}
            suppressDropdown={suppressSearchDropdown}
            onArrowDownToFileList={onSearchArrowDownToFileList}
            disableTabFocus={disableTabFocus}
            modeOptions={modeOptions}
          />
        </Box>
      )}

      <Box sx={{ flexGrow: 1 }} />

      <Box sx={{ ml: 1 }}>
        <DesktopToolbarActions onOpenSettings={onOpenSettings} onEscape={onBlurToFileList} disableTabFocus={disableTabFocus} />
      </Box>
    </>
  );
}
