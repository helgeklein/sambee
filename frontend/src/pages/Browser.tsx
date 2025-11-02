import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Container,
  AppBar,
  Toolbar,
  Typography,
  Button,
  Box,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Breadcrumbs,
  Link,
  Paper,
} from "@mui/material";
import {
  Folder as FolderIcon,
  InsertDriveFile as FileIcon,
  Home as HomeIcon,
} from "@mui/icons-material";
import { browseFiles } from "../services/api";
import { FileEntry } from "../types";
import MarkdownPreview from "../components/Preview/MarkdownPreview";

const Browser: React.FC = () => {
  const navigate = useNavigate();
  const [currentPath, setCurrentPath] = useState("");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const loadFiles = React.useCallback(
    async (path: string) => {
      try {
        const token = localStorage.getItem("token");
        if (!token) {
          navigate("/login");
          return;
        }
        const data = await browseFiles(path, token);
        setFiles(data);
      } catch (err) {
        console.error("Error loading files:", err);
        navigate("/login");
      }
    },
    [navigate]
  );

  useEffect(() => {
    loadFiles(currentPath);
  }, [currentPath, loadFiles]);

  const handleFileClick = (file: FileEntry) => {
    if (file.type === "directory") {
      const newPath = currentPath ? `${currentPath}/${file.name}` : file.name;
      setCurrentPath(newPath);
      setSelectedFile(null);
    } else {
      const filePath = currentPath ? `${currentPath}/${file.name}` : file.name;
      setSelectedFile(filePath);
    }
  };

  const handleBreadcrumbClick = (index: number) => {
    const pathParts = currentPath.split("/");
    const newPath = pathParts.slice(0, index + 1).join("/");
    setCurrentPath(newPath);
    setSelectedFile(null);
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    navigate("/login");
  };

  const pathParts = currentPath ? currentPath.split("/") : [];

  return (
    <Box sx={{ flexGrow: 1 }}>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            SamBee File Browser
          </Typography>
          <Button color="inherit" onClick={handleLogout}>
            Logout
          </Button>
        </Toolbar>
      </AppBar>
      <Container maxWidth="lg" sx={{ mt: 4 }}>
        <Paper elevation={2} sx={{ p: 2, mb: 2 }}>
          <Breadcrumbs>
            <Link
              component="button"
              variant="body1"
              onClick={() => {
                setCurrentPath("");
                setSelectedFile(null);
              }}
              sx={{ display: "flex", alignItems: "center" }}
            >
              <HomeIcon sx={{ mr: 0.5 }} fontSize="small" />
              Root
            </Link>
            {pathParts.map((part, index) => (
              <Link
                key={index}
                component="button"
                variant="body1"
                onClick={() => handleBreadcrumbClick(index)}
              >
                {part}
              </Link>
            ))}
          </Breadcrumbs>
        </Paper>
        <Box sx={{ display: "flex", gap: 2 }}>
          <Paper elevation={2} sx={{ flex: 1, minWidth: 300 }}>
            <List>
              {files.map((file, index) => (
                <ListItem key={index} disablePadding>
                  <ListItemButton onClick={() => handleFileClick(file)}>
                    <ListItemIcon>
                      {file.type === "directory" ? (
                        <FolderIcon />
                      ) : (
                        <FileIcon />
                      )}
                    </ListItemIcon>
                    <ListItemText
                      primary={file.name}
                      secondary={
                        file.size ? `${(file.size / 1024).toFixed(2)} KB` : ""
                      }
                    />
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          </Paper>
          {selectedFile && (
            <Paper elevation={2} sx={{ flex: 2, p: 2 }}>
              <MarkdownPreview connectionId="" path={selectedFile} />
            </Paper>
          )}
        </Box>
      </Container>
    </Box>
  );
};

export default Browser;
