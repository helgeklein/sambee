import { Box, Button, Dialog, DialogContent, DialogTitle, Table, TableBody, TableCell, TableRow } from "@mui/material";
import { useTranslation } from "react-i18next";
import type { KeyboardShortcut } from "../hooks/useKeyboardShortcuts";

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

  // Group shortcuts by description
  const groupedShortcuts: GroupedShortcut[] = [];
  const descriptionMap = new Map<string, string[]>();

  for (const shortcut of visibleShortcuts) {
    const label = shortcut.label || shortcut.keys.toString();
    const existing = descriptionMap.get(shortcut.description);
    if (existing) {
      existing.push(label);
    } else {
      descriptionMap.set(shortcut.description, [label]);
    }
  }

  // Convert map to array, preserving order from original shortcuts
  const seenDescriptions = new Set<string>();
  for (const shortcut of visibleShortcuts) {
    if (!seenDescriptions.has(shortcut.description)) {
      seenDescriptions.add(shortcut.description);
      groupedShortcuts.push({
        description: shortcut.description,
        labels: descriptionMap.get(shortcut.description) || [],
      });
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
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
          <Table size="small">
            <TableBody>
              {groupedShortcuts.map((group) => (
                <TableRow key={group.description}>
                  <TableCell>
                    <strong>{group.labels.join(" / ")}</strong>
                  </TableCell>
                  <TableCell>{group.description}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
