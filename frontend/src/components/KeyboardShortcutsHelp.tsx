import { Box, Button, Dialog, DialogContent, DialogTitle, Table, TableBody, TableCell, TableRow } from "@mui/material";
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
export const KeyboardShortcutsHelp: React.FC<KeyboardShortcutsHelpProps> = ({ open, onClose, shortcuts, title = "Keyboard Shortcuts" }) => {
  // Group shortcuts by description
  const groupedShortcuts: GroupedShortcut[] = [];
  const descriptionMap = new Map<string, string[]>();

  for (const shortcut of shortcuts) {
    const existing = descriptionMap.get(shortcut.description);
    if (existing) {
      existing.push(shortcut.label);
    } else {
      descriptionMap.set(shortcut.description, [shortcut.label]);
    }
  }

  // Convert map to array, preserving order from original shortcuts
  const seenDescriptions = new Set<string>();
  for (const shortcut of shortcuts) {
    if (!seenDescriptions.has(shortcut.description)) {
      seenDescriptions.add(shortcut.description);
      groupedShortcuts.push({
        description: shortcut.description,
        labels: descriptionMap.get(shortcut.description) || [],
      });
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        {groupedShortcuts.length === 0 ? (
          <Box sx={{ py: 2, textAlign: "center", color: "text.secondary" }}>No keyboard shortcuts available</Box>
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
            Close
          </Button>
        </Box>
      </DialogContent>
    </Dialog>
  );
};
