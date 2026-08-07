import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearCachedAsyncData } from "../../hooks/useCachedAsyncData";
import { SambeeThemeProvider } from "../../theme";
import type { SmbSettings as SmbSettingsData } from "../../types";
import { SmbSettings } from "../SmbSettings";

vi.mock("../../services/api", () => ({
  default: {
    getSmbSettings: vi.fn(),
    updateSmbSettings: vi.fn(),
  },
}));

import api from "../../services/api";

const smbSettings: SmbSettingsData = {
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
  policy: {
    authentication_mode: "negotiate",
    encryption_mode: "signing_only",
    connection_timeout_seconds: 30,
  },
  policy_source: "default",
  require_signing: true,
  require_encryption: false,
};

describe("SmbSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCachedAsyncData();
    vi.mocked(api.getSmbSettings).mockResolvedValue(smbSettings);
    vi.mocked(api.updateSmbSettings).mockResolvedValue(smbSettings);
  });

  it("loads SMB controls and saves only the supported policy fields", async () => {
    const user = userEvent.setup();
    render(
      <SambeeThemeProvider>
        <SmbSettings />
      </SambeeThemeProvider>
    );

    expect(await screen.findByRole("heading", { name: "Protection" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Connection behavior" })).toBeInTheDocument();
    expect(screen.getByLabelText("SMB read chunk size")).toHaveValue(4194304);
    expect(screen.getByRole("combobox", { name: "Transport protection" })).toHaveTextContent("Signing only (SMB 2 compatible)");

    await user.clear(screen.getByLabelText("Connection timeout"));
    await user.type(screen.getByLabelText("Connection timeout"), "45");
    await user.click(screen.getByRole("button", { name: "Save SMB settings" }));

    await waitFor(() => {
      expect(api.updateSmbSettings).toHaveBeenCalledWith({
        read_chunk_size_bytes: 4194304,
        policy: {
          authentication_mode: "negotiate",
          encryption_mode: "signing_only",
          connection_timeout_seconds: 45,
        },
      });
    });
  });

  it("shows a retry action when the initial settings load fails", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getSmbSettings).mockRejectedValueOnce(new Error("SMB settings unavailable")).mockResolvedValueOnce(smbSettings);

    render(
      <SambeeThemeProvider>
        <SmbSettings />
      </SambeeThemeProvider>
    );

    expect(await screen.findByText("Failed to load SMB settings")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("heading", { name: "Protection" })).toBeInTheDocument();
    expect(api.getSmbSettings).toHaveBeenCalledTimes(2);
  });

  it("saves encryption-required protection when selected", async () => {
    const user = userEvent.setup();
    render(
      <SambeeThemeProvider>
        <SmbSettings />
      </SambeeThemeProvider>
    );

    const protection = await screen.findByRole("combobox", { name: "Transport protection" });
    await user.click(protection);
    await user.click(screen.getByRole("option", { name: "Signing and encryption (SMB 3+)" }));
    await user.click(screen.getByRole("button", { name: "Save SMB settings" }));

    await waitFor(() => {
      expect(api.updateSmbSettings).toHaveBeenCalledWith({
        read_chunk_size_bytes: 4194304,
        policy: {
          authentication_mode: "negotiate",
          encryption_mode: "encryption_required",
          connection_timeout_seconds: 30,
        },
      });
    });
  });
});
