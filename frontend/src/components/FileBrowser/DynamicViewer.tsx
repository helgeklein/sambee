import { useEffect, useState } from "react";
import { logger } from "../../services/logger";
import type { ViewerComponent as ViewerComponentType } from "../../utils/FileTypeRegistry";
import { getViewerComponent } from "../../utils/FileTypeRegistry";

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

//
// DynamicViewer
//
export function DynamicViewer({ connectionId, viewInfo, onClose, onIndexChange }: DynamicViewerProps) {
  const [ViewerComponent, setViewerComponent] = useState<ViewerComponentType | null>(null);

  useEffect(() => {
    let mounted = true;

    logger.info(
      "DynamicViewer: Loading viewer component",
      {
        mimeType: viewInfo.mimeType,
        sessionId: viewInfo.sessionId,
      },
      "viewer"
    );

    getViewerComponent(viewInfo.mimeType).then((component) => {
      if (mounted) {
        logger.info("DynamicViewer: Viewer component loaded", {
          mimeType: viewInfo.mimeType,
          componentFound: !!component,
          sessionId: viewInfo.sessionId,
        });
        if (component) {
          setViewerComponent(() => component);
        }
      }
    });

    return () => {
      mounted = false;
    };
  }, [viewInfo.mimeType, viewInfo.sessionId]);

  useEffect(() => {
    if (!ViewerComponent) {
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
  }, [ViewerComponent, viewInfo.mimeType, viewInfo.path, viewInfo.currentIndex, viewInfo.sessionId]);

  if (!ViewerComponent) {
    logger.debug(
      "DynamicViewer: No viewer component yet",
      {
        mimeType: viewInfo.mimeType,
        sessionId: viewInfo.sessionId,
      },
      "viewer"
    );
    return null;
  }

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
