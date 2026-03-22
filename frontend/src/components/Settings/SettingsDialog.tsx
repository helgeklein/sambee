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
import { getVisibleSettingsCategories, getVisibleSettingsSections, type SettingsCategory } from "./settingsNavigation";
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
 * Preferences, Connections, User Management, and System settings.
 */
const SettingsDialog: React.FC<SettingsDialogProps> = ({ open, onClose, initialCategory = "preferences", onConnectionsChanged }) => {
  const [selectedCategory, setSelectedCategory] = useState<SettingsCategory>(initialCategory);
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const { isAdmin } = useSettingsAccess(open);
  const { t } = useTranslation();

  // Refs for category list items (for arrow key navigation and initial focus)
  const categoryRefs = useRef<Partial<Record<SettingsCategory, HTMLDivElement | null>>>({});

  // Build list of available categories based on admin status
  const availableCategories = useMemo(() => getVisibleSettingsCategories(isAdmin), [isAdmin]);
  const visibleSections = useMemo(() => getVisibleSettingsSections(isAdmin), [isAdmin]);

  const focusCategoryButton = useCallback((category: SettingsCategory) => {
    categoryRefs.current[category]?.focus();
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
      const currentIndex = availableCategories.indexOf(selectedCategory);
      let newIndex = currentIndex;

      if (e.key === "ArrowDown") {
        newIndex = Math.min(currentIndex + 1, availableCategories.length - 1);
      } else if (e.key === "ArrowUp") {
        newIndex = Math.max(currentIndex - 1, 0);
      }

      if (newIndex !== currentIndex) {
        const newCategory = availableCategories[newIndex];
        if (newCategory) {
          setSelectedCategory(newCategory);
          focusCategoryButton(newCategory);
        }
      }
    },
    [availableCategories, focusCategoryButton, selectedCategory]
  );

  useEffect(() => {
    if (open) {
      // Fetch version info
      void fetchVersionInfo().then((info) => {
        if (info) {
          setVersionInfo(info);
        }
      });
    }
  }, [open]);

  // Set category when dialog opens (use initialCategory prop)
  useEffect(() => {
    if (open) {
      setSelectedCategory(availableCategories.includes(initialCategory) ? initialCategory : (availableCategories[0] ?? "preferences"));
    }
  }, [availableCategories, initialCategory, open]);

  // Focus the initial category button when dialog opens
  useEffect(() => {
    if (open) {
      // Use setTimeout to ensure the dialog is fully rendered
      const timeoutId = setTimeout(() => {
        focusCategoryButton(availableCategories.includes(initialCategory) ? initialCategory : (availableCategories[0] ?? "preferences"));
      }, 0);
      return () => clearTimeout(timeoutId);
    }
  }, [availableCategories, focusCategoryButton, initialCategory, open]);

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
            onSelect={setSelectedCategory}
            selectedCategory={selectedCategory}
            listSx={{ flex: 1, py: 0 }}
            listRole="listbox"
            listAriaLabel={t("settings.shell.categoriesAriaLabel")}
            sectionSx={{ mb: 1 }}
            subheaderSx={{ bgcolor: "transparent", lineHeight: 2.5, textTransform: "uppercase", letterSpacing: 0.8 }}
            wrapItemsInListItem
            getItemRef={(category) => (element) => {
              categoryRefs.current[category] = element;
            }}
            getItemTabIndex={(category) => (selectedCategory === category ? 0 : -1)}
            getItemAriaSelected={(category) => selectedCategory === category}
            itemRole="option"
            onItemKeyDown={handleCategoryKeyDown}
            itemButtonSx={{ py: 1.5, px: 2 }}
            itemIconSx={(selected) => ({ minWidth: 40, color: selected ? "primary.main" : "text.secondary" })}
            iconGlyphSx={{ fontSize: 28 }}
            primaryTypographyProps={(selected) => ({ variant: "h6", fontWeight: selected ? "medium" : "normal" })}
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
            category={selectedCategory}
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
