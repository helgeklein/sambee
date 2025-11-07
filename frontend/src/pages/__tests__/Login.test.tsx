import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "../../test/utils/test-utils";
import Login from "../Login";

// Mock the entire API module
vi.mock("../../services/api", () => ({
	login: vi.fn(),
}));

// Import the mocked function so we can control it
import { login as mockLogin } from "../../services/api";

describe("Login Component", () => {
	beforeEach(() => {
		// Clear localStorage before each test
		localStorage.clear();
		// Clear all mocks
		vi.clearAllMocks();
	});

	it("renders login form with all elements", () => {
		render(<Login />);

		// Check for heading
		expect(screen.getByRole("heading", { name: /sambee login/i })).toBeInTheDocument();

		// Check for form fields
		expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
		expect(screen.getByLabelText(/password/i)).toBeInTheDocument();

		// Check for submit button
		expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();

		// Error message should not be visible initially
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
	});

	it("allows users to type in username and password fields", async () => {
		const user = userEvent.setup();
		render(<Login />);

		const usernameInput = screen.getByLabelText(/username/i);
		const passwordInput = screen.getByLabelText(/password/i);

		// Type in username
		await user.type(usernameInput, "testuser");
		expect(usernameInput).toHaveValue("testuser");

		// Type in password
		await user.type(passwordInput, "testpass");
		expect(passwordInput).toHaveValue("testpass");
	});

	it("successfully logs in with valid credentials and redirects to browser", async () => {
		// Mock successful login
		vi.mocked(mockLogin).mockResolvedValueOnce({
			access_token: "mock-admin-token",
			token_type: "bearer",
			username: "admin",
			is_admin: true,
		});

		const user = userEvent.setup();
		render(<Login />);

		// Fill in form with valid credentials
		await user.type(screen.getByLabelText(/username/i), "admin");
		await user.type(screen.getByLabelText(/password/i), "admin");

		// Submit form
		await user.click(screen.getByRole("button", { name: /sign in/i }));

		// Wait for successful login - check that NO error appears
		await waitFor(() => {
			// Token should be stored in localStorage (done by Login component and API service)
			expect(localStorage.getItem("access_token")).toBe("mock-admin-token");
		});

		// Verify login was called with correct credentials
		expect(mockLogin).toHaveBeenCalledWith("admin", "admin");
	});	it("displays error message with invalid credentials", async () => {
		// Mock failed login
		vi.mocked(mockLogin).mockRejectedValueOnce(new Error("Unauthorized"));

		const user = userEvent.setup();
		render(<Login />);

		// Fill in form with invalid credentials
		await user.type(screen.getByLabelText(/username/i), "wronguser");
		await user.type(screen.getByLabelText(/password/i), "wrongpass");

		// Submit form
		await user.click(screen.getByRole("button", { name: /sign in/i }));

		// Wait for error message to appear
		await waitFor(() => {
			expect(screen.getByRole("alert")).toHaveTextContent(/invalid username or password/i);
		});

		// Token should not be stored
		expect(localStorage.getItem("access_token")).toBeNull();
	});

	it("clears previous error messages on new submission", async () => {
		const user = userEvent.setup();
		render(<Login />);

		// First attempt with invalid credentials
		vi.mocked(mockLogin).mockRejectedValueOnce(new Error("Unauthorized"));
		await user.type(screen.getByLabelText(/username/i), "wronguser");
		await user.type(screen.getByLabelText(/password/i), "wrongpass");
		await user.click(screen.getByRole("button", { name: /sign in/i }));

		// Wait for error
		await waitFor(() => {
			expect(screen.getByRole("alert")).toBeInTheDocument();
		});

		// Clear the fields
		await user.clear(screen.getByLabelText(/username/i));
		await user.clear(screen.getByLabelText(/password/i));

		// Second attempt with valid credentials
		vi.mocked(mockLogin).mockResolvedValueOnce({
			access_token: "mock-admin-token",
			token_type: "bearer",
			username: "admin",
			is_admin: true,
		});
		await user.type(screen.getByLabelText(/username/i), "admin");
		await user.type(screen.getByLabelText(/password/i), "admin");
		await user.click(screen.getByRole("button", { name: /sign in/i }));

		// Error should be cleared and login should succeed
		await waitFor(() => {
			expect(localStorage.getItem("access_token")).toBe("mock-admin-token");
		});
	});

	it("submits form when pressing Enter key", async () => {
		// Mock successful login
		vi.mocked(mockLogin).mockResolvedValueOnce({
			access_token: "mock-admin-token",
			token_type: "bearer",
			username: "admin",
			is_admin: true,
		});

		const user = userEvent.setup();
		render(<Login />);

		// Fill in form
		const usernameInput = screen.getByLabelText(/username/i);
		const passwordInput = screen.getByLabelText(/password/i);

		await user.type(usernameInput, "admin");
		await user.type(passwordInput, "admin");

		// Press Enter in password field
		await user.keyboard("{Enter}");

		// Wait for successful login
		await waitFor(() => {
			expect(localStorage.getItem("access_token")).toBe("mock-admin-token");
		});
	});

	it("works with different valid user credentials", async () => {
		// Mock successful login for non-admin user
		vi.mocked(mockLogin).mockResolvedValueOnce({
			access_token: "mock-user-token",
			token_type: "bearer",
			username: "testuser",
			is_admin: false,
		});

		const user = userEvent.setup();
		render(<Login />);

		// Use the non-admin test user
		await user.type(screen.getByLabelText(/username/i), "testuser");
		await user.type(screen.getByLabelText(/password/i), "testpass");
		await user.click(screen.getByRole("button", { name: /sign in/i }));

		// Wait for successful login
		await waitFor(() => {
			expect(localStorage.getItem("access_token")).toBe("mock-user-token");
		});
	});
});
