import { Box, Typography } from "@mui/material";
import { DialogIdentifierDisplay, type DialogOperationIdentifierKind } from "./DialogIdentifierDisplay";

interface DialogOperationContextEntry {
  label: string;
  value: string;
  kind: DialogOperationIdentifierKind;
  testId?: string;
}

interface DialogOperationContextProps {
  entries: readonly DialogOperationContextEntry[];
  ariaLabel?: string;
}

export function DialogOperationContext({ entries, ariaLabel }: DialogOperationContextProps) {
  return (
    <Box component="section" aria-label={ariaLabel} sx={{ minWidth: 0 }}>
      <Box component="dl" sx={{ display: "flex", flexDirection: "column", gap: 1, m: 0, minWidth: 0 }}>
        {entries.map((entry) => (
          <Box component="div" key={`${entry.label}\u0000${entry.value}`} sx={{ minWidth: 0 }}>
            <Typography component="dt" variant="body2" sx={{ color: (theme) => theme.palette.text.secondary, mb: 0.25 }}>
              {entry.label}:
            </Typography>
            <Box component="dd" sx={{ m: 0, minWidth: 0 }}>
              <DialogIdentifierDisplay value={entry.value} kind={entry.kind} testId={entry.testId} />
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
