import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearCachedAsyncData } from "../../hooks/useCachedAsyncData";
import { SambeeThemeProvider } from "../../theme";
import type { AdvancedSystemSettings } from "../../types";
import { AdvancedSettings } from "../AdvancedSettings";

vi.mock("../../services/api", () => ({
  default: {
    getAdvancedSettings: vi.fn(),
    updateAdvancedSettings: vi.fn(),
  },
}));

import api from "../../services/api";

const mockAdvancedSettings: AdvancedSystemSettings = {
  preprocessors: {
    imagemagick: {
      max_file_size_bytes: {
        key: "preprocessors.imagemagick.max_file_size_bytes",
        label: "Maximum file size",
        description: "Largest input file ImageMagick is allowed to preprocess.",
        value: 104857600,
        source: "default",
        default_value: 104857600,
        min_value: 1048576,
        max_value: 1073741824,
        step: 1048576,
      },
      timeout_seconds: {
        key: "preprocessors.imagemagick.timeout_seconds",
        label: "Conversion timeout",
        description: "Maximum time allowed for an ImageMagick preprocessing run.",
        value: 30,
        source: "default",
        default_value: 30,
        min_value: 5,
        max_value: 600,
        step: 1,
      },
    },
  },
};

describe("AdvancedSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCachedAsyncData();
    vi.mocked(api.getAdvancedSettings).mockResolvedValue(mockAdvancedSettings);
    vi.mocked(api.updateAdvancedSettings).mockResolvedValue(mockAdvancedSettings);
  });

  it("loads and displays advanced settings", async () => {
    render(
      <SambeeThemeProvider>
        <AdvancedSettings />
      </SambeeThemeProvider>
    );

    await waitFor(() => {
      expect(api.getAdvancedSettings).toHaveBeenCalled();
    });

    expect(screen.queryByText("Configure limits for server-side preprocessing services.")).not.toBeInTheDocument();
    expect(screen.queryByText("Set the file-size and runtime limits used when ImageMagick conversions run.")).not.toBeInTheDocument();
    expect(await screen.findByLabelText("Maximum file size")).toBeInTheDocument();
    expect(screen.getByLabelText("Conversion timeout")).toBeInTheDocument();
    expect(screen.queryByLabelText("Value")).not.toBeInTheDocument();
    expect(screen.queryByText(/exact value:/i)).not.toBeInTheDocument();
  });

  it("saves updated values", async () => {
    const user = userEvent.setup();

    render(
      <SambeeThemeProvider>
        <AdvancedSettings />
      </SambeeThemeProvider>
    );

    const timeoutInput = await screen.findByLabelText("Conversion timeout");
    await user.clear(timeoutInput);
    await user.type(timeoutInput, "45");

    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(api.updateAdvancedSettings).toHaveBeenCalledWith({
        preprocessors: {
          imagemagick: {
            max_file_size_bytes: 104857600,
            timeout_seconds: 45,
          },
        },
      });
    });
  });
});
