import React from "react";
import { Container, Typography, Paper, Box } from "@mui/material";

const AdminPanel: React.FC = () => {
  return (
    <Container maxWidth="lg" sx={{ mt: 4 }}>
      <Paper elevation={3} sx={{ p: 4 }}>
        <Typography variant="h4" gutterBottom>
          Admin Panel
        </Typography>
        <Box sx={{ mt: 2 }}>
          <Typography variant="body1">
            Admin functionality coming soon...
          </Typography>
        </Box>
      </Paper>
    </Container>
  );
};

export default AdminPanel;
