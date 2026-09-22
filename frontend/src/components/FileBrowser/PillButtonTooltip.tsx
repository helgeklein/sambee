import { Tooltip } from "@mui/material";
import type { ReactElement } from "react";
import { withShortcut } from "../../hooks/useKeyboardShortcuts";

interface PillButtonTooltipProps {
  label: string;
  shortcut?: Parameters<typeof withShortcut>[0];
  shortcutLabel?: string;
  children: ReactElement;
}

/** Provides a consistent accessible tooltip for toolbar pill buttons. */
export function PillButtonTooltip({ label, shortcut, shortcutLabel, children }: PillButtonTooltipProps) {
  const title = shortcut ? withShortcut(shortcut) : shortcutLabel ? `${label} (${shortcutLabel})` : label;

  return (
    <Tooltip describeChild title={title}>
      {children}
    </Tooltip>
  );
}
