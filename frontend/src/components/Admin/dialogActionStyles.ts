import type { SxProps, Theme } from "@mui/material";

export const adminDialogSplitActionRowSx = {
  width: "100%",
  display: "flex",
  gap: 1,
  alignItems: "center",
  justifyContent: "space-between",
  flexWrap: "wrap",
} satisfies SxProps<Theme>;

export const adminDialogEndActionRowSx = {
  width: "100%",
  display: "flex",
  gap: 1,
  alignItems: "center",
  justifyContent: "flex-end",
  flexWrap: "wrap",
} satisfies SxProps<Theme>;

export const adminDialogActionButtonSx = {
  flex: { xs: 1, sm: "0 0 auto" },
  minWidth: { sm: 132 },
} satisfies SxProps<Theme>;

export const adminDialogActionGroupSx = {
  display: "flex",
  gap: 1,
  width: { xs: "100%", sm: "auto" },
  flexWrap: "wrap",
  justifyContent: "flex-end",
} satisfies SxProps<Theme>;

export const adminDialogStandaloneSecondaryActionSx = {
  width: { xs: "100%", sm: "auto" },
  minWidth: { sm: 132 },
} satisfies SxProps<Theme>;
