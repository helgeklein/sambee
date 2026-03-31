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
  smb: {
    read_chunk_size_bytes: {
      key: "smb.read_chunk_size_bytes",
      label: "SMB read chunk size",
      description: "Chunk size used when streaming files from SMB shares.",
      value: 4194304,
      source: "default",
      default_value: 4194304,
      min_value: 65536,
      max_value: 16777216,
      step: 65536,
    },
  },
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

const mockAdvancedSettingsWithOverride: AdvancedSystemSettings = {
  ...mockAdvancedSettings,
  smb: {
    read_chunk_size_bytes: {
      ...mockAdvancedSettings.smb.read_chunk_size_bytes,
      value: 2097152,
      source: "database",
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

    expect(await screen.findByRole("heading", { name: /smb backends/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /preprocessors/i })).toBeInTheDocument();
    expect(screen.getByDisplayValue("4")).toBeInTheDocument();
    expect(screen.getAllByDisplayValue("MiB").length).toBeGreaterThan(0);
    expect(screen.getByText(/default: 4 mib \(4,194,304 bytes\)/i)).toBeInTheDocument();
    expect(screen.queryByText(/exact value:/i)).not.toBeInTheDocument();
  });

  it("saves updated values", async () => {
    const user = userEvent.setup();

    render(
      <SambeeThemeProvider>
        <AdvancedSettings />
      </SambeeThemeProvider>
    );

    await waitFor(() => {
      expect(api.getAdvancedSettings).toHaveBeenCalled();
    });

    const valueInputs = screen.getAllByLabelText("Value");
    const smbReadChunkInput = valueInputs[0]!;
    await user.clear(smbReadChunkInput);
    await user.type(smbReadChunkInput, "2");

    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(api.updateAdvancedSettings).toHaveBeenCalledWith({
        smb: { read_chunk_size_bytes: 2097152 },
        preprocessors: {
          imagemagick: {
            max_file_size_bytes: 104857600,
            timeout_seconds: 30,
          },
        },
      });
    });
  });

  it("resets a database override to inherited value", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getAdvancedSettings).mockResolvedValueOnce(mockAdvancedSettingsWithOverride);
    vi.mocked(api.updateAdvancedSettings).mockResolvedValueOnce(mockAdvancedSettings);

    render(
      <SambeeThemeProvider>
        <AdvancedSettings />
      </SambeeThemeProvider>
    );

    await waitFor(() => {
      expect(api.getAdvancedSettings).toHaveBeenCalled();
    });

    await user.click(screen.getByRole("button", { name: /reset override/i }));

    await waitFor(() => {
      expect(api.updateAdvancedSettings).toHaveBeenCalledWith({
        reset_keys: ["smb.read_chunk_size_bytes"],
      });
    });

    expect(screen.getByText(/reset to inherited value/i)).toBeInTheDocument();
  });

  it("shows a field error and blocks save for out-of-range values", async () => {
    const user = userEvent.setup();

    render(
      <SambeeThemeProvider>
        <AdvancedSettings />
      </SambeeThemeProvider>
    );

    await waitFor(() => {
      expect(api.getAdvancedSettings).toHaveBeenCalled();
    });

    const valueInputs = screen.getAllByLabelText("Value");
    const smbReadChunkInput = valueInputs[0]!;
    await user.clear(smbReadChunkInput);
    await user.type(smbReadChunkInput, "17");

    await user.click(screen.getByRole("button", { name: /save changes/i }));

    expect(api.updateAdvancedSettings).not.toHaveBeenCalled();
    expect(screen.getByText(/smb read chunk size must be between 64 kib and 16 mib/i)).toBeInTheDocument();
  });
});
