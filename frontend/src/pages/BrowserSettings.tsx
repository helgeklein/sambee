import { Box, FormControlLabel, Switch, Typography, useMediaQuery, useTheme } from "@mui/material";
import { useQuickNavIncludeDotDirectoriesPreference } from "./FileBrowser/preferences";

const BROWSER_SETTINGS_COPY = {
  desktopTitle: "Browser",
  sectionTitle: "Quick Navigation",
  includeDotDirectoriesLabel: "Include dot directories in quick nav",
  includeDotDirectoriesDescription: "Show folders like .git, .cache, and other dot-prefixed directories in quick navigation results.",
};

export function BrowserSettings() {
  const [includeDotDirectories, setIncludeDotDirectories] = useQuickNavIncludeDotDirectoriesPreference();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  const content = (
    <Box
      sx={{
        px: { xs: 2, sm: 3, md: 4 },
        py: 2,
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      {!isMobile && (
        <Typography variant="h5" fontWeight="medium">
          {BROWSER_SETTINGS_COPY.desktopTitle}
        </Typography>
      )}
      <Box>
        <Typography variant="subtitle1" fontWeight="medium" sx={{ mb: 1 }}>
          {BROWSER_SETTINGS_COPY.sectionTitle}
        </Typography>
        <FormControlLabel
          control={<Switch checked={includeDotDirectories} onChange={(_event, checked) => setIncludeDotDirectories(checked)} />}
          label={BROWSER_SETTINGS_COPY.includeDotDirectoriesLabel}
          sx={{ alignItems: "flex-start", m: 0 }}
          slotProps={{
            typography: {
              sx: {
                fontWeight: 500,
                mt: 0.25,
              },
            },
          }}
        />
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1, maxWidth: 640 }}>
          {BROWSER_SETTINGS_COPY.includeDotDirectoriesDescription}
        </Typography>
      </Box>
    </Box>
  );

  if (isMobile) {
    return <Box sx={{ height: "100%", bgcolor: "background.default" }}>{content}</Box>;
  }

  return <Box sx={{ overflow: "auto", height: "100%" }}>{content}</Box>;
}
