import { Box, Button, Dialog, DialogContent, DialogTitle, Table, TableBody, TableCell, TableRow, Typography } from "@mui/material";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { KeyboardShortcut, ShortcutHelpGroup } from "../hooks/useKeyboardShortcuts";

interface KeyboardShortcutsHelpProps {
  open: boolean;
  onClose: () => void;
  shortcuts: KeyboardShortcut[];
  title?: string;
}

/**
 * Group shortcuts by description to combine multiple shortcuts for the same action
 */
interface GroupedShortcut {
  description: string;
  labels: string[];
}

interface ShortcutHelpSection {
  id: ShortcutHelpGroup;
  shortcuts: GroupedShortcut[];
}

const DEFAULT_SHORTCUT_HELP_GROUP: ShortcutHelpGroup = "general";

const SHORTCUT_HELP_GROUP_ORDER: ShortcutHelpGroup[] = [
  "general",
  "search",
  "navigation",
  "selection",
  "fileActions",
  "editing",
  "view",
  "panes",
];

/**
 * Unified keyboard shortcuts help dialog
 * Displays all shortcuts passed to it (does not filter by enabled state)
 * The enabled property controls whether shortcuts function, not whether they appear in help
 * Groups shortcuts with the same description into a single row
 */
export const KeyboardShortcutsHelp: React.FC<KeyboardShortcutsHelpProps> = ({ open, onClose, shortcuts, title }) => {
  const { t } = useTranslation();
  const visibleShortcuts = shortcuts.filter((shortcut) => shortcut.enabled !== false);
  const dialogTitle = title ?? t("keyboardShortcutsHelp.defaultTitle");

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      onClose();
    };

    document.addEventListener("keydown", handleDocumentKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleDocumentKeyDown, true);
    };
  }, [onClose, open]);

  const handleDialogKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key !== "Escape") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onClose();
  };

  const groupedShortcuts: ShortcutHelpSection[] = (() => {
    const sections = new Map<ShortcutHelpGroup, GroupedShortcut[]>();
    const sectionDescriptions = new Map<ShortcutHelpGroup, Map<string, GroupedShortcut>>();

    for (const shortcut of visibleShortcuts) {
      const sectionId = shortcut.helpGroup ?? DEFAULT_SHORTCUT_HELP_GROUP;
      const label = shortcut.label || shortcut.keys.toString();

      let sectionShortcuts = sections.get(sectionId);
      if (!sectionShortcuts) {
        sectionShortcuts = [];
        sections.set(sectionId, sectionShortcuts);
      }

      let descriptionMap = sectionDescriptions.get(sectionId);
      if (!descriptionMap) {
        descriptionMap = new Map<string, GroupedShortcut>();
        sectionDescriptions.set(sectionId, descriptionMap);
      }

      const existing = descriptionMap.get(shortcut.description);
      if (existing) {
        if (!existing.labels.includes(label)) {
          existing.labels.push(label);
        }
        continue;
      }

      const groupedShortcut = {
        description: shortcut.description,
        labels: [label],
      };

      descriptionMap.set(shortcut.description, groupedShortcut);
      sectionShortcuts.push(groupedShortcut);
    }

    return SHORTCUT_HELP_GROUP_ORDER.flatMap((sectionId) => {
      const sectionShortcuts = sections.get(sectionId);
      return sectionShortcuts && sectionShortcuts.length > 0 ? [{ id: sectionId, shortcuts: sectionShortcuts }] : [];
    });
  })();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      onKeyDownCapture={handleDialogKeyDown}
      disableEscapeKeyDown
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          bgcolor: "background.default",
        },
      }}
    >
      <DialogTitle>{dialogTitle}</DialogTitle>
      <DialogContent sx={{ bgcolor: "background.default" }}>
        {groupedShortcuts.length === 0 ? (
          <Box sx={{ py: 2, textAlign: "center", backgroundColor: "background.default", color: "text.secondary" }}>
            {t("keyboardShortcutsHelp.emptyState")}
          </Box>
        ) : (
          <Box>
            {groupedShortcuts.map((section, index) => (
              <Box key={section.id} component="section" sx={{ mt: index === 0 ? 0 : 2.5 }}>
                <Typography
                  component="h3"
                  variant="subtitle2"
                  sx={{ mb: 1, color: "text.secondary", letterSpacing: 0.6, textTransform: "uppercase" }}
                >
                  {t(`keyboardShortcutsHelp.groups.${section.id}`)}
                </Typography>
                <Table size="small">
                  <TableBody>
                    {section.shortcuts.map((group) => (
                      <TableRow key={`${section.id}-${group.description}`}>
                        <TableCell>
                          <strong>{group.labels.join(" / ")}</strong>
                        </TableCell>
                        <TableCell>{group.description}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            ))}
          </Box>
        )}
        <Box sx={{ mt: 2, textAlign: "center" }}>
          <Button variant="contained" onClick={onClose}>
            {t("common.actions.close")}
          </Button>
        </Box>
      </DialogContent>
    </Dialog>
  );
};
