import CloseIcon from "@mui/icons-material/Close";
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Stack, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { logger } from "../../services/logger";
import type { ViewerComponentLoadResult, ViewerComponent as ViewerComponentType } from "../../utils/FileTypeRegistry";
import { getViewerComponentLoadResult } from "../../utils/FileTypeRegistry";

interface DynamicViewerProps {
  connectionId: string;
  viewInfo: {
    path: string;
    mimeType: string;
    images?: string[];
    currentIndex?: number;
    sessionId: string;
  };
  onClose: () => void;
  onIndexChange?: (index: number) => void;
}

type DynamicViewerLoadState =
  | { status: "loading" }
  | { status: "loaded"; component: ViewerComponentType }
  | { status: "unsupported" }
  | { status: "failed"; error: unknown };

function getViewerLoadFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return `${error.message} The viewer code could not be loaded.`;
  }

  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return `${message} The viewer code could not be loaded.`;
    }
  }

  return "The viewer code could not be loaded. This can happen if the backend or asset host is temporarily unavailable.";
}

interface ViewerFallbackDialogProps {
  mode: "unsupported" | "failed";
  path: string;
  error?: unknown;
  onClose: () => void;
  onRetry?: () => void;
}

function ViewerFallbackDialog({ mode, path, error, onClose, onRetry }: ViewerFallbackDialogProps) {
  const filename = path.split("/").pop() || path;
  const message =
    mode === "failed"
      ? getViewerLoadFailureMessage(error)
      : "This file type does not have an available viewer in the current frontend runtime.";

  return (
    <Dialog open={true} onClose={onClose} fullScreen aria-labelledby="viewer-fallback-title">
      <DialogTitle id="viewer-fallback-title" sx={{ pr: 7 }}>
        {mode === "failed" ? "Viewer unavailable" : "Viewer unsupported"}
        <IconButton aria-label="Close viewer error" onClick={onClose} size="small" sx={{ position: "absolute", top: 12, right: 12 }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ maxWidth: 640, pt: 1 }}>
          <Typography variant="h6">{filename}</Typography>
          <Alert severity={mode === "failed" ? "warning" : "info"}>{message}</Alert>
          <Box>
            <Typography variant="body2" color="text.secondary">
              The file browser is still available. You can close this dialog and continue working elsewhere in the app.
            </Typography>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        {mode === "failed" && onRetry ? <Button onClick={onRetry}>Retry</Button> : null}
        <Button variant="contained" onClick={onClose}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}

//
// DynamicViewer
//
export function DynamicViewer({ connectionId, viewInfo, onClose, onIndexChange }: DynamicViewerProps) {
  const [loadState, setLoadState] = useState<DynamicViewerLoadState>({ status: "loading" });
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    let mounted = true;
    const loadAttempt = retryToken;
    setLoadState({ status: "loading" });

    logger.info(
      "DynamicViewer: Loading viewer component",
      {
        loadAttempt,
        mimeType: viewInfo.mimeType,
        sessionId: viewInfo.sessionId,
      },
      "viewer"
    );

    getViewerComponentLoadResult(viewInfo.mimeType).then((result: ViewerComponentLoadResult) => {
      if (mounted) {
        logger.info("DynamicViewer: Viewer component loaded", {
          mimeType: viewInfo.mimeType,
          componentFound: result.status === "loaded",
          resultStatus: result.status,
          sessionId: viewInfo.sessionId,
        });
        if (result.status === "loaded") {
          setLoadState({ status: "loaded", component: result.component });
        } else if (result.status === "failed") {
          setLoadState({ status: "failed", error: result.error });
        } else {
          setLoadState({ status: "unsupported" });
        }
      }
    });

    return () => {
      mounted = false;
    };
  }, [retryToken, viewInfo.mimeType, viewInfo.sessionId]);

  useEffect(() => {
    if (loadState.status !== "loaded") {
      return;
    }

    logger.debug(
      "DynamicViewer: Rendering viewer component",
      {
        index: viewInfo.currentIndex,
        path: viewInfo.path,
        mimeType: viewInfo.mimeType,
        sessionId: viewInfo.sessionId,
      },
      "viewer"
    );
  }, [loadState, viewInfo.mimeType, viewInfo.path, viewInfo.currentIndex, viewInfo.sessionId]);

  if (loadState.status === "failed") {
    return (
      <ViewerFallbackDialog
        mode="failed"
        path={viewInfo.path}
        error={loadState.error}
        onClose={onClose}
        onRetry={() => setRetryToken((value) => value + 1)}
      />
    );
  }

  if (loadState.status === "unsupported") {
    return <ViewerFallbackDialog mode="unsupported" path={viewInfo.path} onClose={onClose} />;
  }

  if (loadState.status !== "loaded") {
    logger.debug(
      "DynamicViewer: Viewer component still loading",
      {
        mimeType: viewInfo.mimeType,
        sessionId: viewInfo.sessionId,
      },
      "viewer"
    );
    return null;
  }

  const ViewerComponent = loadState.component;

  return (
    <ViewerComponent
      connectionId={connectionId}
      path={viewInfo.path}
      onClose={onClose}
      images={viewInfo.images}
      currentIndex={viewInfo.currentIndex}
      onCurrentIndexChange={onIndexChange}
      sessionId={viewInfo.sessionId}
    />
  );
}
