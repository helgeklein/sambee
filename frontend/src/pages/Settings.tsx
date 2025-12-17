//
// Settings
//

import { ChevronRight as ChevronRightIcon, Palette as PaletteIcon, Storage as StorageIcon } from "@mui/icons-material";
import { Box, Divider, List, ListItem, ListItemButton, ListItemIcon, ListItemText, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";

/**
 * Settings
 *
 * Settings landing page (mobile only - desktop shows sidebar).
 * On mobile, shows category cards to navigate to sub-pages.
 */
export function Settings() {
  const navigate = useNavigate();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    // Check admin status
    api
      .getCurrentUser()
      .then((user) => setIsAdmin(user.is_admin))
      .catch(() => setIsAdmin(false));
  }, []);

  return (
    <Box sx={{ height: "100%", bgcolor: "background.default" }}>
      <List sx={{ py: 0 }}>
        {isAdmin && (
          <>
            <ListItem disablePadding>
              <ListItemButton onClick={() => navigate("/settings/connections")} sx={{ py: 2 }}>
                <ListItemIcon>
                  <StorageIcon sx={{ color: "primary.main", fontSize: 28 }} />
                </ListItemIcon>
                <ListItemText
                  primary={
                    <Typography variant="h6" fontWeight="medium">
                      Connections
                    </Typography>
                  }
                  secondary="Manage SMB connections"
                />
                <ChevronRightIcon sx={{ color: "text.secondary" }} />
              </ListItemButton>
            </ListItem>
            <Divider />
          </>
        )}

        <ListItem disablePadding>
          <ListItemButton onClick={() => navigate("/settings/appearance")} sx={{ py: 2 }}>
            <ListItemIcon>
              <PaletteIcon sx={{ color: "primary.main", fontSize: 28 }} />
            </ListItemIcon>
            <ListItemText
              primary={
                <Typography variant="h6" fontWeight="medium">
                  Appearance
                </Typography>
              }
              secondary="Theme and display options"
            />
            <ChevronRightIcon sx={{ color: "text.secondary" }} />
          </ListItemButton>
        </ListItem>
      </List>
    </Box>
  );
}
