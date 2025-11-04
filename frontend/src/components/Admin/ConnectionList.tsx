import React from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  Tooltip,
  Chip,
  Box,
  Typography,
} from "@mui/material";
import {
  Edit as EditIcon,
  Delete as DeleteIcon,
  CheckCircle as TestIcon,
} from "@mui/icons-material";
import { Connection } from "../../types";

interface ConnectionListProps {
  connections: Connection[];
  onEdit: (connection: Connection) => void;
  onDelete: (connection: Connection) => void;
  onTest: (connection: Connection) => void;
  loading?: boolean;
}

const ConnectionList: React.FC<ConnectionListProps> = ({
  connections,
  onEdit,
  onDelete,
  onTest,
  loading = false,
}) => {
  if (loading) {
    return (
      <Box sx={{ p: 4, textAlign: "center" }}>
        <Typography>Loading connections...</Typography>
      </Box>
    );
  }

  if (connections.length === 0) {
    return (
      <Box sx={{ p: 4, textAlign: "center" }}>
        <Typography variant="h6" color="text.secondary">
          No connections configured
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Click "Add Connection" to create your first SMB share connection
        </Typography>
      </Box>
    );
  }

  return (
    <TableContainer component={Paper}>
      <Table>
        <TableHead>
          <TableRow>
            <TableCell>Name</TableCell>
            <TableCell>Host</TableCell>
            <TableCell>Share Name</TableCell>
            <TableCell>Username</TableCell>
            <TableCell align="center">Port</TableCell>
            <TableCell>Type</TableCell>
            <TableCell align="right">Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {connections.map((connection) => (
            <TableRow key={connection.id} hover>
              <TableCell>
                <strong>{connection.name}</strong>
              </TableCell>
              <TableCell>{connection.host}</TableCell>
              <TableCell>{connection.share_name || "-"}</TableCell>
              <TableCell>{connection.username}</TableCell>
              <TableCell align="center">{connection.port}</TableCell>
              <TableCell>
                <Chip label={connection.type.toUpperCase()} size="small" />
              </TableCell>
              <TableCell align="right">
                <Tooltip title="Test Connection">
                  <IconButton
                    size="small"
                    onClick={() => onTest(connection)}
                    color="primary"
                  >
                    <TestIcon />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Edit">
                  <IconButton
                    size="small"
                    onClick={() => onEdit(connection)}
                    color="primary"
                  >
                    <EditIcon />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Delete">
                  <IconButton
                    size="small"
                    onClick={() => onDelete(connection)}
                    color="error"
                  >
                    <DeleteIcon />
                  </IconButton>
                </Tooltip>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

export default ConnectionList;
