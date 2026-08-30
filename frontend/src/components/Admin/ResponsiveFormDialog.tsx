import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import CloseIcon from "@mui/icons-material/Close";
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
import { type ReactNode, type Ref, useEffect, useId, useRef } from "react";
import {
  mobileFullscreenDrawerPaperSx,
  mobileSafeAreaAppBarSx,
  mobileSafeAreaToolbarSx,
  mobileScrollableContentSx,
  SAFE_AREA_INSET,
} from "../../theme/mobileShell";
import { DIALOG_FORM_SURFACE_CSS_VARIABLE, DIALOG_SURFACE_CSS_VARIABLE, getDialogSurfaceTokens } from "../../theme/palette";

interface ResponsiveFormDialogProps {
  open: boolean;
  onClose: () => void;
  disableClose?: boolean;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  showCloseButton?: boolean;
  closeButtonAriaLabel?: string;
  maxWidth?: DialogProps["maxWidth"];
  onKeyDown?: DialogProps["onKeyDown"];
  contentSx?: SxProps<Theme>;
  paperSx?: SxProps<Theme>;
  paperRef?: Ref<HTMLDivElement>;
  paperOverlay?: ReactNode;
  fullWidth?: boolean;
  dialogZIndexOffset?: number;
  mobileActionLabel?: string;
  disableAutoFocus?: boolean;
  disableEnforceFocus?: boolean;
  disableRestoreFocus?: boolean;
  onTransitionEntered?: () => void;
  onTransitionExited?: () => void;
}

import { useTranslation } from "react-i18next";

export const responsiveFormDialogContentPaddingSx: SxProps<Theme> = {
  px: { xs: 2, sm: 3 },
  py: 2,
};

