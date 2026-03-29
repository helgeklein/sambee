import type { SxProps, Theme } from "@mui/material";

export const adminDialogSplitActionRowSx: SxProps<Theme> = {
  width: "100%",
  display: "flex",
  gap: 1,
  alignItems: "center",
  justifyContent: "space-between",
  flexWrap: "wrap",
};

export const adminDialogEndActionRowSx: SxProps<Theme> = {
  width: "100%",
  display: "flex",
  gap: 1,
  alignItems: "center",
  justifyContent: "flex-end",
  flexWrap: "wrap",
};

export const adminDialogActionButtonSx: SxProps<Theme> = {
  flex: { xs: 1, sm: "0 0 auto" },
  minWidth: { sm: 132 },
};

export const adminDialogActionGroupSx: SxProps<Theme> = {
  display: "flex",
  gap: 1,
  width: { xs: "100%", sm: "auto" },
  flexWrap: "wrap",
  justifyContent: "flex-end",
};

export const adminDialogStandaloneSecondaryActionSx: SxProps<Theme> = {
  width: { xs: "100%", sm: "auto" },
  minWidth: { sm: 132 },
};
