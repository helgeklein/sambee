import type { AxiosResponse } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	AuthToken,
	Connection,
	ConnectionCreate,
	DirectoryListing,
	User,
} from "../../types";
import { FileType } from "../../types";

// Mock axios before importing the API service - use factory function
// The factory needs to define the mock instance inside
vi.mock("axios", () => {
	const mockAxiosInstance = {
		get: vi.fn(),
		post: vi.fn(),
		put: vi.fn(),
		delete: vi.fn(),
		interceptors: {
			request: {
				use: vi.fn(),
				eject: vi.fn(),
			},
			response: {
				use: vi.fn(),
				eject: vi.fn(),
			},
		},
	};

	return {
		default: {
			create: vi.fn(() => mockAxiosInstance),
		},
	};
});

// Get reference to the mocked functions for assertions
import axios from "axios";
// Now import the API service (it will use the mocked axios.create)
import apiService from "../api";

const mockedAxios = vi.mocked(axios);
const mockAxiosInstance = mockedAxios.create() as ReturnType<
	typeof mockedAxios.create
> & {
	get: ReturnType<typeof vi.fn>;
	post: ReturnType<typeof vi.fn>;
	put: ReturnType<typeof vi.fn>;
	delete: ReturnType<typeof vi.fn>;
};

describe("API Service", () => {
	beforeEach(() => {
		// Clear localStorage
		localStorage.clear();

		// Reset all mock function calls
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe("Authentication", () => {
		it("login() sets access token and returns auth data", async () => {
			const mockAuthToken: AuthToken = {
				access_token: "test-token",
				token_type: "bearer",
				username: "testuser",
				is_admin: false,
			};

			mockAxiosInstance.post.mockResolvedValueOnce({
				data: mockAuthToken,
			} as AxiosResponse);

			const result = await apiService.login("testuser", "password123");

			expect(result).toEqual(mockAuthToken);
			expect(localStorage.getItem("access_token")).toBe("test-token");
			expect(mockAxiosInstance.post).toHaveBeenCalledWith(
				"/auth/token",
				expect.any(FormData),
			);
		});

		it("login() throws on invalid credentials", async () => {
			mockAxiosInstance.post.mockRejectedValueOnce({
				response: { status: 401, data: { detail: "Invalid credentials" } },
			});

			await expect(apiService.login("wrong", "wrong")).rejects.toMatchObject({
				response: { status: 401 },
			});

			expect(localStorage.getItem("access_token")).toBeNull();
		});

		it("getCurrentUser() returns user data", async () => {
			const mockUser: User = {
				username: "testuser",
				is_admin: false,
			};

			mockAxiosInstance.get.mockResolvedValueOnce({
				data: mockUser,
			} as AxiosResponse);

			const result = await apiService.getCurrentUser();

			expect(result).toEqual(mockUser);
			expect(mockAxiosInstance.get).toHaveBeenCalledWith("/auth/me");
		});

		it("changePassword() sends correct request", async () => {
			mockAxiosInstance.post.mockResolvedValueOnce({ data: {} });

			await apiService.changePassword("oldpass", "newpass");

			expect(mockAxiosInstance.post).toHaveBeenCalledWith(
				"/auth/change-password",
				{
					current_password: "oldpass",
					new_password: "newpass",
				},
			);
		});
	});

	describe("Connections Management", () => {
		it("getConnections() returns list of connections", async () => {
			const mockConnections: Connection[] = [
				{
					id: "1",
					name: "Test Server",
					type: "smb",
					host: "192.168.1.100",
					port: 445,
					share_name: "public",
					username: "user",
					path_prefix: "",
					created_at: "2024-01-01T00:00:00Z",
					updated_at: "2024-01-01T00:00:00Z",
				},
				{
					id: "2",
					name: "Backup Server",
					type: "smb",
					host: "192.168.1.200",
					port: 445,
					share_name: "backup",
					username: "admin",
					path_prefix: "",
					created_at: "2024-01-01T00:00:00Z",
					updated_at: "2024-01-01T00:00:00Z",
				},
			];

			mockAxiosInstance.get.mockResolvedValueOnce({
				data: mockConnections,
			} as AxiosResponse);

			const result = await apiService.getConnections();

			expect(result).toEqual(mockConnections);
			expect(mockAxiosInstance.get).toHaveBeenCalledWith("/admin/connections");
		});

		it("createConnection() posts data and returns new connection", async () => {
			const newConnection: ConnectionCreate = {
				name: "New Server",
				type: "smb",
				host: "192.168.1.50",
				port: 445,
				share_name: "data",
				username: "user",
				password: "pass",
				path_prefix: "",
			};

			const createdConnection: Connection = {
				id: "3",
				name: "New Server",
				type: "smb",
				host: "192.168.1.50",
				port: 445,
				share_name: "data",
				username: "user",
				path_prefix: "",
				created_at: "2024-01-01T00:00:00Z",
				updated_at: "2024-01-01T00:00:00Z",
			};

			mockAxiosInstance.post.mockResolvedValueOnce({
				data: createdConnection,
			} as AxiosResponse);

			const result = await apiService.createConnection(newConnection);

			expect(result).toEqual(createdConnection);
			expect(mockAxiosInstance.post).toHaveBeenCalledWith(
				"/admin/connections",
				newConnection,
			);
		});

		it("updateConnection() updates data and returns updated connection", async () => {
			const updates: Partial<ConnectionCreate> = {
				name: "Updated Server",
				share_name: "newshare",
			};

			const updatedConnection: Connection = {
				id: "1",
				name: "Updated Server",
				type: "smb",
				host: "192.168.1.100",
				port: 445,
				share_name: "newshare",
				username: "user",
				path_prefix: "",
				created_at: "2024-01-01T00:00:00Z",
				updated_at: "2024-01-02T00:00:00Z",
			};

			mockAxiosInstance.put.mockResolvedValueOnce({
				data: updatedConnection,
			} as AxiosResponse);

			const result = await apiService.updateConnection("1", updates);

			expect(result).toEqual(updatedConnection);
			expect(mockAxiosInstance.put).toHaveBeenCalledWith(
				"/admin/connections/1",
				updates,
			);
		});

		it("deleteConnection() removes connection", async () => {
			mockAxiosInstance.delete.mockResolvedValueOnce({ data: {} });

			await apiService.deleteConnection("1");

			expect(mockAxiosInstance.delete).toHaveBeenCalledWith(
				"/admin/connections/1",
			);
		});

		it("testConnection() returns status", async () => {
			const mockStatus = {
				status: "success",
				message: "Connection successful",
			};

			mockAxiosInstance.post.mockResolvedValueOnce({
				data: mockStatus,
			} as AxiosResponse);

			const result = await apiService.testConnection("1");

			expect(result).toEqual(mockStatus);
			expect(mockAxiosInstance.post).toHaveBeenCalledWith(
				"/admin/connections/1/test",
			);
		});
	});

	describe("Browse Operations", () => {
		it("listDirectory() returns file listing for root path", async () => {
			const mockListing: DirectoryListing = {
				path: "/",
				items: [
					{
						name: "Documents",
						path: "/Documents",
						type: FileType.DIRECTORY,
						size: 0,
						modified_at: "2024-01-01T10:00:00",
						is_readable: true,
						is_hidden: false,
					},
					{
						name: "file.txt",
						path: "/file.txt",
						type: FileType.FILE,
						size: 1024,
						modified_at: "2024-01-01T11:00:00",
						is_readable: true,
						is_hidden: false,
					},
				],
				total: 2,
			};

			mockAxiosInstance.get.mockResolvedValueOnce({
				data: mockListing,
			} as AxiosResponse);

			const result = await apiService.listDirectory("conn1", "");

			expect(result).toEqual(mockListing);
			expect(mockAxiosInstance.get).toHaveBeenCalledWith("/browse/conn1/list", {
				params: { path: "" },
			});
		});

		it("listDirectory() handles nested paths correctly", async () => {
			const mockListing: DirectoryListing = {
				path: "/Documents/Work",
				items: [
					{
						name: "report.pdf",
						path: "/Documents/Work/report.pdf",
						type: FileType.FILE,
						size: 2048,
						modified_at: "2024-01-02T10:00:00",
						is_readable: true,
						is_hidden: false,
					},
				],
				total: 1,
			};

			mockAxiosInstance.get.mockResolvedValueOnce({
				data: mockListing,
			} as AxiosResponse);

			const result = await apiService.listDirectory("conn1", "/Documents/Work");

			expect(result).toEqual(mockListing);
			expect(mockAxiosInstance.get).toHaveBeenCalledWith("/browse/conn1/list", {
				params: { path: "/Documents/Work" },
			});
		});

		it("getFileInfo() returns file metadata", async () => {
			const mockFileInfo = {
				name: "document.pdf",
				path: "/document.pdf",
				type: FileType.FILE,
				size: 5120,
				modified_at: "2024-01-03T10:00:00",
				is_readable: true,
				is_hidden: false,
			};

			mockAxiosInstance.get.mockResolvedValueOnce({
				data: mockFileInfo,
			} as AxiosResponse);

			const result = await apiService.getFileInfo("conn1", "/document.pdf");

			expect(result).toEqual(mockFileInfo);
			expect(mockAxiosInstance.get).toHaveBeenCalledWith("/browse/conn1/info", {
				params: { path: "/document.pdf" },
			});
		});
	});

	describe("Preview Operations", () => {
		it("getPreviewUrl() constructs correct URL with token", () => {
			localStorage.setItem("access_token", "preview-token");

			const url = apiService.getPreviewUrl("conn1", "/test.pdf");

			expect(url).toContain("/preview/conn1/file");
			expect(url).toContain("path=%2Ftest.pdf");
			expect(url).toContain("token=preview-token");
		});

		it("getDownloadUrl() constructs correct URL with token", () => {
			localStorage.setItem("access_token", "download-token");

			const url = apiService.getDownloadUrl("conn1", "/data.zip");

			expect(url).toContain("/preview/conn1/download");
			expect(url).toContain("path=%2Fdata.zip");
			expect(url).toContain("token=download-token");
		});

		it("getFileContent() fetches file content as text", async () => {
			localStorage.setItem("access_token", "content-token");

			mockAxiosInstance.get.mockResolvedValueOnce({
				data: "File content here",
			} as AxiosResponse);

			const result = await apiService.getFileContent("conn1", "/readme.txt");

			expect(result).toBe("File content here");
			expect(mockAxiosInstance.get).toHaveBeenCalledWith(
				"/preview/conn1/file",
				{
					params: { path: "/readme.txt" },
					headers: {
						Authorization: "Bearer content-token",
					},
					responseType: "text",
				},
			);
		});
	});

	describe("Error Handling", () => {
		it("network errors are propagated", async () => {
			mockAxiosInstance.get.mockRejectedValueOnce(new Error("Network error"));

			await expect(apiService.getConnections()).rejects.toThrow(
				"Network error",
			);
		});

		it("500 errors are propagated", async () => {
			mockAxiosInstance.get.mockRejectedValueOnce({
				response: { status: 500, data: { detail: "Server error" } },
			});

			await expect(
				apiService.listDirectory("conn1", "/"),
			).rejects.toMatchObject({
				response: { status: 500 },
			});
		});
	});

	describe("Convenience Functions", () => {
		it("login() convenience function works", async () => {
			const authResponse: AxiosResponse<AuthToken> = {
				data: {
					access_token: "token123",
					token_type: "bearer",
					username: "testuser",
					is_admin: false,
				},
				status: 200,
				statusText: "OK",
				headers: {},
				config: {
					headers: {},
				} as unknown as AxiosResponse["config"],
			};
			mockAxiosInstance.post.mockResolvedValueOnce(authResponse);

			const { login } = await import("../api");
			const result = await login("user", "pass");

			expect(result).toEqual(authResponse.data);
			expect(localStorage.getItem("access_token")).toBe("token123");
		});

		it("browseFiles() convenience function returns items from first connection", async () => {
			const connections: Connection[] = [
				{
					id: "conn1",
					name: "Test",
					type: "smb",
					host: "192.168.1.100",
					port: 445,
					share_name: "share",
					username: "user",
					path_prefix: "/",
					created_at: "2024-01-01T00:00:00",
					updated_at: "2024-01-01T00:00:00",
				},
			];

			const listing: DirectoryListing = {
				path: "/test",
				items: [
					{
						name: "file.txt",
						path: "/test/file.txt",
						type: FileType.FILE,
						size: 1024,
						is_readable: true,
						is_hidden: false,
						modified_at: "2024-01-01T00:00:00",
					},
				],
				total: 1,
			};

			mockAxiosInstance.get
				.mockResolvedValueOnce({ data: connections } as AxiosResponse<
					Connection[]
				>)
				.mockResolvedValueOnce({
					data: listing,
				} as AxiosResponse<DirectoryListing>);

			const { browseFiles } = await import("../api");
			const result = await browseFiles("/test", "token");

			expect(result).toEqual(listing.items);
			expect(mockAxiosInstance.get).toHaveBeenCalledWith("/admin/connections");
			expect(mockAxiosInstance.get).toHaveBeenCalledWith("/browse/conn1/list", {
				params: { path: "/test" },
			});
		});

		it("browseFiles() returns empty array when no connections exist", async () => {
			mockAxiosInstance.get.mockResolvedValueOnce({ data: [] } as AxiosResponse<
				Connection[]
			>);

			const { browseFiles } = await import("../api");
			const result = await browseFiles("/test", "token");

			expect(result).toEqual([]);
		});

		it("browseFiles() returns empty array on error", async () => {
			mockAxiosInstance.get.mockRejectedValueOnce(new Error("Network error"));

			const { browseFiles } = await import("../api");
			const consoleSpy = vi
				.spyOn(console, "error")
				.mockImplementation(() => {});

			const result = await browseFiles("/test", "token");

			expect(result).toEqual([]);
			expect(consoleSpy).toHaveBeenCalledWith(
				"Error browsing files:",
				expect.any(Error),
			);

			consoleSpy.mockRestore();
		});
	});
});
