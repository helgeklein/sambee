import React, { useState, useEffect, useMemo } from "react";
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
  IconButton,
  FormControl,
  Select,
  MenuItem,
  Alert,
  CircularProgress,
  ToggleButtonGroup,
  ToggleButton,
  Chip,
  TextField,
  InputAdornment,
  Dialog,
  DialogTitle,
  DialogContent,
  Table,
  TableBody,
  TableRow,
  TableCell,
} from "@mui/material";
import {
  Folder as FolderIcon,
  InsertDriveFile as FileIcon,
  Home as HomeIcon,
  Settings as SettingsIcon,
  Storage as StorageIcon,
  SortByAlpha as SortByAlphaIcon,
  AccessTime as AccessTimeIcon,
  DataUsage as DataUsageIcon,
  Search as SearchIcon,
  Clear as ClearIcon,
  KeyboardOutlined as KeyboardIcon,
} from "@mui/icons-material";
import { FileEntry, Connection } from "../types";
import MarkdownPreview from "../components/Preview/MarkdownPreview";
import SettingsDialog from "../components/Settings/SettingsDialog";
import api from "../services/api";

type SortField = "name" | "size" | "modified";

const formatFileSize = (bytes?: number): string => {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
};

const formatDate = (dateString?: string): string => {
  if (!dateString) return "";
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return `Today ${date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  } else if (diffDays === 1) {
    return "Yesterday";
  } else if (diffDays < 7) {
    return `${diffDays} days ago`;
  } else {
    return date.toLocaleDateString();
  }
};

const Browser: React.FC = () => {
  const navigate = useNavigate();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>("");
  const [currentPath, setCurrentPath] = useState("");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortField>("name");
  const [searchQuery, setSearchQuery] = useState("");
  const [focusedIndex, setFocusedIndex] = useState<number>(0);
  const [showHelp, setShowHelp] = useState(false);

  const listRef = React.useRef<HTMLUListElement>(null);
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadConnections();
    checkAdminStatus();
  }, []);

  useEffect(() => {
    if (selectedConnectionId) {
      loadFiles(currentPath);
    }
  }, [currentPath, selectedConnectionId]);

  const loadConnections = async () => {
    try {
      const token = localStorage.getItem("token");
      if (!token) {
        navigate("/login");
        return;
      }
      const data = await api.getConnections();
      setConnections(data);

      // Load persisted connection or use first one
      const savedConnectionId = localStorage.getItem("selectedConnectionId");
      if (
        savedConnectionId &&
        data.find((c: Connection) => c.id === savedConnectionId)
      ) {
        setSelectedConnectionId(savedConnectionId);
      } else if (data.length > 0) {
        setSelectedConnectionId(data[0].id);
      }
    } catch (err: any) {
      console.error("Error loading connections:", err);
      if (err.response?.status === 401) {
        navigate("/login");
      } else if (err.response?.status === 403) {
        setError(
          "Access denied. Please contact an administrator to configure connections."
        );
      } else {
        setError("Failed to load connections. Please try again.");
      }
    }
  };

  const loadFiles = async (path: string) => {
    if (!selectedConnectionId) return;

    try {
      setLoading(true);
      setError(null);
      const listing = await api.listDirectory(selectedConnectionId, path);
      setFiles(listing.items);
    } catch (err: any) {
      console.error("Error loading files:", err);
      if (err.response?.status === 401) {
        navigate("/login");
      } else if (err.response?.status === 404) {
        setError("Connection not found. Please select another connection.");
      } else {
        setError(
          err.response?.data?.detail ||
            "Failed to load files. Please check your connection settings."
        );
      }
      setFiles([]);
    } finally {
      setLoading(false);
    }
  };

  const checkAdminStatus = async () => {
    try {
      await api.getConnections();
      setIsAdmin(true);
    } catch (error: any) {
      // If 403, user is not admin; if 401, not logged in
      if (error.response?.status === 403) {
        setIsAdmin(false);
      }
    }
  };

  const handleConnectionChange = (connectionId: string) => {
    setSelectedConnectionId(connectionId);
    setCurrentPath("");
    setSelectedFile(null);
    setFiles([]);
    // Persist selection
    localStorage.setItem("selectedConnectionId", connectionId);
  };

  const handleSettingsClose = () => {
    setSettingsOpen(false);
    // Reload connections in case they were modified
    loadConnections();
  };

  const sortedAndFilteredFiles = useMemo(() => {
    // Filter by search query
    let filtered = files;
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = files.filter((f) => f.name.toLowerCase().includes(query));
    }

    // Always keep directories first
    const directories = filtered.filter((f) => f.type === "directory");
    const regularFiles = filtered.filter((f) => f.type !== "directory");

    const sortFunction = (a: FileEntry, b: FileEntry) => {
      switch (sortBy) {
        case "name":
          return a.name.localeCompare(b.name);
        case "size":
          return (b.size || 0) - (a.size || 0);
        case "modified":
          const dateA = a.modified_at ? new Date(a.modified_at).getTime() : 0;
          const dateB = b.modified_at ? new Date(b.modified_at).getTime() : 0;
          return dateB - dateA;
        default:
          return 0;
      }
    };

    directories.sort(sortFunction);
    regularFiles.sort(sortFunction);

    return [...directories, ...regularFiles];
  }, [files, sortBy, searchQuery]);

  // Reset focused index when files change
  useEffect(() => {
    setFocusedIndex(0);
  }, [sortedAndFilteredFiles]);

  // Scroll focused item into view
  useEffect(() => {
    if (listRef.current && sortedAndFilteredFiles.length > 0) {
      const focusedElement = listRef.current.querySelector(
        `[data-index="${focusedIndex}"]`
      );
      if (focusedElement) {
        focusedElement.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }
  }, [focusedIndex, sortedAndFilteredFiles.length]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if typing in an input or if a dialog is open
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable ||
        settingsOpen ||
        showHelp
      ) {
        // Exception: Allow / to focus search from anywhere
        if (e.key === "/" && !settingsOpen && !showHelp) {
          e.preventDefault();
          searchInputRef.current?.focus();
        }
        return;
      }

      const fileCount = sortedAndFilteredFiles.length;
      if (fileCount === 0) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setFocusedIndex((prev) => Math.min(prev + 1, fileCount - 1));
          break;

        case "ArrowUp":
          e.preventDefault();
          setFocusedIndex((prev) => Math.max(prev - 1, 0));
          break;

        case "Home":
          e.preventDefault();
          setFocusedIndex(0);
          break;

        case "End":
          e.preventDefault();
          setFocusedIndex(fileCount - 1);
          break;

        case "PageDown":
          e.preventDefault();
          setFocusedIndex((prev) => Math.min(prev + 10, fileCount - 1));
          break;

        case "PageUp":
          e.preventDefault();
          setFocusedIndex((prev) => Math.max(prev - 10, 0));
          break;

        case "Enter":
          e.preventDefault();
          if (sortedAndFilteredFiles[focusedIndex]) {
            handleFileClick(sortedAndFilteredFiles[focusedIndex]);
          }
          break;

        case "Backspace":
          e.preventDefault();
          if (currentPath) {
            const pathParts = currentPath.split("/");
            const newPath = pathParts.slice(0, -1).join("/");
            setCurrentPath(newPath);
            setSelectedFile(null);
          }
          break;

        case "Escape":
          e.preventDefault();
          setSelectedFile(null);
          setSearchQuery("");
          break;

        case "/":
          e.preventDefault();
          searchInputRef.current?.focus();
          break;

        case "?":
          e.preventDefault();
          setShowHelp(true);
          break;

        default:
          // Letter keys - jump to first file starting with that letter
          if (e.key.length === 1 && /[a-zA-Z0-9]/.test(e.key)) {
            const letter = e.key.toLowerCase();
            const index = sortedAndFilteredFiles.findIndex((f) =>
              f.name.toLowerCase().startsWith(letter)
            );
            if (index !== -1) {
              setFocusedIndex(index);
            }
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    sortedAndFilteredFiles,
    focusedIndex,
    currentPath,
    settingsOpen,
    showHelp,
  ]);

  const handleFileClick = (file: FileEntry, index?: number) => {
    if (index !== undefined) {
      setFocusedIndex(index);
    }
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
          <StorageIcon sx={{ mr: 2 }} />
          <Typography variant="h6" component="div" sx={{ mr: 3 }}>
            Sambee
          </Typography>

          {connections.length > 0 && (
            <FormControl size="small" sx={{ minWidth: 250, mr: 2 }}>
              <Select
                value={selectedConnectionId}
                onChange={(e) => handleConnectionChange(e.target.value)}
                displayEmpty
                sx={{
                  color: "white",
                  ".MuiOutlinedInput-notchedOutline": {
                    borderColor: "rgba(255, 255, 255, 0.23)",
                  },
                  "&:hover .MuiOutlinedInput-notchedOutline": {
                    borderColor: "rgba(255, 255, 255, 0.4)",
                  },
                  "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
                    borderColor: "white",
                  },
                  ".MuiSvgIcon-root": {
                    color: "white",
                  },
                }}
              >
                {connections.map((conn) => (
                  <MenuItem key={conn.id} value={conn.id}>
                    {conn.name} ({conn.host}/{conn.share_name})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

          <Box sx={{ flexGrow: 1 }} />

          <IconButton
            color="inherit"
            onClick={() => setShowHelp(true)}
            sx={{ mr: 1 }}
            title="Keyboard Shortcuts (?)"
          >
            <KeyboardIcon />
          </IconButton>

          {isAdmin && (
            <IconButton
              color="inherit"
              onClick={() => setSettingsOpen(true)}
              sx={{ mr: 1 }}
              title="Settings"
            >
              <SettingsIcon />
            </IconButton>
          )}
          <Button color="inherit" onClick={handleLogout}>
            Logout
          </Button>
        </Toolbar>
      </AppBar>
      <Container maxWidth="lg" sx={{ mt: 4 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {connections.length === 0 && !error && (
          <Alert severity="info" sx={{ mb: 2 }}>
            No SMB connections configured.
            {isAdmin && " Click the settings icon to add a connection."}
            {!isAdmin &&
              " Please contact an administrator to configure connections."}
          </Alert>
        )}

        {selectedConnectionId && (
          <>
            <Paper elevation={2} sx={{ p: 2, mb: 2 }}>
              <Box
                display="flex"
                justifyContent="space-between"
                alignItems="center"
              >
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

                {files.length > 0 && (
                  <Box display="flex" alignItems="center" gap={1}>
                    <Typography variant="body2" color="text.secondary">
                      Sort by:
                    </Typography>
                    <ToggleButtonGroup
                      value={sortBy}
                      exclusive
                      onChange={(_, newSort) => {
                        if (newSort !== null) setSortBy(newSort);
                      }}
                      size="small"
                    >
                      <ToggleButton value="name" aria-label="sort by name">
                        <SortByAlphaIcon fontSize="small" />
                      </ToggleButton>
                      <ToggleButton value="size" aria-label="sort by size">
                        <DataUsageIcon fontSize="small" />
                      </ToggleButton>
                      <ToggleButton value="modified" aria-label="sort by date">
                        <AccessTimeIcon fontSize="small" />
                      </ToggleButton>
                    </ToggleButtonGroup>
                    <Chip
                      label={`${sortedAndFilteredFiles.length}/${
                        files.length
                      } item${files.length !== 1 ? "s" : ""}`}
                      size="small"
                      variant="outlined"
                    />
                  </Box>
                )}
              </Box>
            </Paper>

            {files.length > 0 && (
              <Paper elevation={2} sx={{ p: 2, mb: 2 }}>
                <TextField
                  fullWidth
                  size="small"
                  placeholder="Search files and folders... (press / to focus)"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  inputRef={searchInputRef}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon />
                      </InputAdornment>
                    ),
                    endAdornment: searchQuery && (
                      <InputAdornment position="end">
                        <IconButton
                          size="small"
                          onClick={() => setSearchQuery("")}
                          edge="end"
                        >
                          <ClearIcon fontSize="small" />
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                />
              </Paper>
            )}

            {loading ? (
              <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
                <CircularProgress />
              </Box>
            ) : (
              <Box sx={{ display: "flex", gap: 2 }}>
                <Paper elevation={2} sx={{ flex: 1, minWidth: 300 }}>
                  {sortedAndFilteredFiles.length === 0 ? (
                    <Box sx={{ p: 4, textAlign: "center" }}>
                      <Typography color="text.secondary">
                        {searchQuery
                          ? `No files matching "${searchQuery}"`
                          : "This directory is empty"}
                      </Typography>
                      {searchQuery && (
                        <Button
                          size="small"
                          onClick={() => setSearchQuery("")}
                          sx={{ mt: 1 }}
                        >
                          Clear search
                        </Button>
                      )}
                    </Box>
                  ) : (
                    <List ref={listRef}>
                      {sortedAndFilteredFiles.map((file, index) => {
                        const secondaryInfo = [];
                        if (file.size && file.type !== "directory") {
                          secondaryInfo.push(formatFileSize(file.size));
                        }
                        if (file.modified_at) {
                          secondaryInfo.push(formatDate(file.modified_at));
                        }

                        return (
                          <ListItem
                            key={index}
                            data-index={index}
                            disablePadding
                            secondaryAction={
                              file.type === "directory" ? (
                                <Chip
                                  label="Folder"
                                  size="small"
                                  variant="outlined"
                                />
                              ) : null
                            }
                          >
                            <ListItemButton
                              selected={index === focusedIndex}
                              onClick={() => handleFileClick(file, index)}
                            >
                              <ListItemIcon>
                                {file.type === "directory" ? (
                                  <FolderIcon color="primary" />
                                ) : (
                                  <FileIcon color="action" />
                                )}
                              </ListItemIcon>
                              <ListItemText
                                primary={file.name}
                                secondary={secondaryInfo.join(" • ")}
                                secondaryTypographyProps={{
                                  variant: "caption",
                                  color: "text.secondary",
                                }}
                              />
                            </ListItemButton>
                          </ListItem>
                        );
                      })}
                    </List>
                  )}
                </Paper>
                {selectedFile && (
                  <Paper elevation={2} sx={{ flex: 2, p: 2 }}>
                    <MarkdownPreview
                      connectionId={selectedConnectionId}
                      path={selectedFile}
                    />
                  </Paper>
                )}
              </Box>
            )}
          </>
        )}
      </Container>

      <SettingsDialog open={settingsOpen} onClose={handleSettingsClose} />

      {/* Keyboard Shortcuts Help Dialog */}
      <Dialog
        open={showHelp}
        onClose={() => setShowHelp(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Keyboard Shortcuts</DialogTitle>
        <DialogContent>
          <Table size="small">
            <TableBody>
              <TableRow>
                <TableCell>
                  <strong>↑ / ↓</strong>
                </TableCell>
                <TableCell>Navigate through files</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <strong>Enter</strong>
                </TableCell>
                <TableCell>Open folder or select file</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <strong>Backspace</strong>
                </TableCell>
                <TableCell>Go up one directory level</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <strong>Escape</strong>
                </TableCell>
                <TableCell>Clear file selection and search</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <strong>Home / End</strong>
                </TableCell>
                <TableCell>Jump to first / last file</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <strong>Page Up / Down</strong>
                </TableCell>
                <TableCell>Scroll through file list (10 items)</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <strong>/</strong>
                </TableCell>
                <TableCell>Focus search box</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <strong>A-Z / 0-9</strong>
                </TableCell>
                <TableCell>Jump to file starting with letter</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <strong>?</strong>
                </TableCell>
                <TableCell>Show this help dialog</TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <Box sx={{ mt: 2, textAlign: "center" }}>
            <Button variant="contained" onClick={() => setShowHelp(false)}>
              Close
            </Button>
          </Box>
        </DialogContent>
      </Dialog>
    </Box>
  );
};

export default Browser;
