import {
	AccessTime as AccessTimeIcon,
	Clear as ClearIcon,
	DataUsage as DataUsageIcon,
	InsertDriveFile as FileIcon,
	Folder as FolderIcon,
	Home as HomeIcon,
	KeyboardOutlined as KeyboardIcon,
	Refresh as RefreshIcon,
	Search as SearchIcon,
	Settings as SettingsIcon,
	SortByAlpha as SortByAlphaIcon,
	Storage as StorageIcon,
} from "@mui/icons-material";
import {
	Alert,
	AppBar,
	Box,
	Breadcrumbs,
	Button,
	Chip,
	CircularProgress,
	Container,
	Dialog,
	DialogContent,
	DialogTitle,
	FormControl,
	IconButton,
	InputAdornment,
	Link,
	ListItem,
	ListItemButton,
	ListItemIcon,
	ListItemText,
	MenuItem,
	Paper,
	Select,
	Table,
	TableBody,
	TableCell,
	TableRow,
	TextField,
	ToggleButton,
	ToggleButtonGroup,
	Toolbar,
	Typography,
} from "@mui/material";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { List as FixedSizeList } from "react-window";
import MarkdownPreview from "../components/Preview/MarkdownPreview";
import SettingsDialog from "../components/Settings/SettingsDialog";
import api from "../services/api";
import type { Connection, FileEntry } from "../types";
import { isApiError } from "../types";

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
	const params = useParams<{ connectionId: string; "*": string }>();
	const location = useLocation();

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

	type ListRef = {
		readonly element: HTMLDivElement;
		scrollToRow(config: {
			align?: "center" | "end" | "start" | "auto" | "smart";
			behavior?: "auto" | "smooth" | "instant";
			index: number;
		}): void;
	};

	const _listRef = React.useRef<ListRef>(null);
	const searchInputRef = React.useRef<HTMLInputElement>(null);
	const filesRef = React.useRef<FileEntry[]>([]);
	const virtualListRef = React.useRef<ListRef>(null);
	const listContainerRef = React.useRef<HTMLDivElement>(null);
	const [listHeight, setListHeight] = React.useState(600);

	// Refs to access current values in WebSocket callbacks (avoid closure issues)
	const selectedConnectionIdRef = React.useRef<string>("");
	const currentPathRef = React.useRef<string>("");
	const loadFilesRef =
		React.useRef<(path: string, forceRefresh?: boolean) => Promise<void>>();

	// Incremental search for quick navigation
	const searchBufferRef = React.useRef<string>("");
	const searchTimeoutRef = React.useRef<number | null>(null);

	// Navigation history to restore scroll position and selection when going back
	const navigationHistory = React.useRef<
		Map<
			string,
			{
				focusedIndex: number;
				scrollOffset: number;
				selectedFileName: string | null;
			}
		>
	>(new Map());

	// Directory listing cache for instant backward navigation
	const directoryCache = React.useRef<
		Map<string, { items: FileEntry[]; timestamp: number }>
	>(new Map());

	// WebSocket for real-time directory updates
	const wsRef = React.useRef<WebSocket | null>(null);
	const reconnectTimeoutRef = React.useRef<number | null>(null);

	// Track if we're initializing from URL to avoid circular updates
	const isInitializing = React.useRef<boolean>(true);
	// Track if we're updating state from URL (back/forward) to avoid circular navigate
	const isUpdatingFromUrl = React.useRef<boolean>(false);

	// Helper functions for connection name/ID mapping
	const slugifyConnectionName = useCallback((name: string): string => {
		return name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-") // Replace non-alphanumeric with dashes
			.replace(/^-+|-+$/g, ""); // Remove leading/trailing dashes
	}, []);

	const getConnectionByName = useCallback(
		(slug: string): Connection | undefined => {
			return connections.find((c) => slugifyConnectionName(c.name) === slug);
		},
		[connections, slugifyConnectionName],
	);

	const getConnectionIdentifier = useCallback(
		(connection: Connection): string => {
			return slugifyConnectionName(connection.name);
		},
		[slugifyConnectionName],
	);

	const checkAdminStatus = useCallback(async () => {
		try {
			await api.getConnections();
			setIsAdmin(true);
		} catch (error: unknown) {
			// If 403, user is not admin; if 401, not logged in
			if (isApiError(error) && error.response?.status === 403) {
				setIsAdmin(false);
			}
		}
	}, []);

	const loadFiles = useCallback(
		async (path: string, forceRefresh: boolean = false) => {
			if (!selectedConnectionId) return;

			// Create cache key
			const cacheKey = `${selectedConnectionId}:${path}`;

			// Check cache first (unless force refresh)
			if (!forceRefresh) {
				const cached = directoryCache.current.get(cacheKey);
				if (cached) {
					// Use cached data immediately - no loading spinner!
					setFiles(cached.items);
					setError(null);
					return;
				}
			}
			try {
				setLoading(true);
				setError(null);
				const listing = await api.listDirectory(selectedConnectionId, path);

				// Store in cache
				directoryCache.current.set(cacheKey, {
					items: listing.items,
					timestamp: Date.now(),
				});

				setFiles(listing.items);
			} catch (err: unknown) {
				console.error("Error loading files:", err);
				if (isApiError(err)) {
					console.error("API Error details:", {
						status: err.response?.status,
						detail: err.response?.data?.detail,
						data: err.response?.data,
					});
					if (err.response?.status === 401) {
						navigate("/login");
					} else if (err.response?.status === 404) {
						setError("Connection not found. Please select another connection.");
					} else {
						setError(
							err.response?.data?.detail ||
								"Failed to load files. Please check your connection settings.",
						);
					}
				} else {
					setError(
						"Failed to load files. Please check your connection settings.",
					);
				}
				setFiles([]);
			} finally {
				setLoading(false);
			}
		},
		[selectedConnectionId, navigate],
	);

	// Keep loadFiles ref in sync
	useEffect(() => {
		loadFilesRef.current = loadFiles;
	}, [loadFiles]);

	const loadConnections = useCallback(async () => {
		try {
			const token = localStorage.getItem("access_token");
			if (!token) {
				navigate("/login");
				return;
			}
			const data = await api.getConnections();
			setConnections(data);

			// Priority: URL param (name slug) > localStorage > first connection
			if (params.connectionId) {
				const urlConnection = data.find(
					(c: Connection) =>
						slugifyConnectionName(c.name) === params.connectionId,
				);
				if (urlConnection) {
					// URL has valid connection, will be set in initialization useEffect
					// Don't override it here
					return;
				} else {
					// Invalid connection slug in URL - redirect to /browse
					navigate("/browse", { replace: true });
					return;
				}
			}

			// No URL param, use localStorage or first
			const savedConnectionId = localStorage.getItem("selectedConnectionId");
			let autoSelectedConnection: Connection | undefined;

			if (
				savedConnectionId &&
				data.find((c: Connection) => c.id === savedConnectionId)
			) {
				autoSelectedConnection = data.find(
					(c: Connection) => c.id === savedConnectionId,
				);
				setSelectedConnectionId(savedConnectionId);
			} else if (data.length > 0) {
				autoSelectedConnection = data[0];
				setSelectedConnectionId(data[0].id);
			}

			// Update URL to include the auto-selected connection
			if (autoSelectedConnection) {
				const identifier = slugifyConnectionName(autoSelectedConnection.name);
				navigate(`/browse/${identifier}`, { replace: true });
			}
		} catch (err: unknown) {
			console.error("Error loading connections:", err);
			if (isApiError(err)) {
				if (err.response?.status === 401) {
					navigate("/login");
				} else if (err.response?.status === 403) {
					setError(
						"Access denied. Please contact an administrator to configure connections.",
					);
				} else {
					setError("Failed to load connections. Please try again.");
				}
			} else {
				setError("Failed to load connections. Please try again.");
			}
		}
	}, [navigate, params.connectionId, slugifyConnectionName]);

	// Helper to update URL when navigation changes
	const updateUrl = useCallback(
		(connectionId: string, path: string) => {
			if (isInitializing.current) return; // Don't update URL during initialization
			if (isUpdatingFromUrl.current) return; // Don't update URL when state is being set from URL

			// Find connection and use its name as identifier
			const connection = connections.find((c) => c.id === connectionId);
			if (!connection) return;

			const identifier = getConnectionIdentifier(connection);

			// Encode the path but keep slashes as slashes (not %2F)
			const encodedPath = path
				.split("/")
				.map((segment) => encodeURIComponent(segment))
				.join("/");

			const newUrl = `/browse/${identifier}${encodedPath ? `/${encodedPath}` : ""}`;

			// Only navigate if URL actually changed to avoid duplicate history entries
			if (location.pathname !== newUrl) {
				navigate(newUrl, { replace: false });
			}
		},
		[connections, getConnectionIdentifier, location.pathname, navigate],
	);

	const handleFileClick = useCallback(
		(file: FileEntry, index?: number) => {
			if (index !== undefined) {
				setFocusedIndex(index);
			}
			if (file.type === "directory") {
				// Save current state before navigating into directory
				// Note: scrollOffset tracking removed as it's not available in react-window v2 ListRef
				const currentScrollOffset = 0;
				navigationHistory.current.set(currentPath, {
					focusedIndex,
					scrollOffset: currentScrollOffset,
					selectedFileName: file.name,
				});

				const newPath = currentPath ? `${currentPath}/${file.name}` : file.name;
				setCurrentPath(newPath);
				setSelectedFile(null);
				// Blur any focused element when navigating so keyboard shortcuts work
				if (document.activeElement instanceof HTMLElement) {
					document.activeElement.blur();
				}
			} else {
				const filePath = currentPath
					? `${currentPath}/${file.name}`
					: file.name;
				setSelectedFile(filePath);
			}
		},
		[currentPath, focusedIndex],
	);

	// Keep refs in sync with state for WebSocket callbacks
	useEffect(() => {
		selectedConnectionIdRef.current = selectedConnectionId;
	}, [selectedConnectionId]);

	useEffect(() => {
		currentPathRef.current = currentPath;
	}, [currentPath]);

	// Initial load - run once on mount
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentionally run only once on mount to avoid aborting requests
	useEffect(() => {
		loadConnections();
		checkAdminStatus();
	}, []);

	// Initialize state from URL after connections are loaded
	// biome-ignore lint/correctness/useExhaustiveDependencies: getConnectionByName uses closure, including it causes re-initialization
	useEffect(() => {
		if (connections.length === 0) return; // Wait for connections to load

		if (params.connectionId) {
			const connection = getConnectionByName(params.connectionId);
			if (connection) {
				setSelectedConnectionId(connection.id);
				const urlPath = params["*"] || "";
				setCurrentPath(decodeURIComponent(urlPath));
			}
		}
		// Mark initialization complete after a brief delay
		setTimeout(() => {
			isInitializing.current = false;
		}, 100);
	}, [connections.length, params.connectionId, params["*"]]);

	// Handle browser back/forward navigation
	// biome-ignore lint/correctness/useExhaustiveDependencies: getConnectionByName intentionally excluded - we use closure value to avoid re-running when function reference changes
	useEffect(() => {
		if (isInitializing.current || connections.length === 0) return;

		isUpdatingFromUrl.current = true;

		if (params.connectionId) {
			const connection = getConnectionByName(params.connectionId);
			if (connection && connection.id !== selectedConnectionIdRef.current) {
				setSelectedConnectionId(connection.id);
			}
		}

		const urlPath = params["*"] || "";
		const decodedPath = decodeURIComponent(urlPath);

		// Only update if the path actually changed (using ref to avoid stale closure)
		if (currentPathRef.current !== decodedPath) {
			console.log(
				"[URL Navigation useEffect] Setting currentPath to:",
				decodedPath,
			);
			setCurrentPath(decodedPath);
		} else {
			console.log("[URL Navigation useEffect] Path unchanged, skipping update");
		}

		// Reset flag after state updates have propagated
		setTimeout(() => {
			isUpdatingFromUrl.current = false;
		}, 50);
	}, [connections.length, params.connectionId, params["*"]]);

	// WebSocket connection and reconnection logic
	useEffect(() => {
		const connectWebSocket = () => {
			const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
			// In development, use port 8000; in production, use same port as current page
			const isDev =
				window.location.port === "3000" ||
				window.location.hostname === "localhost";
			const port = isDev ? "8000" : window.location.port;
			const wsUrl = port
				? `${protocol}//${window.location.hostname}:${port}/api/ws`
				: `${protocol}//${window.location.hostname}/api/ws`;

			console.log(`Connecting to WebSocket: ${wsUrl}`);
			const ws = new WebSocket(wsUrl);

			ws.onopen = () => {
				console.log("WebSocket connected");
				wsRef.current = ws;

				// Subscribe to current directory if we have one
				const connId = selectedConnectionIdRef.current;
				const path = currentPathRef.current;
				if (connId && path !== undefined) {
					ws.send(
						JSON.stringify({
							action: "subscribe",
							connection_id: connId,
							path: path,
						}),
					);
				}
			};

			ws.onmessage = (event) => {
				const data = JSON.parse(event.data);

				if (data.type === "directory_changed") {
					// Use refs to get current values (avoid closure issues)
					const currentConnId = selectedConnectionIdRef.current;
					const currentDir = currentPathRef.current;

					// Invalidate cache for this directory
					const cacheKey = `${data.connection_id}:${data.path}`;
					directoryCache.current.delete(cacheKey);

					// If we're currently viewing this directory, reload it
					if (
						data.connection_id === currentConnId &&
						data.path === currentDir
					) {
						console.log(`Directory changed, reloading: ${data.path}`);
						loadFilesRef.current?.(currentDir, true); // Force reload
					}
				}
			};

			ws.onerror = (error) => {
				console.error("WebSocket error:", error);
			};

			ws.onclose = () => {
				console.log("WebSocket disconnected, reconnecting in 5s...");
				wsRef.current = null;

				// Reconnect after 5 seconds
				reconnectTimeoutRef.current = window.setTimeout(() => {
					connectWebSocket();
				}, 5000);
			};
		};

		connectWebSocket();

		// Cleanup on unmount
		return () => {
			if (reconnectTimeoutRef.current) {
				clearTimeout(reconnectTimeoutRef.current);
			}
			if (wsRef.current) {
				wsRef.current.close();
			}
		};
	}, []); // WebSocket connection is stable - created once on mount

	// Subscribe/unsubscribe when directory changes
	useEffect(() => {
		if (wsRef.current?.readyState === WebSocket.OPEN && selectedConnectionId) {
			// Unsubscribe from all and subscribe to current directory
			wsRef.current.send(
				JSON.stringify({
					action: "subscribe",
					connection_id: selectedConnectionId,
					path: currentPath,
				}),
			);
		}
	}, [currentPath, selectedConnectionId]);

	// Sync URL with state changes
	useEffect(() => {
		if (selectedConnectionId) {
			updateUrl(selectedConnectionId, currentPath);
		}
	}, [currentPath, selectedConnectionId, updateUrl]);

	// Calculate list height dynamically based on container size
	useEffect(() => {
		const updateHeight = () => {
			if (listContainerRef.current) {
				const rect = listContainerRef.current.getBoundingClientRect();
				// Leave some padding
				const height = rect.height - 16;
				console.log(
					"List container height:",
					rect.height,
					"→ listHeight:",
					height > 200 ? height : 600,
				);
				setListHeight(height > 200 ? height : 600);
			}
		};

		// Use ResizeObserver for better performance
		const observer = new ResizeObserver(updateHeight);
		if (listContainerRef.current) {
			observer.observe(listContainerRef.current);
		}

		// Initial calculation with a small delay to ensure layout is ready
		const timeout = setTimeout(updateHeight, 100);

		return () => {
			observer.disconnect();
			clearTimeout(timeout);
		};
	}, []); // Recalculate when connections change

	useEffect(() => {
		if (selectedConnectionId) {
			// Use ref to avoid dependency on loadFiles function
			loadFilesRef.current?.(currentPath);
		}
	}, [currentPath, selectedConnectionId]);

	const handleConnectionChange = (connectionId: string) => {
		setSelectedConnectionId(connectionId);
		setCurrentPath("");
		setSelectedFile(null);
		setFiles([]);
		// Clear caches when switching connections
		directoryCache.current.clear();
		navigationHistory.current.clear();
		// Persist selection
		localStorage.setItem("selectedConnectionId", connectionId);
	};

	const handleSettingsClose = () => {
		setSettingsOpen(false);
		// Reload connections in case they were modified
		loadConnections();
	};

	const sortedAndFilteredFiles = useMemo(() => {
		// Filter by search query first
		let filtered = files;
		if (searchQuery.trim()) {
			const query = searchQuery.toLowerCase();
			filtered = files.filter((f) => f.name.toLowerCase().includes(query));
		}

		// Single-pass separation and sorting
		const directories: FileEntry[] = [];
		const regularFiles: FileEntry[] = [];

		for (const file of filtered) {
			if (file.type === "directory") {
				directories.push(file);
			} else {
				regularFiles.push(file);
			}
		}

		// Optimized sort function
		const sortFunction = (a: FileEntry, b: FileEntry) => {
			switch (sortBy) {
				case "name":
					return a.name.localeCompare(b.name);
				case "size":
					return (b.size || 0) - (a.size || 0);
				case "modified": {
					const dateA = a.modified_at ? new Date(a.modified_at).getTime() : 0;
					const dateB = b.modified_at ? new Date(b.modified_at).getTime() : 0;
					return dateB - dateA;
				}
				default:
					return 0;
			}
		};

		directories.sort(sortFunction);
		regularFiles.sort(sortFunction);

		return [...directories, ...regularFiles];
	}, [files, sortBy, searchQuery]);

	// Keep ref updated and restore or reset focused index when files change
	useEffect(() => {
		filesRef.current = sortedAndFilteredFiles;

		// Check if we have saved state to restore for current path
		const savedState = navigationHistory.current.get(currentPath);
		if (savedState?.selectedFileName) {
			// Find the index of the previously selected item
			const restoredIndex = sortedAndFilteredFiles.findIndex(
				(f) => f.name === savedState.selectedFileName,
			);
			if (restoredIndex >= 0) {
				setFocusedIndex(restoredIndex);
				// Restore scroll position after a short delay to ensure list is rendered
				setTimeout(() => {
					if (virtualListRef.current) {
						virtualListRef.current.scrollToRow({
							index: restoredIndex,
							align: "smart",
						});
					}
				}, 0);
				// Clear the saved state after restoring
				navigationHistory.current.delete(currentPath);
				return;
			}
			// If we have saved state but file not found yet, don't reset to 0
			// This prevents flickering when files are still loading
			return;
		}

		// Default: reset to top (only if no saved state exists)
		setFocusedIndex(0);
	}, [sortedAndFilteredFiles, currentPath]);

	// Scroll focused item into view using VirtualList API
	useEffect(() => {
		if (virtualListRef.current && focusedIndex >= 0) {
			virtualListRef.current.scrollToRow({
				index: focusedIndex,
				align: "smart",
				behavior: "auto",
			});
		}
	}, [focusedIndex]);

	// Keyboard navigation (optimized to avoid recreation on file list changes)
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			// Don't handle if typing in an input or if a dialog is open
			const target = e.target as HTMLElement;
			const isInInput =
				target.tagName === "INPUT" ||
				target.tagName === "TEXTAREA" ||
				target.isContentEditable;

			if (isInInput || settingsOpen || showHelp || selectedFile) {
				// Exception: Allow / to focus search from anywhere
				if (e.key === "/" && !settingsOpen && !showHelp) {
					e.preventDefault();
					searchInputRef.current?.focus();
				}
				// Exception: Allow Backspace for navigation when search is empty and in search input
				if (
					e.key === "Backspace" &&
					isInInput &&
					(searchQuery === "" || (target as HTMLInputElement).value === "") &&
					currentPathRef.current
				) {
					// Check if cursor is at the beginning of input (no text to delete)
					const input = target as HTMLInputElement;
					if (input.selectionStart === 0 && input.selectionEnd === 0) {
						e.preventDefault();
						const pathParts = currentPathRef.current.split("/");
						const newPath = pathParts.slice(0, -1).join("/");
						setCurrentPath(newPath);
						setSelectedFile(null);
						return;
					}
				}
				return;
			}

			const files = filesRef.current;
			const fileCount = files.length;

			// Allow certain keys even when no files
			const alwaysAllowKeys = ["Backspace", "Escape", "/", "?", "F5"];
			if (fileCount === 0 && !alwaysAllowKeys.includes(e.key)) {
				return;
			}

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
					setFocusedIndex((prev) => {
						const file = files[prev];
						if (file) {
							if (file.type === "directory") {
								// Save navigation history before navigating
								navigationHistory.current.set(currentPathRef.current, {
									focusedIndex: prev,
									scrollOffset: 0,
									selectedFileName: file.name,
								});

								const newPath = currentPathRef.current
									? `${currentPathRef.current}/${file.name}`
									: file.name;
								setCurrentPath(newPath);
								setSelectedFile(null);
							} else {
								const filePath = currentPathRef.current
									? `${currentPathRef.current}/${file.name}`
									: file.name;
								setSelectedFile(filePath);
							}
						}
						return prev;
					});
					break;

				case "Backspace":
					e.preventDefault();
					if (currentPathRef.current) {
						const pathParts = currentPathRef.current.split("/");
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

				case "F5":
					e.preventDefault();
					loadFiles(currentPathRef.current, true);
					break;

				default:
					// Incremental search - accumulate keystrokes to match file names
					if (e.key.length === 1 && /[a-zA-Z0-9]/.test(e.key)) {
						// Clear any existing timeout
						if (searchTimeoutRef.current) {
							clearTimeout(searchTimeoutRef.current);
						}

						// Add this character to the search buffer
						searchBufferRef.current += e.key.toLowerCase();

						// Find first file matching the accumulated prefix
						const index = files.findIndex((f) =>
							f.name.toLowerCase().startsWith(searchBufferRef.current),
						);
						if (index !== -1) {
							setFocusedIndex(index);
						}

						// Reset search buffer after 1 second of no typing
						searchTimeoutRef.current = window.setTimeout(() => {
							searchBufferRef.current = "";
						}, 1000);
					}
					break;
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [settingsOpen, showHelp, searchQuery, selectedFile, loadFiles]);

	const handleBreadcrumbClick = (index: number) => {
		const pathParts = currentPath.split("/");
		const newPath = pathParts.slice(0, index + 1).join("/");
		setCurrentPath(newPath);
		setSelectedFile(null);
		// Blur any focused input
		if (document.activeElement instanceof HTMLElement) {
			document.activeElement.blur();
		}
		// Restoration will happen in useEffect after files are loaded
	};

	const handleLogout = () => {
		localStorage.removeItem("access_token");
		navigate("/login");
	};

	const pathParts = currentPath ? currentPath.split("/") : [];

	// Row renderer for virtual list
	// Row component for VirtualList (react-window v2)
	interface RowComponentProps {
		index: number;
		style: React.CSSProperties;
		files: FileEntry[];
		focusedIndex: number;
		onFileClick: (file: FileEntry, index: number) => void;
	}

	const RowComponent = React.useCallback(
		({
			index,
			style,
			files,
			focusedIndex: focused,
			onFileClick,
		}: RowComponentProps) => {
			const file = files[index];

			const secondaryInfo = [];
			if (file.size && file.type !== "directory") {
				secondaryInfo.push(formatFileSize(file.size));
			}
			if (file.modified_at) {
				secondaryInfo.push(formatDate(file.modified_at));
			}

			return (
				<ListItem
					style={style}
					key={file.name}
					data-index={index}
					disablePadding
					secondaryAction={
						file.type === "directory" ? (
							<Chip label="Folder" size="small" variant="outlined" />
						) : null
					}
				>
					<ListItemButton
						selected={index === focused}
						onClick={() => onFileClick(file, index)}
						tabIndex={-1}
						disableRipple={false}
						component="div"
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
		},
		[],
	);

	// Prepare props for row component
	const rowProps = React.useMemo(
		() => ({
			files: sortedAndFilteredFiles,
			focusedIndex,
			onFileClick: handleFileClick,
		}),
		[sortedAndFilteredFiles, focusedIndex, handleFileClick],
	);

	return (
		<Box sx={{ display: "flex", flexDirection: "column", height: "100vh" }}>
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
			<Container
				maxWidth="lg"
				sx={{
					flex: 1,
					display: "flex",
					flexDirection: "column",
					pt: 2,
					pb: 0,
					overflow: "hidden",
				}}
			>
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
											key={pathParts.slice(0, index + 1).join("/")}
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
										<IconButton
											size="small"
											onClick={() => loadFiles(currentPath, true)}
											title="Refresh (F5)"
											sx={{ mr: 1 }}
										>
											<RefreshIcon fontSize="small" />
										</IconButton>
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
							<Box
								sx={{ display: "flex", gap: 2, flex: 1, minHeight: 0, mb: 0 }}
							>
								<Paper
									ref={listContainerRef}
									elevation={2}
									tabIndex={0}
									sx={{
										flex: 1,
										minWidth: 300,
										display: "flex",
										flexDirection: "column",
										overflow: "hidden",
										"&:focus": {
											outline: "none",
										},
									}}
								>
									{sortedAndFilteredFiles.length === 0 ? (
										<Box sx={{ p: 4, textAlign: "center", flex: 1 }}>
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
										<FixedSizeList
											listRef={virtualListRef}
											rowComponent={RowComponent}
											rowCount={sortedAndFilteredFiles.length}
											rowHeight={68}
											// biome-ignore lint/suspicious/noExplicitAny: react-window v2 type mismatch with ExcludeForbiddenKeys
											rowProps={rowProps as any}
											style={{ height: listHeight, width: "100%" }}
										/>
									)}
								</Paper>
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
							<TableRow>
								<TableCell>
									<strong>F5</strong>
								</TableCell>
								<TableCell>Refresh current directory</TableCell>
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

			{selectedFile && (
				<MarkdownPreview
					connectionId={selectedConnectionId}
					path={selectedFile}
					onClose={() => setSelectedFile(null)}
				/>
			)}
		</Box>
	);
};

export default Browser;
