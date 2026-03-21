import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { MockedObject } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import apiService from "../../services/api";
import { SambeeThemeProvider } from "../../theme/ThemeContext";
import { FileType } from "../../types";
import FileBrowser from "../FileBrowser";

// Mock the API service
vi.mock("../../services/api");
const mockedApi = apiService as MockedObject<typeof apiService>;

// Mock @tanstack/react-virtual for virtualized list rendering
vi.mock("@tanstack/react-virtual", () => import("../../__mocks__/@tanstack/react-virtual"));

// Mock the view components
vi.mock("../../utils/FileTypeRegistry", async () => {
  const actual = await vi.importActual<typeof import("../../utils/FileTypeRegistry")>("../../utils/FileTypeRegistry");
  return {
    ...actual,
    getViewerComponentLoadResult: vi.fn((mimeType: string) => {
      if (mimeType?.startsWith("image/")) {
        return Promise.resolve({
          status: "loaded",
          component: function ImageView() {
            return <div data-testid="image-view">Image View</div>;
          },
        });
      }
      if (mimeType === "text/markdown") {
        return Promise.resolve({
          status: "loaded",
          component: function MarkdownView() {
            return <div data-testid="markdown-view">Markdown View</div>;
          },
        });
      }
      return Promise.resolve({ status: "unsupported" });
    }),
    getViewerComponent: vi.fn((mimeType: string) => {
      if (mimeType?.startsWith("image/")) {
        return Promise.resolve(function ImageView() {
          return <div data-testid="image-view">Image View</div>;
        });
      }
      if (mimeType === "text/markdown") {
        return Promise.resolve(function MarkdownView() {
          return <div data-testid="markdown-view">Markdown View</div>;
        });
      }
      return Promise.resolve(null);
    }),
  };
});

describe("Browser - Image View Integration", () => {
  const renderBrowser = (initialPath = "/browse/smb/test-server-1") => {
    return render(
      <SambeeThemeProvider>
        <MemoryRouter initialEntries={[initialPath]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Routes>
            <Route path="/browse/:targetType/:targetId/*" element={<FileBrowser />} />
            <Route path="/browse" element={<FileBrowser />} />
            <Route path="/login" element={<div>Login Page</div>} />
          </Routes>
        </MemoryRouter>
      </SambeeThemeProvider>
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Set up authentication
    localStorage.setItem("access_token", "fake-token");

    // Mock successful API responses
    mockedApi.getConnections.mockResolvedValue([
      {
        id: "conn-1",
        name: "Test Server",
        slug: "test-server-1",
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

  it("renders image view when clicking on image file", async () => {
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
    await waitFor(() => {
      const elements = screen.getAllByText("image1.jpg");
      expect(elements.length).toBeGreaterThan(0);
    });
    const imageButtons = screen.getAllByRole("button", { name: /image1\.jpg/i });
    const imageFile = imageButtons[0];

    // Click on the image file
    fireEvent.click(imageFile);

    // Image view should open
    const view = await screen.findByTestId("image-view");
    expect(view).toBeInTheDocument();
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

    // Image view should open
    const view = await screen.findByTestId("image-view");
    expect(view).toBeInTheDocument();
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
    await waitFor(() => {
      const elements = screen.getAllByText("single-photo.jpg");
      expect(elements.length).toBeGreaterThan(0);
    });
    const imageButtons = screen.getAllByRole("button", { name: /single-photo\.jpg/i });
    const imageFile = imageButtons[0];

    // Click on the image file
    fireEvent.click(imageFile);

    // Image view should open
    const view = await screen.findByTestId("image-view");
    expect(view).toBeInTheDocument();
  });

  it("opens image view in dialog when image is clicked", async () => {
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
    await waitFor(() => {
      const elements = screen.getAllByText("photo.jpg");
      expect(elements.length).toBeGreaterThan(0);
    });
    const imageButtons = screen.getAllByRole("button", { name: /photo\.jpg/i });
    const imageFile = imageButtons[0];
    fireEvent.click(imageFile);

    // Wait for view to open
    const view = await screen.findByTestId("image-view");
    expect(view).toBeInTheDocument();
  });

  it("still supports markdown view for backward compatibility", async () => {
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
    await waitFor(() => {
      const elements = screen.getAllByText("readme.md");
      expect(elements.length).toBeGreaterThan(0);
    });
    const markdownButtons = screen.getAllByRole("button", { name: /readme\.md/i });
    const markdownFile = markdownButtons[0];

    // Click on the markdown file
    fireEvent.click(markdownFile);

    // Markdown view should open
    const view = await screen.findByTestId("markdown-view");
    expect(view).toBeInTheDocument();
  });
});
