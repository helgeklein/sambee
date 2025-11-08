import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Connection, User } from "../../types";
import AdminPanel from "../AdminPanel";

// Mock the API module
vi.mock("../../services/api", () => ({
	default: {
		getCurrentUser: vi.fn(),
		getConnections: vi.fn(),
		testConnection: vi.fn(),
		deleteConnection: vi.fn(),
	},
}));

// Mock react-router-dom
const mockNavigate = vi.fn();
vi.mock("react-router-dom", () => ({
	useNavigate: () => mockNavigate,
}));

import api from "../../services/api";

const mockAdminUser: User = {
	username: "admin",
	is_admin: true,
	created_at: "2024-01-01T00:00:00",
};

const mockRegularUser: User = {
	username: "user",
	is_admin: false,
	created_at: "2024-01-01T00:00:00",
};

const mockConnections: Connection[] = [
	{
		id: "1",
		name: "Test Server 1",
		type: "smb",
		host: "192.168.1.100",
		port: 445,
		share_name: "share1",
		username: "user1",
		path_prefix: "/",
		created_at: "2024-01-01T00:00:00",
		updated_at: "2024-01-01T00:00:00",
	},
	{
		id: "2",
		name: "Test Server 2",
		type: "smb",
		host: "192.168.1.101",
		port: 445,
		share_name: "share2",
		username: "user2",
		path_prefix: "/",
		created_at: "2024-01-02T00:00:00",
		updated_at: "2024-01-02T00:00:00",
	},
];

describe("AdminPanel Component", () => {
	beforeEach(() => {
		localStorage.clear();
		vi.clearAllMocks();
		mockNavigate.mockClear();
	});

	it("redirects to login if user is not authenticated", async () => {
		vi.mocked(api.getCurrentUser).mockRejectedValueOnce(
			new Error("Unauthorized"),
		);
		vi.mocked(api.getConnections).mockResolvedValueOnce([]);

		render(<AdminPanel />);

		await waitFor(() => {
			expect(mockNavigate).toHaveBeenCalledWith("/login");
		});
	});

	it("redirects to browser if user is not admin", async () => {
		vi.mocked(api.getCurrentUser).mockResolvedValueOnce(mockRegularUser);
		vi.mocked(api.getConnections).mockResolvedValueOnce([]);

		render(<AdminPanel />);

		await waitFor(() => {
			expect(mockNavigate).toHaveBeenCalledWith("/browser");
		});

		// Should show error notification
		await waitFor(() => {
			expect(
				screen.getByText(/access denied.*admin privileges required/i),
			).toBeInTheDocument();
		});
	});

	it("displays connection list for admin users", async () => {
		vi.mocked(api.getCurrentUser).mockResolvedValueOnce(mockAdminUser);
		vi.mocked(api.getConnections).mockResolvedValueOnce(mockConnections);

		render(<AdminPanel />);

		// Wait for loading to complete
		await waitFor(() => {
			expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
		});

		// Check that connections are displayed
		expect(screen.getByText("Test Server 1")).toBeInTheDocument();
		expect(screen.getByText("Test Server 2")).toBeInTheDocument();
	});

	it("shows loading state while fetching connections", async () => {
		vi.mocked(api.getCurrentUser).mockResolvedValueOnce(mockAdminUser);
		vi.mocked(api.getConnections).mockImplementation(
			() =>
				new Promise((resolve) =>
					setTimeout(() => resolve(mockConnections), 100),
				),
		);

		render(<AdminPanel />);

		// Should show loading spinner
		expect(screen.getByRole("progressbar")).toBeInTheDocument();

		// Wait for loading to complete
		await waitFor(() => {
			expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
		});
	});

	it("opens add connection dialog when Add Connection button is clicked", async () => {
		vi.mocked(api.getCurrentUser).mockResolvedValueOnce(mockAdminUser);
		vi.mocked(api.getConnections).mockResolvedValueOnce(mockConnections);

		const user = userEvent.setup();
		render(<AdminPanel />);

		await waitFor(() => {
			expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
		});

		// Click Add Connection button
		const addButton = screen.getByRole("button", { name: /add connection/i });
		await user.click(addButton);

		// Dialog should be open - check for dialog title or content
		// Note: The actual dialog content depends on ConnectionDialog component
		await waitFor(() => {
			expect(screen.getByRole("dialog")).toBeInTheDocument();
		});
	});

	it("handles connection test successfully", async () => {
		vi.mocked(api.getCurrentUser).mockResolvedValueOnce(mockAdminUser);
		vi.mocked(api.getConnections).mockResolvedValueOnce(mockConnections);
		vi.mocked(api.testConnection).mockResolvedValueOnce({
			status: "success",
			message: "Connection test successful",
		});

		const user = userEvent.setup();
		render(<AdminPanel />);

		await waitFor(() => {
			expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
		});

		// Find and click test button for first connection
		// Note: Button text/role depends on ConnectionList component implementation
		const testButtons = screen.getAllByRole("button", { name: /test/i });
		await user.click(testButtons[0]);

		// Should show success notification
		await waitFor(() => {
			expect(
				screen.getByText(/connection test successful/i),
			).toBeInTheDocument();
		});
	});

	it("handles connection deletion", async () => {
		vi.mocked(api.getCurrentUser).mockResolvedValueOnce(mockAdminUser);
		vi.mocked(api.getConnections)
			.mockResolvedValueOnce(mockConnections)
			.mockResolvedValueOnce([mockConnections[1]]); // After deletion
		vi.mocked(api.deleteConnection).mockResolvedValueOnce(undefined);

		const user = userEvent.setup();
		render(<AdminPanel />);

		await waitFor(() => {
			expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
		});

		// Find and click delete button for first connection
		const deleteButtons = screen.getAllByRole("button", { name: /delete/i });
		await user.click(deleteButtons[0]);

		// Confirm deletion in dialog
		await waitFor(() => {
			expect(screen.getByRole("dialog")).toBeInTheDocument();
		});

		const confirmButton = screen.getByRole("button", {
			name: /confirm|delete/i,
		});
		await user.click(confirmButton);

		// Should show success notification
		await waitFor(() => {
			expect(
				screen.getByText(/connection deleted successfully/i),
			).toBeInTheDocument();
		});

		// Should reload connections
		expect(api.getConnections).toHaveBeenCalledTimes(2);
	});

	it("displays error message when loading connections fails", async () => {
		vi.mocked(api.getCurrentUser).mockResolvedValueOnce(mockAdminUser);
		vi.mocked(api.getConnections).mockRejectedValueOnce({
			response: { data: { detail: "Network error" } },
		});

		render(<AdminPanel />);

		await waitFor(() => {
			expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
		});

		// Should show error notification
		expect(screen.getByText(/network error/i)).toBeInTheDocument();
	});
});
