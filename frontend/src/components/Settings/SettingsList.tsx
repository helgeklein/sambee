import { List, ListItem, type ListProps, type SxProps, type Theme } from "@mui/material";
import { Children, cloneElement, isValidElement, type ReactNode } from "react";

const SETTINGS_LIST_FIRST_ITEM_SX: SxProps<Theme> = { pt: 0 };

type SettingsListProps = Omit<ListProps, "disablePadding">;

function alignFirstListItem(children: ReactNode): ReactNode {
  let isFirstListItem = true;

  return Children.map(children, (child) => {
    if (isFirstListItem && isValidElement<{ sx?: SxProps<Theme> }>(child) && child.type === ListItem) {
      isFirstListItem = false;
      const itemSx = child.props.sx;
      return cloneElement(child, {
        sx: [SETTINGS_LIST_FIRST_ITEM_SX, ...(Array.isArray(itemSx) ? itemSx : itemSx ? [itemSx] : [])],
      });
    }

    return child;
  });
}

/** Removes list padding and aligns the first direct MUI list row with a settings section heading. */
export function SettingsList({ children, ...props }: SettingsListProps) {
  return (
    <List {...props} disablePadding>
      {alignFirstListItem(children)}
    </List>
  );
}
