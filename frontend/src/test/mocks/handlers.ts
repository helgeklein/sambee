import { HttpResponse, http } from "msw";

const API_BASE = "http://localhost:8000/api";

export const handlers = [
	// Auth - Login
	http.post(`${API_BASE}/auth/token`, async ({ request }) => {
		const body = await request.formData();
		const username = body.get("username");
		const password = body.get("password");

		console.log("MSW: Login request received", { username, password });

		if (username === "admin" && password === "admin") {
			console.log("MSW: Returning admin token");
			return HttpResponse.json({
				access_token: "mock-admin-token",
				token_type: "bearer",
				username: "admin",
				is_admin: true,
			});
		}

		if (username === "testuser" && password === "testpass") {
			console.log("MSW: Returning user token");
			return HttpResponse.json({
				access_token: "mock-user-token",
				token_type: "bearer",
				username: "testuser",
				is_admin: false,
			});
		}

		console.log("MSW: Invalid credentials");
		return HttpResponse.json(
			{ detail: "Incorrect username or password" },
			{ status: 401 },
		);
	}),

	// Auth - Get current user
	http.get(`${API_BASE}/auth/me`, ({ request }) => {
		const authHeader = request.headers.get("Authorization");

		if (!authHeader || !authHeader.startsWith("Bearer ")) {
			return HttpResponse.json(
				{ detail: "Could not validate credentials" },
				{ status: 401 },
			);
		}

		const token = authHeader.replace("Bearer ", "");

		if (token === "mock-admin-token") {
			return HttpResponse.json({
				username: "admin",
				is_admin: true,
				created_at: "2024-01-01T00:00:00",
			});
		}

		if (token === "mock-user-token") {
			return HttpResponse.json({
				username: "testuser",
				is_admin: false,
				created_at: "2024-01-01T00:00:00",
			});
		}

		return HttpResponse.json(
			{ detail: "Could not validate credentials" },
			{ status: 401 },
		);
	}),

	// Auth - Change password
	http.post(`${API_BASE}/auth/change-password`, async ({ request }) => {
		const authHeader = request.headers.get("Authorization");

		if (!authHeader || !authHeader.startsWith("Bearer ")) {
			return HttpResponse.json(
				{ detail: "Could not validate credentials" },
				{ status: 401 },
			);
		}

		const body = await request.json();
		// biome-ignore lint/suspicious/noExplicitAny: mock response
		const { current_password, new_password } = body as any;

		// Mock: current password validation
		if (current_password === "wrongpass") {
			return HttpResponse.json(
				{ detail: "Current password is incorrect" },
				{ status: 400 },
			);
		}

		if (!new_password || new_password.length < 1) {
			return HttpResponse.json(
				{ detail: "New password is required" },
				{ status: 400 },
			);
		}

		return HttpResponse.json({ message: "Password changed successfully" });
	}),

	// Admin - Get connections
	http.get(`${API_BASE}/admin/connections`, ({ request }) => {
		const authHeader = request.headers.get("Authorization");

		if (!authHeader || !authHeader.startsWith("Bearer ")) {
			return HttpResponse.json(
				{ detail: "Could not validate credentials" },
				{ status: 401 },
			);
		}

		return HttpResponse.json([
			{
				id: "conn-123",
				name: "Test Server",
				type: "smb",
				host: "server.local",
				port: 445,
				share_name: "testshare",
				username: "smbuser",
				path_prefix: "/",
			},
			{
				id: "conn-456",
				name: "Backup Server",
				type: "smb",
				host: "backup.local",
				port: 445,
				share_name: "backups",
				username: "backupuser",
				path_prefix: "/",
			},
		]);
	}),

	// Admin - Create connection
	http.post(`${API_BASE}/admin/connections`, async ({ request }) => {
		const authHeader = request.headers.get("Authorization");

		if (!authHeader || !authHeader.startsWith("Bearer ")) {
			return HttpResponse.json(
				{ detail: "Could not validate credentials" },
				{ status: 401 },
			);
		}

		const body = await request.json();
		// biome-ignore lint/suspicious/noExplicitAny: mock response
		const connectionData = body as any;

		// Validate required fields
		if (
			!connectionData.name ||
			!connectionData.host ||
			!connectionData.share_name
		) {
			return HttpResponse.json(
				{ detail: "Missing required fields" },
				{ status: 422 },
			);
		}

		return HttpResponse.json({
			id: "conn-new",
			...connectionData,
		});
	}),

	// Admin - Update connection
	http.put(`${API_BASE}/admin/connections/:id`, async ({ request, params }) => {
		const authHeader = request.headers.get("Authorization");

		if (!authHeader || !authHeader.startsWith("Bearer ")) {
			return HttpResponse.json(
				{ detail: "Could not validate credentials" },
				{ status: 401 },
			);
		}

		const body = await request.json();
		// biome-ignore lint/suspicious/noExplicitAny: mock response
		const connectionData = body as any;

		return HttpResponse.json({
			id: params.id,
			...connectionData,
		});
	}),

	// Admin - Delete connection
	http.delete(`${API_BASE}/admin/connections/:id`, ({ request }) => {
		const authHeader = request.headers.get("Authorization");

		if (!authHeader || !authHeader.startsWith("Bearer ")) {
			return HttpResponse.json(
				{ detail: "Could not validate credentials" },
				{ status: 401 },
			);
		}

		return HttpResponse.json({ message: "Connection deleted successfully" });
	}),

	// Browse - List directory
	http.get(`${API_BASE}/browse/:connectionId/list`, ({ request }) => {
		const authHeader = request.headers.get("Authorization");

		if (!authHeader || !authHeader.startsWith("Bearer ")) {
			return HttpResponse.json(
				{ detail: "Could not validate credentials" },
				{ status: 401 },
			);
		}

		const url = new URL(request.url);
		const path = url.searchParams.get("path") || "/";

		// Mock different responses based on path
		if (path === "/") {
			return HttpResponse.json({
				path: "/",
				items: [
					{
						name: "Documents",
						type: "directory",
						size: 0,
						modified: "2024-01-01T00:00:00",
					},
					{
						name: "Pictures",
						type: "directory",
						size: 0,
						modified: "2024-01-01T00:00:00",
					},
					{
						name: "readme.txt",
						type: "file",
						size: 1024,
						modified: "2024-01-01T00:00:00",
					},
				],
				total: 3,
			});
		}

		if (path === "/Documents") {
			return HttpResponse.json({
				path: "/Documents",
				items: [
					{
						name: "report.pdf",
						type: "file",
						size: 2048,
						modified: "2024-01-01T00:00:00",
					},
					{
						name: "notes.txt",
						type: "file",
						size: 512,
						modified: "2024-01-01T00:00:00",
					},
				],
				total: 2,
			});
		}

		// Default: empty directory
		return HttpResponse.json({
			path,
			items: [],
			total: 0,
		});
	}),

	// Preview - Start stream
	// Preview - Start file preview
	http.get(`${API_BASE}/preview/:connectionId/start`, ({ request }) => {
		const authHeader = request.headers.get("Authorization");

		if (!authHeader || !authHeader.startsWith("Bearer ")) {
			return HttpResponse.json(
				{ detail: "Could not validate credentials" },
				{ status: 401 },
			);
		}

		const url = new URL(request.url);
		const path = url.searchParams.get("path") || "";

		return HttpResponse.json({
			stream_id: "stream-123",
			file_path: path,
			mime_type: "text/plain",
			size: 1024,
		});
	}),
];
