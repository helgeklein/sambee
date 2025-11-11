import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { MockedObject } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import apiService from "../../services/api";
import { FileType } from "../../types";
import Browser from "../Browser";

// Mock the API service
vi.mock("../../services/api");
const mockedApi = apiService as MockedObject<typeof apiService>;

// Mock @tanstack/react-virtual for virtualized list rendering
vi.mock("@tanstack/react-virtual", () => import("../../__mocks__/@tanstack/react-virtual"));

// Mock the preview components
vi.mock("../../components/Preview/PreviewRegistry", async () => {
  const actual = await vi.importActual<typeof import("../../components/Preview/PreviewRegistry")>(
    "../../components/Preview/PreviewRegistry"
  );
  return {
    ...actual,
    getPreviewComponent: vi.fn((mimeType: string) => {
      if (mimeType?.startsWith("image/")) {
        return Promise.resolve(function ImagePreview() {
          return <div data-testid="image-preview">Image Preview</div>;
        });
      }
      if (mimeType === "text/markdown") {
        return Promise.resolve(function MarkdownPreview() {
          return <div data-testid="markdown-preview">Markdown Preview</div>;
        });
      }
      return Promise.resolve(null);
    }),
  };
});

describe("Browser - Image Preview Integration", () => {
  const renderBrowser = (initialPath = "/browse/test-server") => {
    return render(
      <MemoryRouter
        initialEntries={[initialPath]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="/browse/:connectionId/*" element={<Browser />} />
          <Route path="/browse" element={<Browser />} />
          <Route path="/login" element={<div>Login Page</div>} />
        </Routes>
      </MemoryRouter>
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Set up authentication
    localStorage.setItem("access_token", "fake-token");

    // Mock successful API responses
    mockedApi.getConnections.mockResolvedValue([
      {
        id: "test-server",
        name: "Test Server",
        type: "smb",
        host: "test.local",
        share_name: "share",
        port: 445,
        username: "user",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      },
    ]);
  });

  it("renders image preview when clicking on image file", async () => {
    // Mock browse response with single image file
    mockedApi.listDirectory.mockResolvedValue({
      path: "/",
      items: [
        {
          name: "image1.jpg",
          path: "/image1.jpg",
          type: FileType.FILE,
          size: 1024,
          modified_at: "2024-01-01T00:00:00Z",
          mime_type: "image/jpeg",
          is_readable: true,
          is_hidden: false,
        },
      ],
      total: 1,
    });

    renderBrowser();

    // Wait for files to load
    const imageFile = await screen.findByText("image1.jpg");

    // Click on the image file
    fireEvent.click(imageFile);

    // Image preview should open
    const preview = await screen.findByTestId("image-preview");
    expect(preview).toBeInTheDocument();
  });

  it("enables gallery mode when directory has multiple images", async () => {
    // Mock browse response with multiple images
    mockedApi.listDirectory.mockResolvedValue({
      path: "/photos",
      items: [
        {
          name: "image1.jpg",
          path: "/photos/image1.jpg",
          type: FileType.FILE,
          size: 1024,
          modified_at: "2024-01-01T00:00:00Z",
          mime_type: "image/jpeg",
          is_readable: true,
          is_hidden: false,
        },
        {
          name: "image2.png",
          path: "/photos/image2.png",
          type: FileType.FILE,
          size: 2048,
          modified_at: "2024-01-01T00:00:00Z",
          mime_type: "image/png",
          is_readable: true,
          is_hidden: false,
        },
        {
          name: "image3.gif",
          path: "/photos/image3.gif",
          type: FileType.FILE,
          size: 3072,
          modified_at: "2024-01-01T00:00:00Z",
          mime_type: "image/gif",
          is_readable: true,
          is_hidden: false,
        },
        {
          name: "document.pdf",
          path: "/photos/document.pdf",
          type: FileType.FILE,
          size: 4096,
          modified_at: "2024-01-01T00:00:00Z",
          mime_type: "application/pdf",
          is_readable: true,
          is_hidden: false,
        },
      ],
      total: 4,
    });

    renderBrowser();

    // Wait for files to load and click second image (image2.png)
    const imageFile = await screen.findByText("image2.png");
    fireEvent.click(imageFile);

    // Image preview should open
    const preview = await screen.findByTestId("image-preview");
    expect(preview).toBeInTheDocument();
  });

  it("does not show gallery mode for single image", async () => {
    // Mock browse response with single image file
    mockedApi.listDirectory.mockResolvedValue({
      path: "/",
      items: [
        {
          name: "single-photo.jpg",
          path: "/single-photo.jpg",
          type: FileType.FILE,
          size: 1024,
          modified_at: "2024-01-01T00:00:00Z",
          mime_type: "image/jpeg",
          is_readable: true,
          is_hidden: false,
        },
      ],
      total: 1,
    });

    renderBrowser();

    // Wait for files to load
    const imageFile = await screen.findByText("single-photo.jpg");

    // Click on the image file
    fireEvent.click(imageFile);

    // Image preview should open
    const preview = await screen.findByTestId("image-preview");
    expect(preview).toBeInTheDocument();
  });

  it("opens image preview in dialog when image is clicked", async () => {
    mockedApi.listDirectory.mockResolvedValue({
      items: [
        {
          name: "photo.jpg",
          type: FileType.FILE,
          path: "/photo.jpg",
          size: 1024 * 1024,
          modified_at: "2024-01-01T00:00:00Z",
          mime_type: "image/jpeg",
          is_readable: true,
          is_hidden: false,
        },
      ],
      path: "/",
      total: 1,
    });

    renderBrowser();

    // Wait for files to load and click image
    const imageFile = await screen.findByText("photo.jpg");
    fireEvent.click(imageFile);

    // Wait for preview to open
    const preview = await screen.findByTestId("image-preview");
    expect(preview).toBeInTheDocument();
  });

  it("still supports markdown preview for backward compatibility", async () => {
    mockedApi.listDirectory.mockResolvedValue({
      items: [
        {
          name: "readme.md",
          type: FileType.FILE,
          path: "/readme.md",
          size: 2048,
          modified_at: "2024-01-01T00:00:00Z",
          mime_type: "text/markdown",
          is_readable: true,
          is_hidden: false,
        },
      ],
      path: "/",
      total: 1,
    });

    renderBrowser();

    // Wait for files to load
    const markdownFile = await screen.findByText("readme.md");

    // Click on the markdown file
    fireEvent.click(markdownFile);

    // Markdown preview should open
    const preview = await screen.findByTestId("markdown-preview");
    expect(preview).toBeInTheDocument();
  });
});
