import { alpha, Box, Tooltip } from "@mui/material";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { DIALOG_FORM_SURFACE_CSS_VARIABLE, getModeAdjustedSurfaceColor } from "../../theme/palette";
import { abbreviateFileName, abbreviatePath } from "../../utils/pathDisplay";

export type DialogOperationIdentifierKind = "fileName" | "path";

interface DialogIdentifierDisplayProps {
  value: string;
  kind: DialogOperationIdentifierKind;
  testId?: string;
}

function measureText(element: HTMLElement, value: string): number {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return value.length;
  const style = getComputedStyle(element);
  context.font = `${style.fontStyle} ${style.fontVariant} ${style.fontWeight} ${style.fontSize}/${style.lineHeight} ${style.fontFamily}`;
  return context.measureText(value).width;
}

export function DialogIdentifierDisplay({ value, kind, testId }: DialogIdentifierDisplayProps) {
  const valueRef = useRef<HTMLElement>(null);
  const [availableWidth, setAvailableWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const element = valueRef.current;
    if (!element) return;
    const updateWidth = () => setAvailableWidth(element.getBoundingClientRect().width);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!document.fonts) return;
    void document.fonts.ready.then(() => {
      const element = valueRef.current;
      if (element) setAvailableWidth(element.getBoundingClientRect().width);
    });
  }, []);

  const displayValue =
    availableWidth === null || availableWidth <= 0
      ? value
      : kind === "fileName"
        ? abbreviateFileName(value, availableWidth, (text) => measureText(valueRef.current!, text))
        : abbreviatePath(value, availableWidth, (text) => measureText(valueRef.current!, text));
  const isShortened = displayValue !== value;
  const identifier = (
    <Box component="bdi" data-testid={testId} dir="auto" aria-label={value} sx={{ display: "block", maxWidth: "100%", minWidth: 0 }}>
      <Box
        component="code"
        ref={valueRef}
        sx={{
          bgcolor: (theme) =>
            `var(${DIALOG_FORM_SURFACE_CSS_VARIABLE}, ${getModeAdjustedSurfaceColor(theme.palette.background.default, theme.palette.mode)})`,
          border: (theme) => `1px solid ${alpha(theme.palette.text.primary, 0.2)}`,
          borderRadius: 0.5,
          color: "text.primary",
          display: "block",
          fontFamily: "monospace",
          fontSize: "0.875em",
          maxWidth: "100%",
          minWidth: 0,
          overflow: "hidden",
          px: 0.5,
          py: 0.125,
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {displayValue}
      </Box>
    </Box>
  );

  return isShortened ? (
    <Tooltip title={value} disableFocusListener disableTouchListener>
      {identifier}
    </Tooltip>
  ) : (
    identifier
  );
}
