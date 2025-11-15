/**
 * Browse → Preview Flow Integration Tests (Phase 3)
 *
 * Tests the preview functionality using MSW to mock file content API.
 * Note: Full browse navigation is tested in unit tests. These integration tests
 * focus on the preview dialog interaction and file content loading.
 *
 * TODO: E2E Tests for Preview Flow
 * The following scenarios cannot be tested with MSW in jsdom due to GET request interception
 * issues. These should be implemented as E2E tests (Playwright/Cypress):
 *
 * Happy Path:
 * - Load and display markdown preview with formatted content
 * - Display plain text file preview
 * - Close preview with close button click
 * - Close preview with ESC key press
 *
 * Different File Types:
 * - Render markdown with headers (h1, h2, h3)
 * - Render markdown with lists (ordered/unordered)
 * - Render markdown with code blocks and syntax highlighting
 * - Render markdown with links and verify href attributes
 *
 * Large Files:
 * - Handle large markdown files without performance issues
 * - Handle large text files
 *
 * Loading States:
 * - Show loading indicator while fetching content
 * - Hide loading indicator after content loads
 *
 * Path Display:
 * - Display full file path in dialog title
 * - Display root-level file paths correctly
 */

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import MarkdownPreview from "../../components/Preview/MarkdownPreview";
import { mockApiError } from "../../test/integration-utils";

describe("Browse → Preview Flow", () => {
  beforeEach(() => {
    // Clear any previous state
    localStorage.clear();
    // Set up auth token for API requests
    localStorage.setItem("access_token", "mock-token");
  });

  describe("Error Handling", () => {
    it("should show error when file preview fails", async () => {
      // Mock API error for preview endpoint
      mockApiError("http://localhost:8000/api/preview", 500);

      render(<MarkdownPreview connectionId="test-conn" path="/broken.md" onClose={() => {}} />);

      // Wait for error message
      await waitFor(() => {
        expect(screen.getByText(/failed to load markdown file/i)).toBeInTheDocument();
      });

      // Loading indicator should be gone
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    });

    it("should show error for unauthorized access", async () => {
      mockApiError("http://localhost:8000/api/preview", 401);

      render(<MarkdownPreview connectionId="test-conn" path="/secure.md" onClose={() => {}} />);

      // Wait for error message
      await waitFor(() => {
        expect(screen.getByText(/failed to load markdown file/i)).toBeInTheDocument();
      });
    });

    it("should handle network errors gracefully", async () => {
      mockApiError("http://localhost:8000/api/preview", 0); // Network error

      render(<MarkdownPreview connectionId="test-conn" path="/test.md" onClose={() => {}} />);

      // Should show error
      await waitFor(() => {
        expect(screen.getByText(/failed to load markdown file/i)).toBeInTheDocument();
      });
    });
  });
});
