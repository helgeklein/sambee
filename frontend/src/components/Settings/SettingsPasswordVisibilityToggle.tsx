import { Visibility, VisibilityOff } from "@mui/icons-material";
import { IconButton, InputAdornment } from "@mui/material";
import { settingsSubduedIconButtonSx } from "./settingsButtonStyles";

interface SettingsPasswordVisibilityToggleProps {
  visible: boolean;
  onToggle: () => void;
  showLabel: string;
  hideLabel: string;
}

export function SettingsPasswordVisibilityToggle({ visible, onToggle, showLabel, hideLabel }: SettingsPasswordVisibilityToggleProps) {
  return (
    <InputAdornment position="end">
      <IconButton
        aria-label={visible ? hideLabel : showLabel}
        onClick={onToggle}
        onMouseDown={(event) => event.preventDefault()}
        edge="end"
        sx={settingsSubduedIconButtonSx}
      >
        {visible ? <VisibilityOff /> : <Visibility />}
      </IconButton>
    </InputAdornment>
  );
}
