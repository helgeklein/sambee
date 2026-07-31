import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "../../test/utils/test-utils";
import Login from "../Login";

// Mock the entire API module
vi.mock("../../services/api", () => ({
  login: vi.fn(),
}));

vi.mock("../../services/authConfig", () => ({
  getAuthConfig: vi.fn(),
}));

// Import the mocked function so we can control it
import { login as mockLogin } from "../../services/api";
import { getAuthConfig as mockGetAuthConfig } from "../../services/authConfig";

describe("Login Component", () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
    // Clear all mocks
    vi.clearAllMocks();
    sessionStorage.clear();
    window.history.replaceState(null, "", "/login");
    window.location.search = "";
    window.location.hash = "";
    vi.mocked(window.location.assign).mockClear();
    vi.mocked(mockGetAuthConfig).mockResolvedValue({ sign_in_mode: "password_only", oidc: null });
  });

  it("renders login form with all elements", async () => {
    render(<Login />);

    // Wait for auth config check to complete
    await waitFor(() => {
      expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
    });

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

    // Wait for auth config check to complete
    await waitFor(() => {
      expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
    });

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
      role: "admin",
    });

    const user = userEvent.setup();
    render(<Login />);

    // Wait for auth config check to complete
    await waitFor(() => {
      expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
    });

    // Fill in form with valid credentials
    await user.type(screen.getByLabelText(/username/i), "admin");
    await user.type(screen.getByLabelText(/password/i), "admin");

    // Submit form
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(mockLogin).toHaveBeenCalledWith("admin", "admin"));

    // Verify login was called with correct credentials
    expect(mockLogin).toHaveBeenCalledWith("admin", "admin");
  });
  it("displays error message with invalid credentials", async () => {
    // Mock failed login
    vi.mocked(mockLogin).mockRejectedValueOnce(new Error("Unauthorized"));

    const user = userEvent.setup();
    render(<Login />);

    // Wait for auth config check to complete
    await waitFor(() => {
      expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
    });

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

    // Wait for auth config check to complete
    await waitFor(() => {
      expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
    });

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
      role: "admin",
    });
    await user.type(screen.getByLabelText(/username/i), "admin");
    await user.type(screen.getByLabelText(/password/i), "admin");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(mockLogin).toHaveBeenCalledTimes(2));
  });

  it("submits form when pressing Enter key", async () => {
    // Mock successful login
    vi.mocked(mockLogin).mockResolvedValueOnce({
      access_token: "mock-admin-token",
      token_type: "bearer",
      username: "admin",
      role: "admin",
    });

    const user = userEvent.setup();
    render(<Login />);

    // Wait for auth config check to complete
    await waitFor(() => {
      expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
    });

    // Fill in form
    const usernameInput = screen.getByLabelText(/username/i);
    const passwordInput = screen.getByLabelText(/password/i);

    await user.type(usernameInput, "admin");
    await user.type(passwordInput, "admin");

    // Press Enter in password field
    await user.keyboard("{Enter}");

    await waitFor(() => expect(mockLogin).toHaveBeenCalledWith("admin", "admin"));
  });

  it("works with different valid user credentials", async () => {
    // Mock successful login for non-admin user
    vi.mocked(mockLogin).mockResolvedValueOnce({
      access_token: "mock-user-token",
      token_type: "bearer",
      username: "testuser",
      role: "editor",
    });

    const user = userEvent.setup();
    render(<Login />);

    // Wait for auth config check to complete
    await waitFor(() => {
      expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
    });

    // Use the non-admin test user
    await user.type(screen.getByLabelText(/username/i), "testuser");
    await user.type(screen.getByLabelText(/password/i), "testpass");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(mockLogin).toHaveBeenCalledWith("testuser", "testpass"));
  });

  it("shows provider and password sign-in together in OIDC or password mode", async () => {
    vi.mocked(mockGetAuthConfig).mockResolvedValueOnce({
      sign_in_mode: "oidc_or_password",
      oidc: { display_name: "Example Identity", authorization_path: "/api/auth/oidc/authorize" },
    });

    render(<Login />);

    const providerButton = await screen.findByRole("button", { name: "Sign in with Example Identity" });
    expect(providerButton).toHaveClass("MuiButton-contained");
    expect(screen.getByRole("button", { name: "Sign in with password" })).toHaveClass("MuiButton-outlined");
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it("renders no controls while authentication mode is unknown", () => {
    vi.mocked(mockGetAuthConfig).mockReturnValueOnce(new Promise(() => undefined));

    render(<Login />);

    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/username/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows only a retry state when authentication configuration is unavailable", async () => {
    vi.mocked(mockGetAuthConfig).mockRejectedValueOnce(new Error("Unavailable"));

    render(<Login />);

    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Authentication is temporarily unavailable");
    expect(screen.queryByLabelText(/username/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  });

  it("clears the configuration error after a successful retry", async () => {
    const user = userEvent.setup();
    vi.mocked(mockGetAuthConfig)
      .mockRejectedValueOnce(new Error("Unavailable"))
      .mockResolvedValueOnce({ sign_in_mode: "password_only", oidc: null });

    render(<Login />);

    await user.click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("preserves a sanitized return path for automatic OIDC-only sign-in", async () => {
    window.location.search = "?return_path=%2Fsettings%2Fappearance%3Ftab%3Dtheme";
    vi.mocked(mockGetAuthConfig).mockResolvedValueOnce({
      sign_in_mode: "oidc_only",
      oidc: { display_name: "Example Identity", authorization_path: "/api/auth/oidc/authorize" },
    });

    render(<Login />);

    await waitFor(() =>
      expect(window.location.assign).toHaveBeenCalledWith("/api/auth/oidc/authorize?return_path=%2Fsettings%2Fappearance%3Ftab%3Dtheme")
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows only retry after an OIDC-only automatic attempt returns", async () => {
    sessionStorage.setItem("sambee_oidc_attempted", "1");
    vi.mocked(mockGetAuthConfig).mockResolvedValueOnce({
      sign_in_mode: "oidc_only",
      oidc: { display_name: "Example Identity", authorization_path: "/api/auth/oidc/authorize" },
    });

    render(<Login />);

    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/username/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  });

  it("shows a stable OIDC error and clears it from browser history", async () => {
    const replaceState = vi.spyOn(window.history, "replaceState");
    sessionStorage.setItem("sambee_oidc_attempted", "1");
    window.location.hash = "error=oidc_required_claim_missing";
    vi.mocked(mockGetAuthConfig).mockResolvedValueOnce({
      sign_in_mode: "oidc_only",
      oidc: { display_name: "Example Identity", authorization_path: "/api/auth/oidc/authorize" },
    });

    render(<Login />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/did not supply required account information/i);
    expect(replaceState).toHaveBeenCalledWith(null, "", window.location.pathname + window.location.search);
  });

  it("shows a provider failure alongside password login in mixed mode", async () => {
    window.location.hash = "error=oidc_provider_unavailable";
    vi.mocked(mockGetAuthConfig).mockResolvedValueOnce({
      sign_in_mode: "oidc_or_password",
      oidc: { display_name: "Example Identity", authorization_path: "/api/auth/oidc/authorize" },
    });

    render(<Login />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/identity provider is temporarily unavailable/i);
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });
});
