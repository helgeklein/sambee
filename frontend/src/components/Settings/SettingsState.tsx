import { Box, CircularProgress, type SxProps, type Theme, Typography } from "@mui/material";

interface SettingsLoadingStateProps {
  compact?: boolean;
  sx?: SxProps<Theme>;
}

interface SettingsEmptyStateProps {
  title?: string;
  description: string;
  compact?: boolean;
  sx?: SxProps<Theme>;
}

export function SettingsLoadingState({ compact = false, sx }: SettingsLoadingStateProps) {
  return (
    <Box
      sx={[
        {
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          py: compact ? 2 : 6,
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      <CircularProgress size={compact ? 24 : 40} />
    </Box>
  );
}

export function SettingsEmptyState({ title, description, compact = false, sx }: SettingsEmptyStateProps) {
  return (
    <Box
      sx={[
        {
          py: compact ? 2 : 6,
          textAlign: "center",
          maxWidth: compact ? 640 : 520,
          mx: "auto",
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      {title ? (
        <Typography variant="h6" color="text.secondary">
          {title}
        </Typography>
      ) : null}
      <Typography variant="body2" color="text.secondary" sx={{ mt: title ? 1 : 0 }}>
        {description}
      </Typography>
    </Box>
  );
}
