import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadNetworkSettingsData, SETTINGS_DATA_CACHE_KEYS } from "../../components/Settings/settingsDataSources";
import { clearCachedAsyncData, getCachedAsyncData, primeCachedAsyncData } from "../../hooks/useCachedAsyncData";
import api from "../../services/api";
import { SambeeThemeProvider } from "../../theme";
import { NetworkSettings } from "../NetworkSettings";

vi.mock("../../services/api", () => ({
  default: {
    getNetworkSettings: vi.fn(),
    updateNetworkSettings: vi.fn(),
  },
}));

describe("NetworkSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCachedAsyncData();
    vi.mocked(api.getNetworkSettings).mockResolvedValue({
      public_url: "https://files.example.test",
      trusted_proxy_cidrs: ["10.0.0.0/24"],
    });
  });

  it("loads the configured external URL and trusted proxies", async () => {
    render(
      <SambeeThemeProvider>
        <NetworkSettings />
      </SambeeThemeProvider>
    );

    expect(await screen.findByDisplayValue("https://files.example.test")).toBeInTheDocument();
    expect(screen.getByDisplayValue("10.0.0.0/24")).toBeInTheDocument();
    const proxyCidrs = screen.getByLabelText("Trusted proxy CIDRs");
    expect(proxyCidrs).toBe(screen.getByRole("textbox", { name: "Trusted proxy CIDRs" }));
    expect(proxyCidrs.tagName).toBe("TEXTAREA");
    expect(proxyCidrs.closest(".MuiFormControl-root")?.querySelector("label")).toHaveAttribute("data-shrink", "true");
    expect(screen.queryByRole("heading", { name: "External origin" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Trusted reverse proxies" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "OIDC callback URI" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save network settings" })).not.toBeInTheDocument();
  });

  it("uses prefetched Network settings without a second request", async () => {
    await primeCachedAsyncData(SETTINGS_DATA_CACHE_KEYS.adminNetwork, loadNetworkSettingsData);
    vi.mocked(api.getNetworkSettings).mockClear();

    render(
      <SambeeThemeProvider>
        <NetworkSettings />
      </SambeeThemeProvider>
    );

    expect(await screen.findByDisplayValue("https://files.example.test")).toBeInTheDocument();
    expect(api.getNetworkSettings).not.toHaveBeenCalled();
  });

  it("immediately saves normalized Network settings fields", async () => {
    const user = userEvent.setup();
    await primeCachedAsyncData(SETTINGS_DATA_CACHE_KEYS.adminAuthentication, async () => ({ public_url_configured: false }));
    vi.mocked(api.updateNetworkSettings).mockImplementation(async (update) => update);
    render(
      <SambeeThemeProvider>
        <NetworkSettings />
      </SambeeThemeProvider>
    );

    const publicUrl = await screen.findByRole("textbox", { name: /public url/i });
    await user.clear(publicUrl);
    await user.type(publicUrl, "https://new.example.test");
    await user.tab();
    const proxyCidrs = screen.getByRole("textbox", { name: /trusted proxy cidrs/i });
    await user.clear(proxyCidrs);
    await user.type(proxyCidrs, "10.0.0.4/24{enter}2001:db8::1/64");
    await user.tab();

    await waitFor(() => {
      expect(api.updateNetworkSettings).toHaveBeenCalledWith(
        {
          field: "public_url",
          value: "https://new.example.test",
        },
        expect.objectContaining({ signal: expect.anything() })
      );
      expect(api.updateNetworkSettings).toHaveBeenCalledWith(
        {
          field: "trusted_proxy_cidrs",
          value: ["10.0.0.4/24", "2001:db8::1/64"],
        },
        expect.objectContaining({ signal: expect.anything() })
      );
    });
    expect(getCachedAsyncData(SETTINGS_DATA_CACHE_KEYS.adminAuthentication)).toBeNull();
  });

  it("does not save unchanged fields when they lose focus", async () => {
    const user = userEvent.setup();
    render(
      <SambeeThemeProvider>
        <NetworkSettings />
      </SambeeThemeProvider>
    );

    const publicUrl = await screen.findByRole("textbox", { name: /public url/i });
    await user.click(publicUrl);
    await user.tab();

    expect(api.updateNetworkSettings).not.toHaveBeenCalled();
    expect(publicUrl).toBeEnabled();
  });
});
