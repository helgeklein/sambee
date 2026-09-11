import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutlined";
import { Box, CircularProgress, InputAdornment } from "@mui/material";

interface SettingSaveStatusProps {
  pending: boolean;
  saved: boolean;
  savingLabel: string;
  savedLabel: string;
}

export function SettingSaveStatus({ pending, saved, savingLabel, savedLabel }: SettingSaveStatusProps) {
  if (!pending && !saved) return null;
  return (
    <Box
      role="status"
      aria-label={pending ? savingLabel : savedLabel}
      sx={{ width: 24, height: 24, display: "grid", placeItems: "center" }}
    >
      {pending ? <CircularProgress size={18} /> : <CheckCircleOutlineIcon color="success" fontSize="small" />}
    </Box>
  );
}

export function SettingSaveStatusAdornment(props: SettingSaveStatusProps) {
  if (!props.pending && !props.saved) return null;
  return (
    <InputAdornment position="end">
      <SettingSaveStatus {...props} />
    </InputAdornment>
  );
}
