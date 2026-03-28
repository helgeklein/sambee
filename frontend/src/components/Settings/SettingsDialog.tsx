//
// SettingsDialog
//

import CloseIcon from "@mui/icons-material/Close";
import { Box, Dialog, Divider, IconButton, Typography } from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { VersionInfo } from "../../utils/version";
import { fetchVersionInfo } from "../../utils/version";
import { SettingsCategoryContent } from "./SettingsCategoryContent";
import { SettingsCategoryList } from "./SettingsCategoryList";
import { prefetchSettingsDataForItems } from "./settingsDataSources";
import {
  DEFAULT_SETTINGS_CATEGORY,
  getVisibleSettingsNavItems,
  getVisibleSettingsSections,
  type SettingsCategory,
  type SettingsNavItem,
} from "./settingsNavigation";
import { useSettingsAccess } from "./useSettingsAccess";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  /** Initial category to show when dialog opens */
  initialCategory?: SettingsCategory;
  /** Callback when connections are added, updated, or deleted */
  onConnectionsChanged?: () => void;
}

/**
 * SettingsDialog
 *
 * Modal dialog for settings on desktop.
 * Contains sidebar navigation and content area for the consolidated
 * Appearance, Connections, User Management, and System settings.
 */
const SettingsDialog: React.FC<SettingsDialogProps> = ({
  open,
  onClose,
  initialCategory = DEFAULT_SETTINGS_CATEGORY,
  onConnectionsChanged,
}) => {
  const [selectedItem, setSelectedItem] = useState<SettingsNavItem>(initialCategory);
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const { isAdmin } = useSettingsAccess(open);
  const { t } = useTranslation();

  // Refs for category list items (for arrow key navigation and initial focus)
  const categoryRefs = useRef<Partial<Record<SettingsNavItem, HTMLDivElement | null>>>({});

  // Build list of available items based on admin status
  const availableItems = useMemo(() => getVisibleSettingsNavItems(isAdmin), [isAdmin]);
  const visibleSections = useMemo(() => getVisibleSettingsSections(isAdmin), [isAdmin]);

  const focusCategoryButton = useCallback((item: SettingsNavItem) => {
    categoryRefs.current[item]?.focus();
  }, []);

  //
  // handleCategoryKeyDown
  //
  const handleCategoryKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") {
        return;
      }

      e.preventDefault();
      const currentIndex = availableItems.indexOf(selectedItem);
      let newIndex = currentIndex;

      if (e.key === "ArrowDown") {
        newIndex = Math.min(currentIndex + 1, availableItems.length - 1);
      } else if (e.key === "ArrowUp") {
        newIndex = Math.max(currentIndex - 1, 0);
      }

      if (newIndex !== currentIndex) {
        const newItem = availableItems[newIndex];
        if (newItem) {
          setSelectedItem(newItem);
          focusCategoryButton(newItem);
        }
      }
    },
    [availableItems, focusCategoryButton, selectedItem]
  );

  useEffect(() => {
    if (open) {
      prefetchSettingsDataForItems(availableItems);

      // Fetch version info
      void fetchVersionInfo().then((info) => {
        if (info) {
          setVersionInfo(info);
        }
      });
    }
  }, [availableItems, open]);

  // Set category when dialog opens (use initialCategory prop)
  useEffect(() => {
    if (open) {
      setSelectedItem(availableItems.includes(initialCategory) ? initialCategory : (availableItems[0] ?? DEFAULT_SETTINGS_CATEGORY));
    }
  }, [availableItems, initialCategory, open]);

  // Focus the initial category button when dialog opens
  useEffect(() => {
    if (open) {
      // Use setTimeout to ensure the dialog is fully rendered
      const timeoutId = setTimeout(() => {
        focusCategoryButton(availableItems.includes(initialCategory) ? initialCategory : (availableItems[0] ?? DEFAULT_SETTINGS_CATEGORY));
      }, 0);
      return () => clearTimeout(timeoutId);
    }
  }, [availableItems, focusCategoryButton, initialCategory, open]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth PaperProps={{ sx: { height: "80vh", bgcolor: "background.default" } }}>
      {/* Close button in upper-right corner */}
      <IconButton
        onClick={onClose}
        size="small"
        aria-label={t("settings.shell.closeAriaLabel")}
        sx={{
          position: "absolute",
          right: 8,
          top: 8,
          zIndex: 1,
        }}
      >
        <CloseIcon />
      </IconButton>

      <Box sx={{ display: "flex", height: "100%" }}>
        {/* Left Sidebar */}
        <Box
          sx={{
            width: 280,
            borderRight: 1,
            borderColor: "divider",
            display: "flex",
            flexDirection: "column",
            bgcolor: "background.default",
          }}
        >
          <Box sx={{ p: 2 }}>
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              {t("settings.shell.title")}
            </Typography>
          </Box>
          <Divider sx={{ mb: 2 }} />
          <SettingsCategoryList
            sections={visibleSections}
            onSelect={setSelectedItem}
            selectedItem={selectedItem}
            listSx={{ flex: 1, py: 0 }}
            listRole="listbox"
            listAriaLabel={t("settings.shell.categoriesAriaLabel")}
            sectionSx={{ mb: 1 }}
            wrapItemsInListItem
            getItemRef={(item) => (element) => {
              categoryRefs.current[item] = element;
            }}
            getItemTabIndex={(item) => (selectedItem === item ? 0 : -1)}
            getItemAriaSelected={(item) => selectedItem === item}
            itemRole="option"
            onItemKeyDown={handleCategoryKeyDown}
            itemButtonSx={() => ({ py: 0.5, px: 1.5 })}
            itemIconSx={(selected: boolean) => ({ minWidth: 40, color: selected ? "primary.main" : "text.secondary" })}
            primaryTypographyProps={(selected) => ({
              fontWeight: selected ? "medium" : "normal",
            })}
          />

          {/* Version Information */}
          {versionInfo && (
            <>
              <Divider />
              <Box sx={{ p: 2, pt: 1 }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
                  {t("settings.shell.versionLabel")}: {versionInfo.version}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
                  {t("settings.shell.buildLabel")}: {versionInfo.build_time}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                  {t("settings.shell.commitLabel")}: {versionInfo.git_commit.substring(0, 7)}
                </Typography>
              </Box>
            </>
          )}
        </Box>

        {/* Right Content Area */}
        <Box
          sx={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            bgcolor: "background.default",
          }}
        >
          <SettingsCategoryContent
            item={selectedItem}
            isAdmin={isAdmin}
            onConnectionsChanged={onConnectionsChanged}
            dialogSafeHeader
            forceDesktopLayout
          />
        </Box>
      </Box>
    </Dialog>
  );
};

export default SettingsDialog;
