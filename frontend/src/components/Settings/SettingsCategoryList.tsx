import {
  ChevronRight as ChevronRightIcon,
  Palette as PaletteIcon,
  PeopleAlt as PeopleAltIcon,
  Storage as StorageIcon,
  Tune as TuneIcon,
} from "@mui/icons-material";
import {
  Box,
  Divider,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  type SxProps,
  type Theme,
  Typography,
  type TypographyProps,
} from "@mui/material";
import type { KeyboardEventHandler, Ref } from "react";
import { useTranslation } from "react-i18next";
import {
  getSettingsCategoryDescription,
  getSettingsCategoryLabel,
  type SettingsCategory,
  type VisibleSettingsSection,
} from "./settingsNavigation";

type Resolvable<T> = T | ((selected: boolean, category: SettingsCategory) => T);

interface SettingsCategoryListProps {
  sections: VisibleSettingsSection[];
  onSelect: (category: SettingsCategory) => void;
  selectedCategory?: SettingsCategory;
  showDescriptions?: boolean;
  showChevron?: boolean;
  showDividers?: boolean;
  wrapItemsInListItem?: boolean;
  listRole?: string;
  listAriaLabel?: string;
  itemRole?: string;
  onItemKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  getItemRef?: (category: SettingsCategory) => Ref<HTMLDivElement> | undefined;
  getItemTabIndex?: (category: SettingsCategory) => number | undefined;
  getItemAriaSelected?: (category: SettingsCategory) => boolean | undefined;
  listSx?: SxProps<Theme>;
  sectionSx?: SxProps<Theme>;
  subheaderSx?: SxProps<Theme>;
  itemButtonSx?: Resolvable<SxProps<Theme>>;
  itemIconSx?: Resolvable<SxProps<Theme>>;
  iconGlyphSx?: SxProps<Theme>;
  primaryTypographyProps?: Resolvable<Partial<TypographyProps>>;
}

function resolveProp<T>(value: Resolvable<T> | undefined, selected: boolean, category: SettingsCategory): T | undefined {
  if (typeof value === "function") {
    return value(selected, category);
  }

  return value;
}

function renderCategoryIcon(category: SettingsCategory, iconGlyphSx?: SxProps<Theme>) {
  switch (category) {
    case "preferences":
      return <PaletteIcon sx={iconGlyphSx} />;
    case "connections":
      return <StorageIcon sx={iconGlyphSx} />;
    case "admin-users":
      return <PeopleAltIcon sx={iconGlyphSx} />;
    case "admin-system":
      return <TuneIcon sx={iconGlyphSx} />;
  }
}

export function SettingsCategoryList({
  sections,
  onSelect,
  selectedCategory,
  showDescriptions = false,
  showChevron = false,
  showDividers = false,
  wrapItemsInListItem = false,
  listRole,
  listAriaLabel,
  itemRole,
  onItemKeyDown,
  getItemRef,
  getItemTabIndex,
  getItemAriaSelected,
  listSx,
  sectionSx,
  subheaderSx,
  itemButtonSx,
  itemIconSx,
  iconGlyphSx,
  primaryTypographyProps,
}: SettingsCategoryListProps) {
  useTranslation();

  return (
    <List sx={listSx} role={listRole} aria-label={listAriaLabel}>
      {sections.map((section) => (
        <Box key={section.section} sx={sectionSx}>
          <ListSubheader sx={subheaderSx}>{section.label}</ListSubheader>
          {section.categories.map((category) => {
            const isSelected = selectedCategory === category;
            const button = (
              <ListItemButton
                ref={getItemRef?.(category)}
                onClick={() => onSelect(category)}
                onKeyDown={onItemKeyDown}
                selected={isSelected}
                tabIndex={getItemTabIndex?.(category)}
                role={itemRole}
                aria-selected={getItemAriaSelected?.(category)}
                sx={resolveProp(itemButtonSx, isSelected, category)}
              >
                <ListItemIcon sx={resolveProp(itemIconSx, isSelected, category)}>{renderCategoryIcon(category, iconGlyphSx)}</ListItemIcon>
                <ListItemText
                  primary={
                    <Typography {...resolveProp(primaryTypographyProps, isSelected, category)}>
                      {getSettingsCategoryLabel(category)}
                    </Typography>
                  }
                  secondary={showDescriptions ? getSettingsCategoryDescription(category) : undefined}
                />
                {showChevron && <ChevronRightIcon sx={{ color: "text.secondary" }} />}
              </ListItemButton>
            );

            if (wrapItemsInListItem) {
              return (
                <Box key={category}>
                  <ListItem disablePadding>{button}</ListItem>
                  {showDividers && <Divider />}
                </Box>
              );
            }

            return (
              <Box key={category}>
                {button}
                {showDividers && <Divider />}
              </Box>
            );
          })}
        </Box>
      ))}
    </List>
  );
}
