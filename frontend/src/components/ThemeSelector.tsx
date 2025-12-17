import { Palette as PaletteIcon } from "@mui/icons-material";
import {
  Box,
  Card,
  CardActionArea,
  CardContent,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Radio,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { useState } from "react";
import { useSambeeTheme } from "../theme";

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
      <Tooltip title="Change theme">
        <IconButton onClick={() => setOpen(true)} color="inherit" size={isMobile ? "small" : "medium"}>
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
  const { currentTheme, availableThemes, setThemeById } = useSambeeTheme();

  const handleSelect = (themeId: string) => {
    setThemeById(themeId);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Choose Theme</DialogTitle>
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
                border: currentTheme.id === theme.id ? 2 : 1,
                borderColor: currentTheme.id === theme.id ? "primary.main" : "divider",
              }}
            >
              <CardActionArea onClick={() => handleSelect(theme.id)}>
                <CardContent>
                  <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
                    <Radio checked={currentTheme.id === theme.id} />
                    <Typography variant="h6" sx={{ ml: 1 }}>
                      {theme.name}
                    </Typography>
                  </Box>
                  {theme.description && (
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                      {currentTheme.description}
                    </Typography>
                  )}
                  <ThemePreview theme={theme} />
                </CardContent>
              </CardActionArea>
            </Card>
          ))}
        </Box>
      </DialogContent>
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
        {theme.mode === "dark" ? "Dark" : "Light"}
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
          title="Primary color"
        />
      </Box>
    </Box>
  );
}
