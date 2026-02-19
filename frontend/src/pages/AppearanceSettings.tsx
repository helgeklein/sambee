//
// AppearanceSettings
//

import { Box, Divider, List, ListItem, ListItemButton, Radio, Typography, useMediaQuery, useTheme } from "@mui/material";
import { useSambeeTheme } from "../theme";

/**
 * ThemePreview
 *
 * Displays color swatches for a theme preview
 */
function ThemePreview({
  theme,
}: {
  theme: {
    primary: { main: string };
    background?: { default?: string };
    text?: { primary?: string };
    components?: { link?: { main: string } };
  };
}) {
  return (
    <Box sx={{ display: "flex", gap: 1, mt: 1.5 }}>
      <Box
        sx={{
          width: 40,
          height: 40,
          borderRadius: 1,
          bgcolor: theme.background?.default || "#F6F1E8",
          border: "1px solid",
          borderColor: "divider",
        }}
      />
      <Box
        sx={{
          width: 40,
          height: 40,
          borderRadius: 1,
          bgcolor: theme.text?.primary || "#1F262B",
          border: "1px solid",
          borderColor: "divider",
        }}
      />
      <Box
        sx={{
          width: 40,
          height: 40,
          borderRadius: 1,
          bgcolor: theme.primary.main,
        }}
      />
      <Box
        sx={{
          width: 40,
          height: 40,
          borderRadius: 1,
          bgcolor: theme.components?.link?.main || theme.primary.main,
          border: "1px solid",
          borderColor: "divider",
        }}
      />
    </Box>
  );
}

/**
 * AppearanceSettings
 *
 * Appearance settings content for theme selection.
 * Responsive: edge-to-edge list on mobile, cards on desktop.
 */
export function AppearanceSettings() {
  const { currentTheme, availableThemes, setThemeById } = useSambeeTheme();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  const handleSelect = (themeId: string) => {
    setThemeById(themeId);
  };

  // Mobile: Edge-to-edge list design
  if (isMobile) {
    return (
      <Box sx={{ height: "100%", bgcolor: "background.default" }}>
        <Box sx={{ px: 2, pt: 2, pb: 1.5 }}>
          <Typography
            variant="subtitle2"
            color="text.secondary"
            fontWeight="medium"
            sx={{ textTransform: "uppercase", letterSpacing: 0.5 }}
          >
            Theme
          </Typography>
        </Box>
        <List sx={{ py: 0 }}>
          {availableThemes.map((theme) => (
            <Box key={theme.id}>
              <ListItem disablePadding>
                <ListItemButton onClick={() => handleSelect(theme.id)} sx={{ py: 2, px: 2 }}>
                  <Box sx={{ display: "flex", alignItems: "flex-start", width: "100%", gap: 2 }}>
                    <Radio checked={currentTheme.id === theme.id} sx={{ mt: -0.5 }} />
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="h6" fontWeight="medium">
                        {theme.name}
                      </Typography>
                      {theme.description && (
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                          {theme.description}
                        </Typography>
                      )}
                      <ThemePreview theme={theme} />
                    </Box>
                  </Box>
                </ListItemButton>
              </ListItem>
              <Divider />
            </Box>
          ))}
        </List>
      </Box>
    );
  }

  // Desktop: Card grid layout
  return (
    <Box sx={{ px: { xs: 2, sm: 3, md: 4 }, py: 2, overflow: "auto", height: "100%" }}>
      <Typography variant="h5" fontWeight="medium" sx={{ mb: 3 }}>
        Appearance
      </Typography>
      <Typography variant="subtitle1" fontWeight="medium" sx={{ mb: 2 }}>
        Theme
      </Typography>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", md: "repeat(3, 1fr)" },
          gap: 2,
        }}
      >
        {availableThemes.map((themeOption) => (
          <Box
            key={themeOption.id}
            onClick={() => handleSelect(themeOption.id)}
            sx={{
              p: 3,
              border: currentTheme.id === themeOption.id ? 2 : 1,
              borderColor: currentTheme.id === themeOption.id ? "primary.main" : "divider",
              borderRadius: 1,
              cursor: "pointer",
              transition: "all 0.2s",
              "&:hover": {
                borderColor: currentTheme.id === themeOption.id ? "primary.main" : "text.secondary",
                bgcolor: "action.selected",
              },
            }}
          >
            <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
              <Radio checked={currentTheme.id === themeOption.id} />
              <Typography variant="h6" sx={{ ml: 1 }}>
                {themeOption.name}
              </Typography>
            </Box>
            {themeOption.description && (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {themeOption.description}
              </Typography>
            )}
            <ThemePreview theme={themeOption} />
          </Box>
        ))}
      </Box>
    </Box>
  );
}
