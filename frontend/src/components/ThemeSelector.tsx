import { Palette as PaletteIcon } from "@mui/icons-material";
import {
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  IconButton,
  Radio,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { useState } from "react";
import { useCurrentUserSetting } from "../services/userSettingsStore";
import { useSambeeTheme } from "../theme";
import { DialogNotice } from "./Dialog/DialogNotice";
import { ResponsiveDialogShell } from "./Dialog/ResponsiveDialogShell";
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
  const { currentTheme, availableThemes } = useSambeeTheme();
  const themeSetting = useCurrentUserSetting("appearance.theme_id");

  const handleSelect = (themeId: string) => {
    if (themeId !== currentTheme.id && !themeSetting.pending) {
      void themeSetting.commit(themeId).catch(() => undefined);
    }
  };

  return (
    <ResponsiveDialogShell
      open={open}
      onClose={onClose}
      title={THEME_SELECTOR_STRINGS.DIALOG_TITLE}
      maxWidth="md"
      actionNotice={<DialogNotice message={themeSetting.error} />}
      actions={<Button onClick={onClose}>Close</Button>}
    >
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
            <CardActionArea onClick={() => handleSelect(theme.id)} disabled={themeSetting.pending}>
              <CardContent>
                <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
                  <Radio checked={currentTheme.id === theme.id} />
                  <Typography variant="h6" sx={{ ml: 1 }}>
                    {THEME_SELECTOR_STRINGS.themeName(theme)}
                  </Typography>
                </Box>
                {theme.description ? (
                  <Typography variant="body2" sx={{ mb: 2, color: "text.secondary" }}>
                    {THEME_SELECTOR_STRINGS.themeDescription(theme)}
                  </Typography>
                ) : null}
                <ThemePreview theme={theme} />
              </CardContent>
            </CardActionArea>
          </Card>
        ))}
      </Box>
    </ResponsiveDialogShell>
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
      <Typography variant="caption" sx={{ minWidth: 60, color: "text.secondary" }}>
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