export function ResponsiveFormDialog({
  open,
  onClose,
  disableClose = false,
  title,
  description,
  children,
  actions,
  showCloseButton = false,
  closeButtonAriaLabel,
  maxWidth = "sm",
  onKeyDown,
  contentSx,
  paperSx,
  paperRef,
  paperOverlay,
  fullWidth = true,
  dialogZIndexOffset = 1,
  mobileActionLabel,
  disableAutoFocus = false,
  disableEnforceFocus = false,
  disableRestoreFocus = false,
  onTransitionEntered,
  onTransitionExited,
}: ResponsiveFormDialogProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const { t } = useTranslation();
  const titleId = useId();
  const descriptionId = useId();
  const triggerElementRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(open);
  const escapeCloseHandledRef = useRef(false);
  const renderedDescription = description ? (
    <Box id={descriptionId} sx={{ mb: 3 }}>
      {typeof description === "string" ? (
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          {description}
        </Typography>
      ) : (
        description
      )}
    </Box>
  ) : null;

  useEffect(() => {
    if (!disableRestoreFocus && open && !wasOpenRef.current && document.activeElement instanceof HTMLElement) {
      triggerElementRef.current = document.activeElement;
    }

    if (!disableRestoreFocus && !open && wasOpenRef.current) {
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
  }, [disableRestoreFocus, open]);

  const handleRequestClose = () => {
    if (disableClose) {
      return;
    }

    onClose();
  };

  const handleDialogClose = (_event: unknown, reason: string) => {
    if (reason === "escapeKeyDown") {
      if (escapeCloseHandledRef.current) {
        escapeCloseHandledRef.current = false;
        return;
      }
    }

    handleRequestClose();
  };

  const handleDrawerClose = (_event: unknown, reason: string) => {
    if (reason === "escapeKeyDown") {
      if (escapeCloseHandledRef.current) {
        escapeCloseHandledRef.current = false;
        return;
      }
    }

    handleRequestClose();
  };

  const handleShellKeyDown: DialogProps["onKeyDown"] = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (disableClose) {
        return;
      }
      escapeCloseHandledRef.current = true;
      onClose();
      return;
    }

    onKeyDown?.(event);
  };

  if (isMobile) {
    return (
      <Drawer
        anchor="right"
        open={open}
        onClose={handleDrawerClose}
        onKeyDown={handleShellKeyDown}
        disableAutoFocus={disableAutoFocus}
        disableEnforceFocus={disableEnforceFocus}
        disableRestoreFocus={disableRestoreFocus}
        sx={{ zIndex: (currentTheme) => currentTheme.zIndex.modal + dialogZIndexOffset }}
        slotProps={{
          transition: {
            onEntered: onTransitionEntered,
            onExited: onTransitionExited,
          },
          paper: {
            sx: (currentTheme) => {
              const dialogSurfaces = getDialogSurfaceTokens(currentTheme.palette.background.default, currentTheme.palette.mode);

              return {
                ...mobileFullscreenDrawerPaperSx,
                backgroundColor: dialogSurfaces.paper,
                [DIALOG_SURFACE_CSS_VARIABLE]: dialogSurfaces.paper,
                [DIALOG_FORM_SURFACE_CSS_VARIABLE]: dialogSurfaces.form,
              };
            },
          },
        }}
      >
        <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
          <AppBar position="static" sx={mobileSafeAreaAppBarSx}>
            <Toolbar sx={mobileSafeAreaToolbarSx}>
              {!showCloseButton && (
                <IconButton
                  edge="start"
                  color="inherit"
                  onClick={handleRequestClose}
                  aria-label={mobileActionLabel ?? t("common.navigation.goBack")}
                  disabled={disableClose}
                >
                  <ArrowBackIcon />
                </IconButton>
              )}
              <Typography id={titleId} variant="h6" component="h1" sx={{ flex: 1, ml: showCloseButton ? 0 : 2 }}>
                {title}
              </Typography>
              {showCloseButton && (
                <IconButton
                  edge="end"
                  color="inherit"
                  onClick={handleRequestClose}
                  aria-label={closeButtonAriaLabel ?? t("common.actions.close")}
                  disabled={disableClose}
                >
                  <CloseIcon />
                </IconButton>
              )}
            </Toolbar>
          </AppBar>

          <Box
            sx={[
              responsiveFormDialogContentPaddingSx,
              {
                ...mobileScrollableContentSx,
                pb: `calc(16px + ${SAFE_AREA_INSET.BOTTOM})`,
              },
              ...(Array.isArray(contentSx) ? contentSx : contentSx ? [contentSx] : []),
            ]}
          >
            {renderedDescription}
            {children}
          </Box>

          {actions && (
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
                zIndex: 1,
              }}
            >
              {actions}
            </Box>
          )}
        </Box>
      </Drawer>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={handleDialogClose}
      onKeyDown={handleShellKeyDown}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      maxWidth={maxWidth}
      fullWidth={fullWidth}
      disableAutoFocus={disableAutoFocus}
      disableEnforceFocus={disableEnforceFocus}
      disableRestoreFocus={disableRestoreFocus}
      slotProps={{
        paper: {
          ref: paperRef,
          sx: paperSx,
        },
        transition: {
          onEntered: onTransitionEntered,
          onExited: onTransitionExited,
        },
      }}
      sx={{ zIndex: (currentTheme) => currentTheme.zIndex.modal + dialogZIndexOffset }}
    >
      <DialogTitle id={titleId} sx={showCloseButton ? { pr: 7 } : undefined}>
        {title}
      </DialogTitle>
      {showCloseButton && (
        <IconButton
          onClick={handleRequestClose}
          aria-label={closeButtonAriaLabel ?? t("common.actions.close")}
          disabled={disableClose}
          size="small"
          sx={{ position: "absolute", right: 8, top: 8, zIndex: 1 }}
        >
          <CloseIcon />
        </IconButton>
      )}
      {paperOverlay}
      <DialogContent
        sx={[
          {
            // MUI removes top padding after a DialogTitle. Restore it so the
            // first line of dialog content is never visually clipped.
            ".MuiDialogTitle-root + &&": { pt: 2 },
          },
          responsiveFormDialogContentPaddingSx,
          ...(Array.isArray(contentSx) ? contentSx : contentSx ? [contentSx] : []),
        ]}
      >
        {renderedDescription}
        {children}
      </DialogContent>
      {actions && (
        <DialogActions data-testid="responsive-form-dialog-desktop-actions" sx={{ borderTop: 1, borderColor: "divider" }}>
          {actions}
        </DialogActions>
      )}
    </Dialog>
  );
}
