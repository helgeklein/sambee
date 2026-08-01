import { Stack, type SxProps, type Theme } from "@mui/material";
import type { ReactNode } from "react";

export const SETTINGS_SECTION_GAP = 4;
export const SETTINGS_SUBSECTION_GAP = 3;

type SettingsSectionListLevel = "section" | "subsection";

interface SettingsSectionListProps {
  children: ReactNode;
  level?: SettingsSectionListLevel;
  sx?: SxProps<Theme>;
}

/** Provides consistent vertical rhythm between sibling settings sections. */
export function SettingsSectionList({ children, level = "section", sx }: SettingsSectionListProps) {
  return (
    <Stack spacing={level === "section" ? SETTINGS_SECTION_GAP : SETTINGS_SUBSECTION_GAP} sx={sx}>
      {children}
    </Stack>
  );
}
