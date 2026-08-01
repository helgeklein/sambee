import { Palette as PaletteIcon } from "@mui/icons-material";
import {
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Radio,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { useSambeeTheme } from "../theme";
import { THEME_SELECTOR_STRINGS } from "./themeSelectorStrings";

//
// ThemeSelector
//

/**
 * Component that displays a button to open the theme selector dialog
 */
export function ThemeSelector() {
  const [open, setOpen] = useState(false);
  const muiTheme = useTheme();
  const isMobile = useMediaQuery(muiTheme.breakpoints.down("sm"));

  return (
    <>
      <Tooltip title={THEME_SELECTOR_STRINGS.OPEN_BUTTON_LABEL}>
        <IconButton
          aria-label={THEME_SELECTOR_STRINGS.OPEN_BUTTON_LABEL}
          onClick={() => setOpen(true)}
          color="inherit"
          size={isMobile ? "small" : "medium"}
        >
          <PaletteIcon />
        </IconButton>
      </Tooltip>
      <ThemeSelectorDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

//
// ThemeSelectorDialog
//

interface ThemeSelectorDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Dialog that displays all available themes for selection
 */
export function ThemeSelectorDialog({ open, onClose }: ThemeSelectorDialogProps) {
  const { currentTheme, availableThemes, saveThemeById, setThemeById } = useSambeeTheme();
  const savedThemeIdRef = useRef(currentTheme.id);
  const [draftThemeId, setDraftThemeId] = useState(currentTheme.id);

  useEffect(() => {
    if (open) {
      savedThemeIdRef.current = currentTheme.id;
      setDraftThemeId(currentTheme.id);
    }
  }, [currentTheme.id, open]);

  const handleSelect = (themeId: string) => {
    setDraftThemeId(themeId);
    setThemeById(themeId);
  };

  const handleCancel = () => {
    setThemeById(savedThemeIdRef.current);
    onClose();
  };

  const handleSave = () => {
    saveThemeById(draftThemeId);
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleCancel} maxWidth="md" fullWidth>
      <DialogTitle>{THEME_SELECTOR_STRINGS.DIALOG_TITLE}</DialogTitle>
      <DialogContent>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)" },
            gap: 2,
            pt: 1,
          }}
        >
          {availableThemes.map((theme) => (
            <Card
              key={theme.id}
              variant="outlined"
              sx={{
                border: draftThemeId === theme.id ? 2 : 1,
                borderColor: draftThemeId === theme.id ? "primary.main" : "divider",
              }}
            >
              <CardActionArea onClick={() => handleSelect(theme.id)}>
                <CardContent>
                  <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
                    <Radio checked={draftThemeId === theme.id} />
                    <Typography variant="h6" sx={{ ml: 1 }}>
                      {THEME_SELECTOR_STRINGS.themeName(theme)}
                    </Typography>
                  </Box>
                  {theme.description && (
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                      {THEME_SELECTOR_STRINGS.themeDescription(theme)}
                    </Typography>
                  )}
                  <ThemePreview theme={theme} />
                </CardContent>
              </CardActionArea>
            </Card>
          ))}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleCancel}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={draftThemeId === savedThemeIdRef.current}>
          Save changes
        </Button>
      </DialogActions>
    </Dialog>
  );
}

//
// ThemePreview
//

interface ThemePreviewProps {
  theme: { primary: { main: string }; secondary: { main: string }; mode: "light" | "dark" };
}

/**
 * Visual preview of a theme's colors
 */
function ThemePreview({ theme }: ThemePreviewProps) {
  return (
    <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
      <Typography variant="caption" color="text.secondary" sx={{ minWidth: 60 }}>
        {THEME_SELECTOR_STRINGS.modeLabel(theme.mode)}
      </Typography>
      <Box
        sx={{
          display: "flex",
          gap: 0.5,
          flex: 1,
        }}
      >
        <Box
          sx={{
            flex: 1,
            height: 40,
            backgroundColor: theme.primary.main,
            borderRadius: 1,
            border: "1px solid",
            borderColor: "divider",
          }}
          title={THEME_SELECTOR_STRINGS.PRIMARY_COLOR_PREVIEW}
        />
      </Box>
    </Box>
  );
}
