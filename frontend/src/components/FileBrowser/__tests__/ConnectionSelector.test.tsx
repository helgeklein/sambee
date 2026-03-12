import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CONNECTION_TYPE_LOCAL, LOCAL_DRIVE_PREFIX } from "../../../services/backendRouter";
import { SambeeThemeProvider } from "../../../theme/ThemeContext";
import { ConnectionSelector } from "../ConnectionSelector";

describe("ConnectionSelector", () => {
  const connections = [
    {
      id: "server-1",
      name: "Office Share",
      type: "smb",
      host: "fileserver",
      port: 445,
      share_name: "team",
      username: "alex",
      created_at: "2026-03-11T00:00:00Z",
      updated_at: "2026-03-11T00:00:00Z",
    },
    {
      id: `${LOCAL_DRIVE_PREFIX}c`,
      name: "Local Disk (C:)",
      type: CONNECTION_TYPE_LOCAL,
      host: "localhost",
      port: 21549,
      share_name: "c",
      username: "",
      created_at: "2026-03-11T00:00:00Z",
      updated_at: "2026-03-11T00:00:00Z",
    },
  ];

  it.each([
    ["Enter", "{Enter}"],
    ["Space", " "],
  ])("opens and keeps the top-bar connection menu open when %s is pressed", async (_label, sequence) => {
    const user = userEvent.setup();

    render(
      <SambeeThemeProvider>
        <ConnectionSelector connections={connections} selectedConnectionId="server-1" onConnectionChange={vi.fn()} />
      </SambeeThemeProvider>
    );

    const trigger = screen.getByRole("combobox", { name: "" });
    trigger.focus();

    await user.keyboard(sequence);

    await waitFor(() => {
      expect(screen.getByText("Local Disk (C:)")).toBeInTheDocument();
    });

    expect(screen.getByText("Office Share (fileserver/team)")).toBeInTheDocument();
  });
});
