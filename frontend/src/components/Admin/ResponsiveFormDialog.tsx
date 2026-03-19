import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import {
  AppBar,
  Box,
  Dialog,
  DialogActions,
  DialogContent,
  type DialogProps,
  DialogTitle,
  Drawer,
  IconButton,
  type SxProps,
  type Theme,
  Toolbar,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import type { ReactNode } from "react";

interface ResponsiveFormDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  actions: ReactNode;
  maxWidth?: DialogProps["maxWidth"];
  onKeyDown?: DialogProps["onKeyDown"];
  contentSx?: SxProps<Theme>;
  dialogZIndexOffset?: number;
}

export function ResponsiveFormDialog({
  open,
  onClose,
  title,
  children,
  actions,
  maxWidth = "sm",
  onKeyDown,
  contentSx,
  dialogZIndexOffset = 1,
}: ResponsiveFormDialogProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  if (isMobile) {
    return (
      <Drawer
        anchor="right"
        open={open}
        onClose={onClose}
        sx={{ zIndex: (currentTheme) => currentTheme.zIndex.modal + dialogZIndexOffset }}
        PaperProps={{
          sx: {
            width: "100%",
            height: "100%",
          },
        }}
      >
        <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
          <AppBar position="static">
            <Toolbar sx={{ px: { xs: 1, sm: 2 } }}>
              <IconButton edge="start" color="inherit" onClick={onClose} aria-label="Go back">
                <ArrowBackIcon />
              </IconButton>
              <Typography variant="h6" component="h1" sx={{ ml: 2 }}>
                {title}
              </Typography>
            </Toolbar>
          </AppBar>

          <Box
            sx={[
              {
                flex: 1,
                overflow: "auto",
                p: 2,
                pb: "calc(80px + env(safe-area-inset-bottom))",
                bgcolor: "background.default",
              },
              ...(Array.isArray(contentSx) ? contentSx : contentSx ? [contentSx] : []),
            ]}
          >
            {children}
          </Box>

          <Box
            sx={{
              position: "fixed",
              bottom: 0,
              left: 0,
              right: 0,
              display: "flex",
              gap: 1,
              p: 2,
              pb: "calc(16px + env(safe-area-inset-bottom))",
              pl: "calc(16px + env(safe-area-inset-left))",
              pr: "calc(16px + env(safe-area-inset-right))",
              borderTop: 1,
              borderColor: "divider",
              bgcolor: "background.default",
              zIndex: 1,
            }}
          >
            {actions}
          </Box>
        </Box>
      </Drawer>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      onKeyDown={onKeyDown}
      maxWidth={maxWidth}
      fullWidth
      sx={{ zIndex: (currentTheme) => currentTheme.zIndex.modal + dialogZIndexOffset }}
      PaperProps={{
        sx: {
          bgcolor: "background.default",
        },
      }}
    >
      <DialogTitle>{title}</DialogTitle>
      <DialogContent sx={[{ bgcolor: "background.default" }, ...(Array.isArray(contentSx) ? contentSx : contentSx ? [contentSx] : [])]}>
        {children}
      </DialogContent>
      <DialogActions sx={{ bgcolor: "background.default" }}>{actions}</DialogActions>
    </Dialog>
  );
}
