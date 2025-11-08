import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Connection } from "../../../types";
import ConnectionDialog from "../ConnectionDialog";

// Mock the API module
vi.mock("../../../services/api", () => ({
	default: {
		createConnection: vi.fn(),
		updateConnection: vi.fn(),
		testConnection: vi.fn(),
		deleteConnection: vi.fn(),
	},
}));

import api from "../../../services/api";

const mockConnection: Connection = {
	id: "1",
	name: "Test Server",
	type: "smb",
	host: "192.168.1.100",
	port: 445,
	share_name: "share1",
	username: "testuser",
	path_prefix: "/",
	created_at: "2024-01-01T00:00:00",
	updated_at: "2024-01-01T00:00:00",
};

describe("ConnectionDialog Component", () => {
	const mockOnClose = vi.fn();
	const mockOnSave = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders form fields for new connection", () => {
		render(
			<ConnectionDialog
				open={true}
				onClose={mockOnClose}
				onSave={mockOnSave}
			/>,
		);

		expect(
			screen.getByRole("heading", { name: /add new connection/i }),
		).toBeInTheDocument();
		expect(screen.getByLabelText(/connection name/i)).toBeInTheDocument();
		expect(screen.getByLabelText(/host/i)).toBeInTheDocument();
		expect(screen.getByLabelText(/share name/i)).toBeInTheDocument();
		expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
		// Password field - use getAllByLabelText and filter to get the input
		const passwordFields = screen.getAllByLabelText(/password/i);
		const passwordInput = passwordFields.find((el) => el.tagName === "INPUT");
		expect(passwordInput).toBeInTheDocument();
		expect(screen.getByLabelText(/path prefix/i)).toBeInTheDocument();
	});

	it("renders form with existing connection data in edit mode", () => {
		render(
			<ConnectionDialog
				open={true}
				onClose={mockOnClose}
				onSave={mockOnSave}
				connection={mockConnection}
			/>,
		);

		expect(
			screen.getByRole("heading", { name: /edit connection/i }),
		).toBeInTheDocument();
		expect(screen.getByLabelText(/connection name/i)).toHaveValue(
			"Test Server",
		);
		expect(screen.getByLabelText(/host/i)).toHaveValue("192.168.1.100");
		expect(screen.getByLabelText(/share name/i)).toHaveValue("share1");
		expect(screen.getByLabelText(/username/i)).toHaveValue("testuser");
		// Password should be empty for security - use getAllByLabelText and filter
		const passwordFields = screen.getAllByLabelText(/password/i);
		const passwordInput = passwordFields.find(
			(el) => el.tagName === "INPUT",
		) as HTMLInputElement;
		expect(passwordInput).toHaveValue("");
		expect(screen.getByLabelText(/path prefix/i)).toHaveValue("/");
	});

	it("validates required fields", async () => {
		const user = userEvent.setup();
		render(
			<ConnectionDialog
				open={true}
				onClose={mockOnClose}
				onSave={mockOnSave}
			/>,
		);

		// Try to save without filling any fields
		const saveButton = screen.getByRole("button", { name: /^save$/i });
		await user.click(saveButton);

		// Should show validation errors
		await waitFor(() => {
			expect(
				screen.getByText(/connection name is required/i),
			).toBeInTheDocument();
			expect(screen.getByText(/host is required/i)).toBeInTheDocument();
			expect(screen.getByText(/share name is required/i)).toBeInTheDocument();
			expect(screen.getByText(/username is required/i)).toBeInTheDocument();
			expect(screen.getByText(/password is required/i)).toBeInTheDocument();
		});

		// Should not call API
		expect(api.createConnection).not.toHaveBeenCalled();
	});

	it("creates new connection with valid data", async () => {
		vi.mocked(api.createConnection).mockResolvedValueOnce(mockConnection);

		const user = userEvent.setup();
		render(
			<ConnectionDialog
				open={true}
				onClose={mockOnClose}
				onSave={mockOnSave}
			/>,
		);

		// Fill in form
		await user.type(screen.getByLabelText(/connection name/i), "New Server");
		await user.type(screen.getByLabelText(/host/i), "192.168.1.200");
		await user.type(screen.getByLabelText(/share name/i), "newshare");
		await user.type(screen.getByLabelText(/username/i), "newuser");
		// Get password input using getAllByLabelText
		const passwordFields = screen.getAllByLabelText(/password/i);
		const passwordInput = passwordFields.find(
			(el) => el.tagName === "INPUT",
		) as HTMLElement;
		await user.type(passwordInput, "newpass");

		// Save
		const saveButton = screen.getByRole("button", { name: /^save$/i });
		await user.click(saveButton);

		await waitFor(() => {
			expect(api.createConnection).toHaveBeenCalledWith({
				name: "New Server",
				type: "smb",
				host: "192.168.1.200",
				port: 445,
				share_name: "newshare",
				username: "newuser",
				password: "newpass",
				path_prefix: "/",
			});
		});

		expect(mockOnSave).toHaveBeenCalled();
		expect(mockOnClose).toHaveBeenCalled();
	});

	it("updates existing connection", async () => {
		vi.mocked(api.updateConnection).mockResolvedValueOnce(mockConnection);

		const user = userEvent.setup();
		render(
			<ConnectionDialog
				open={true}
				onClose={mockOnClose}
				onSave={mockOnSave}
				connection={mockConnection}
			/>,
		);

		// Change the name
		const nameField = screen.getByLabelText(/connection name/i);
		await user.clear(nameField);
		await user.type(nameField, "Updated Server");

		// Save
		const saveButton = screen.getByRole("button", { name: /^save$/i });
		await user.click(saveButton);

		await waitFor(() => {
			expect(api.updateConnection).toHaveBeenCalledWith("1", {
				name: "Updated Server",
			});
		});

		expect(mockOnSave).toHaveBeenCalled();
		expect(mockOnClose).toHaveBeenCalled();
	});

	it("shows error message on save failure", async () => {
		vi.mocked(api.createConnection).mockRejectedValueOnce({
			response: { data: { detail: "Connection failed: Invalid credentials" } },
		});

		const user = userEvent.setup();
		render(
			<ConnectionDialog
				open={true}
				onClose={mockOnClose}
				onSave={mockOnSave}
			/>,
		);

		// Fill in form
		await user.type(screen.getByLabelText(/connection name/i), "New Server");
		await user.type(screen.getByLabelText(/host/i), "192.168.1.200");
		await user.type(screen.getByLabelText(/share name/i), "share");
		await user.type(screen.getByLabelText(/username/i), "user");
		// Get password input using getAllByLabelText
		const passwordFields = screen.getAllByLabelText(/password/i);
		const passwordInput = passwordFields.find(
			(el) => el.tagName === "INPUT",
		) as HTMLElement;
		await user.type(passwordInput, "wrongpass");

		// Save
		const saveButton = screen.getByRole("button", { name: /^save$/i });
		await user.click(saveButton);

		// Should show error
		await waitFor(() => {
			expect(
				screen.getByText(/connection failed: invalid credentials/i),
			).toBeInTheDocument();
		});

		// Should not call onSave or onClose
		expect(mockOnSave).not.toHaveBeenCalled();
		expect(mockOnClose).not.toHaveBeenCalled();
	});

	it("closes dialog on cancel", async () => {
		const user = userEvent.setup();
		render(
			<ConnectionDialog
				open={true}
				onClose={mockOnClose}
				onSave={mockOnSave}
			/>,
		);

		const cancelButton = screen.getByRole("button", { name: /cancel/i });
		await user.click(cancelButton);

		expect(mockOnClose).toHaveBeenCalled();
		expect(mockOnSave).not.toHaveBeenCalled();
	});

	it("tests connection successfully", async () => {
		vi.mocked(api.testConnection).mockResolvedValueOnce({
			status: "success",
			message: "Connection test successful",
		});

		const user = userEvent.setup();
		render(
			<ConnectionDialog
				open={true}
				onClose={mockOnClose}
				onSave={mockOnSave}
				connection={mockConnection}
			/>,
		);

		// Click test connection button
		const testButton = screen.getByRole("button", { name: /test connection/i });
		await user.click(testButton);

		await waitFor(() => {
			expect(
				screen.getByText(/connection test successful/i),
			).toBeInTheDocument();
		});
	});

	it("toggles password visibility", async () => {
		const user = userEvent.setup();
		render(
			<ConnectionDialog
				open={true}
				onClose={mockOnClose}
				onSave={mockOnSave}
			/>,
		);

		// Get password input using getAllByLabelText
		const passwordFields = screen.getAllByLabelText(/password/i);
		const passwordInput = passwordFields.find(
			(el) => el.tagName === "INPUT",
		) as HTMLInputElement;
		expect(passwordInput).toHaveAttribute("type", "password");

		// Click visibility toggle
		const toggleButton = screen.getByRole("button", {
			name: /toggle password visibility/i,
		});
		await user.click(toggleButton);

		// Password should now be visible
		expect(passwordInput).toHaveAttribute("type", "text");

		// Click again to hide
		await user.click(toggleButton);
		expect(passwordInput).toHaveAttribute("type", "password");
	});
});
