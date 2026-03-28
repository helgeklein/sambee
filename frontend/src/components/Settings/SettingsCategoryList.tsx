import {
  ChevronRight as ChevronRightIcon,
  FolderOpen as FolderOpenIcon,
  Palette as PaletteIcon,
  PeopleAlt as PeopleAltIcon,
  Storage as StorageIcon,
  Tune as TuneIcon,
  Usb as UsbIcon,
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
import {
  getSettingsCategoryDescription,
  getSettingsCategoryLabel,
  type SettingsNavItem,
  type VisibleSettingsSection,
} from "./settingsNavigation";

type Resolvable<T> = T | ((selected: boolean, item: SettingsNavItem) => T);

const SETTINGS_PARENT_ICON_GLYPH_SX: SxProps<Theme> = {
  fontSize: {
    xs: 24,
    sm: 22,
  },
};
const SETTINGS_PARENT_TYPOGRAPHY_PROPS: Partial<TypographyProps> = {
  variant: "body1",
  sx: {
    fontSize: "1rem",
  },
};
const SETTINGS_SUBHEADER_SX: SxProps<Theme> = {
  bgcolor: "transparent",
  fontWeight: 600,
  fontSize: "12px",
  lineHeight: 2.5,
  textTransform: "uppercase",
  letterSpacing: 0.8,
};

interface SettingsCategoryListProps {
  sections: VisibleSettingsSection[];
  onSelect: (item: SettingsNavItem) => void;
  selectedItem?: SettingsNavItem;
  showDescriptions?: boolean;
  showChevron?: boolean;
  showDividers?: boolean;
  wrapItemsInListItem?: boolean;
  listRole?: string;
  listAriaLabel?: string;
  itemRole?: string;
  onItemKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  getItemRef?: (item: SettingsNavItem) => Ref<HTMLDivElement> | undefined;
  getItemTabIndex?: (item: SettingsNavItem) => number | undefined;
  getItemAriaSelected?: (item: SettingsNavItem) => boolean | undefined;
  listSx?: SxProps<Theme>;
  sectionSx?: SxProps<Theme>;
  subheaderSx?: SxProps<Theme>;
  itemButtonSx?: Resolvable<SxProps<Theme>>;
  itemIconSx?: Resolvable<SxProps<Theme>>;
  iconGlyphSx?: SxProps<Theme>;
  primaryTypographyProps?: Resolvable<Partial<TypographyProps>>;
}

function resolveProp<T>(value: Resolvable<T> | undefined, selected: boolean, item: SettingsNavItem): T | undefined {
  if (typeof value === "function") {
    return (value as (selected: boolean, item: SettingsNavItem) => T)(selected, item);
  }

  return value;
}

function appendSx(base: SxProps<Theme> | undefined, extra: SxProps<Theme>): SxProps<Theme> {
  if (!base) {
    return extra;
  }

  return (Array.isArray(base) ? [...base, extra] : [base, extra]) as SxProps<Theme>;
}

function mergeTypographyProps(base: Partial<TypographyProps>, extra: Partial<TypographyProps> | undefined): Partial<TypographyProps> {
  if (!extra) {
    return base;
  }

  return {
    ...base,
    ...extra,
    sx: extra.sx ? appendSx(base.sx as SxProps<Theme> | undefined, extra.sx as SxProps<Theme>) : base.sx,
  };
}

function renderCategoryIcon(item: SettingsNavItem, iconGlyphSx?: SxProps<Theme>) {
  switch (item) {
    case "appearance":
      return <PaletteIcon sx={iconGlyphSx} />;
    case "file-browser":
      return <FolderOpenIcon sx={iconGlyphSx} />;
    case "connections":
      return <StorageIcon sx={iconGlyphSx} />;
    case "local-drives":
      return <UsbIcon sx={iconGlyphSx} />;
    case "admin-users":
      return <PeopleAltIcon sx={iconGlyphSx} />;
    case "admin-system":
      return <TuneIcon sx={iconGlyphSx} />;
  }
}

export function SettingsCategoryList({
  sections,
  onSelect,
  selectedItem,
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
  const resolvedSubheaderSx = subheaderSx ? appendSx(SETTINGS_SUBHEADER_SX, subheaderSx) : SETTINGS_SUBHEADER_SX;

  return (
    <List sx={listSx} role={listRole} aria-label={listAriaLabel}>
      {sections.map((section) => (
        <Box key={section.section} sx={sectionSx}>
          <ListSubheader sx={resolvedSubheaderSx}>{section.label}</ListSubheader>
          {section.categories.map((category) => {
            const isSelected = selectedItem === category;
            const parentTypographyProps = mergeTypographyProps(
              SETTINGS_PARENT_TYPOGRAPHY_PROPS,
              resolveProp(primaryTypographyProps, isSelected, category)
            );
            const parentIconGlyphSx = iconGlyphSx ? appendSx(SETTINGS_PARENT_ICON_GLYPH_SX, iconGlyphSx) : SETTINGS_PARENT_ICON_GLYPH_SX;
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
                <ListItemIcon sx={resolveProp(itemIconSx, isSelected, category)}>
                  {renderCategoryIcon(category, parentIconGlyphSx)}
                </ListItemIcon>
                <ListItemText
                  primary={<Typography {...parentTypographyProps}>{getSettingsCategoryLabel(category)}</Typography>}
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
