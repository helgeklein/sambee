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
import { type ReactNode, useEffect, useId, useRef } from "react";
import {
  mobileFullscreenDrawerPaperSx,
  mobileSafeAreaAppBarSx,
  mobileSafeAreaToolbarSx,
  mobileScrollableContentSx,
  SAFE_AREA_INSET,
} from "../../theme/mobileShell";

interface ResponsiveFormDialogProps {
  open: boolean;
  onClose: () => void;
  disableClose?: boolean;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  actions: ReactNode;
  maxWidth?: DialogProps["maxWidth"];
  onKeyDown?: DialogProps["onKeyDown"];
  contentSx?: SxProps<Theme>;
  dialogZIndexOffset?: number;
}

import { useTranslation } from "react-i18next";

export function ResponsiveFormDialog({
  open,
  onClose,
  disableClose = false,
  title,
  description,
  children,
  actions,
  maxWidth = "sm",
  onKeyDown,
  contentSx,
  dialogZIndexOffset = 1,
}: ResponsiveFormDialogProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const { t } = useTranslation();
  const titleId = useId();
  const descriptionId = useId();
  const triggerElementRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(open);
  const renderedDescription = description ? (
    <Box id={descriptionId} sx={{ mb: 3 }}>
      {typeof description === "string" ? (
        <Typography variant="body2" color="text.secondary">
          {description}
        </Typography>
      ) : (
        description
      )}
    </Box>
  ) : null;

  useEffect(() => {
    if (open && !wasOpenRef.current && document.activeElement instanceof HTMLElement) {
      triggerElementRef.current = document.activeElement;
    }

    if (!open && wasOpenRef.current) {
      const triggerElement = triggerElementRef.current;
      if (triggerElement?.isConnected) {
        setTimeout(() => {
          if (triggerElement.isConnected) {
            triggerElement.focus();
          }
        }, 0);
      }
    }

    wasOpenRef.current = open;
  }, [open]);

  const handleRequestClose = () => {
    if (disableClose) {
      return;
    }

    onClose();
  };

  if (isMobile) {
    return (
      <Drawer
        anchor="right"
        open={open}
        onClose={handleRequestClose}
        sx={{ zIndex: (currentTheme) => currentTheme.zIndex.modal + dialogZIndexOffset }}
        PaperProps={{
          sx: mobileFullscreenDrawerPaperSx,
        }}
      >
        <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
          <AppBar position="static" sx={mobileSafeAreaAppBarSx}>
            <Toolbar sx={mobileSafeAreaToolbarSx}>
              <IconButton
                edge="start"
                color="inherit"
                onClick={handleRequestClose}
                aria-label={t("common.navigation.goBack")}
                disabled={disableClose}
              >
                <ArrowBackIcon />
              </IconButton>
              <Typography id={titleId} variant="h6" component="h1" sx={{ ml: 2 }}>
                {title}
              </Typography>
            </Toolbar>
          </AppBar>

          <Box
            sx={[
              {
                ...mobileScrollableContentSx,
                p: 2,
                pb: `calc(16px + ${SAFE_AREA_INSET.BOTTOM})`,
                bgcolor: "background.default",
              },
              ...(Array.isArray(contentSx) ? contentSx : contentSx ? [contentSx] : []),
            ]}
          >
            {renderedDescription}
            {children}
          </Box>

          <Box
            data-testid="responsive-form-dialog-mobile-actions"
            sx={{
              position: "sticky",
              bottom: 0,
              display: "flex",
              gap: 1,
              flexShrink: 0,
              mt: "auto",
              p: 2,
              pb: `calc(16px + ${SAFE_AREA_INSET.BOTTOM})`,
              pl: `calc(16px + ${SAFE_AREA_INSET.LEFT})`,
              pr: `calc(16px + ${SAFE_AREA_INSET.RIGHT})`,
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
      onClose={handleRequestClose}
      onKeyDown={onKeyDown}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      disableEscapeKeyDown={disableClose}
      maxWidth={maxWidth}
      fullWidth
      sx={{ zIndex: (currentTheme) => currentTheme.zIndex.modal + dialogZIndexOffset }}
      PaperProps={{
        sx: {
          bgcolor: "background.default",
        },
      }}
    >
      <DialogTitle id={titleId}>{title}</DialogTitle>
      <DialogContent sx={[{ bgcolor: "background.default" }, ...(Array.isArray(contentSx) ? contentSx : contentSx ? [contentSx] : [])]}>
        {renderedDescription}
        {children}
      </DialogContent>
      <DialogActions sx={{ bgcolor: "background.default" }}>{actions}</DialogActions>
    </Dialog>
  );
}
