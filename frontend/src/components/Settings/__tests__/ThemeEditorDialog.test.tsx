import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import api from "../../../services/api";
import { render } from "../../../test/utils/test-utils";
import { editableDefinition } from "../../../theme/themeDefinition";
import { builtInThemes } from "../../../theme/themes";
import { ThemeEditorDialog } from "../ThemeEditorDialog";

const theme = builtInThemes[0]!;

function renderEditor(onPreview = vi.fn()) {
  const onClose = vi.fn();
  const onSaved = vi.fn().mockResolvedValue(undefined);
  render(
    <ThemeEditorDialog
      theme={theme}
      stored={undefined}
      storedThemes={[]}
      selectedThemeId={theme.id}
      isAdmin={false}
      onClose={onClose}
      onSaved={onSaved}
      onPreview={onPreview}
    />
  );
  return { onClose, onSaved, onPreview };
}

describe("ThemeEditorDialog", () => {
  afterEach(() => vi.restoreAllMocks());

  it("starts on the dialog and tabs to the name field", async () => {
    const user = userEvent.setup();
    renderEditor();

    expect(screen.getByRole("dialog", { name: `Edit ${theme.name}` })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveFocus();
  });

  it("keeps an invalid hex draft out of the preview and restores the persisted theme on cancel", async () => {
    const user = userEvent.setup();
    const { onClose, onPreview } = renderEditor();
    expect(screen.getByRole("button", { name: "Save", exact: true })).toBeDisabled();

    await user.clear(screen.getByDisplayValue(theme.primary.main));
    await user.type(screen.getByRole("textbox", { name: /Main/ }), "#bad");
    expect(screen.getByRole("textbox", { name: /Main/ })).toHaveAttribute("aria-invalid", "true");
    expect(screen.getAllByText("Use #RRGGBB or #RRGGBBAA.")).toHaveLength(2);
    expect(onPreview).not.toHaveBeenCalledWith(expect.objectContaining({ primary: { main: "#bad" } }));
    await user.click(screen.getByRole("button", { name: "Save copy" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: /Main/ })).toHaveFocus());
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onPreview).toHaveBeenLastCalledWith(null);
    expect(onClose).toHaveBeenCalled();
  });

  it("offers an alpha picker and saves a copied built-in with a server-generated ID", async () => {
    const user = userEvent.setup();
    const created = vi.spyOn(api, "createTheme").mockResolvedValue({ id: "server-id", version: 1, scope: "user", definition: theme });
    const { onSaved } = renderEditor();
    await user.click(screen.getByRole("button", { name: "Choose Main color" }));
    expect(document.querySelector(".react-colorful__alpha")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.clear(screen.getByDisplayValue(theme.name));
    await user.type(screen.getByRole("textbox", { name: /Name/ }), "Custom light");
    await user.clear(screen.getByRole("textbox", { name: /Main/ }));
    await user.type(screen.getByRole("textbox", { name: /Main/ }), "#11223388");
    await user.click(screen.getByRole("button", { name: "Save copy" }));
    await waitFor(() =>
      expect(created).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Custom light", primary: expect.objectContaining({ main: "#11223388" }) }),
        "user"
      )
    );
    expect(onSaved).toHaveBeenCalledWith("server-id", true);
  });

  it("shows and saves opaque eight-digit input as six-digit hex", async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(api, "createTheme").mockResolvedValue({ id: "server-id", version: 1, scope: "user", definition: theme });
    const { onPreview } = renderEditor();
    const main = screen.getByRole("textbox", { name: /Main/ });
    await user.clear(main);
    await user.type(main, "#112233ff");
    await user.tab();

    expect(main).toHaveValue("#112233");
    expect(onPreview).toHaveBeenLastCalledWith(expect.objectContaining({ primary: expect.objectContaining({ main: "#112233" }) }));
    await user.click(screen.getByRole("button", { name: "Save copy" }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ primary: expect.objectContaining({ main: "#112233" }) }), "user")
    );
  });

  it("updates a writable theme using the versioned target", async () => {
    const user = userEvent.setup();
    const writableTheme = { ...theme, id: "custom-id", name: "Writable" };
    const stored = { id: "custom-id", scope: "user" as const, version: 3, definition: editableDefinition(writableTheme) };
    const updated = { ...stored, version: 4 };
    const update = vi.spyOn(api, "updateTheme").mockResolvedValue(updated);
    const onSaved = vi.fn().mockResolvedValue(undefined);
    render(
      <ThemeEditorDialog
        theme={writableTheme}
        stored={stored}
        storedThemes={[stored]}
        selectedThemeId={stored.id}
        isAdmin={false}
        onClose={vi.fn()}
        onSaved={onSaved}
        onPreview={vi.fn()}
      />
    );

    await user.clear(screen.getByDisplayValue("Writable"));
    await user.type(screen.getByRole("textbox", { name: /Name/ }), "Updated");
    await user.click(screen.getByRole("button", { name: "Save", exact: true }));

    await waitFor(() => expect(update).toHaveBeenCalledWith(stored, expect.objectContaining({ name: "Updated" })));
    expect(onSaved).toHaveBeenCalledWith(stored.id, false);
  });

  it("exports a versioned draft without an editable identity", async () => {
    const user = userEvent.setup();
    let downloaded: Blob | undefined;
    const originalCreate = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
    const originalRevoke = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: (blob: Blob) => {
        downloaded = blob;
        return "blob:theme-export";
      },
    });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    try {
      renderEditor();
      await user.click(screen.getByRole("button", { name: "Export" }));
      const json = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(downloaded!);
      });
      const exported = JSON.parse(json);
      expect(exported).toMatchObject({ version: 1, definition: { name: theme.name } });
      expect(exported.definition).not.toHaveProperty("id");
    } finally {
      if (originalCreate) Object.defineProperty(URL, "createObjectURL", originalCreate);
      else Reflect.deleteProperty(URL, "createObjectURL");
      if (originalRevoke) Object.defineProperty(URL, "revokeObjectURL", originalRevoke);
      else Reflect.deleteProperty(URL, "revokeObjectURL");
    }
  });

  it("imports a valid draft without saving and leaves it intact after an invalid import", async () => {
    const user = userEvent.setup();
    const { onPreview } = renderEditor();
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const validFile = new File([], "theme.json", { type: "application/json" });
    validFile.text = async () => JSON.stringify({ version: 1, definition: { ...editableDefinition(theme), name: "Imported light" } });

    await user.upload(fileInput, validFile);
    expect(await screen.findByDisplayValue("Imported light")).toBeInTheDocument();
    expect(onPreview).toHaveBeenLastCalledWith(expect.objectContaining({ id: theme.id, name: "Imported light" }));

    const invalidFile = new File([], "broken.json", { type: "application/json" });
    invalidFile.text = async () => "{broken";
    await user.upload(fileInput, invalidFile);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Imported light")).toBeInTheDocument();
  });

  it("saves a personal copy under a distinct name without updating the original", async () => {
    const user = userEvent.setup();
    const personalTheme = { ...theme, id: "personal-id", name: "Personal" };
    const original = { id: personalTheme.id, scope: "user" as const, version: 2, definition: editableDefinition(personalTheme) };
    const existingCopy = { ...original, id: "previous-copy", definition: { ...original.definition, name: "Personal (copy)" } };
    const create = vi.spyOn(api, "createTheme").mockResolvedValue({ ...original, id: "new-copy", version: 1 });
    const update = vi.spyOn(api, "updateTheme");
    const onSaved = vi.fn().mockResolvedValue(undefined);
    render(
      <ThemeEditorDialog
        theme={personalTheme}
        stored={original}
        storedThemes={[original, existingCopy]}
        selectedThemeId={personalTheme.id}
        isAdmin={false}
        onClose={vi.fn()}
        onSaved={onSaved}
        onPreview={vi.fn()}
      />
    );

    expect(screen.queryByRole("combobox", { name: "Save as target" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save copy" }));
    expect(update).not.toHaveBeenCalled();
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ name: "Personal (copy 2)" }), "user"));
    expect(onSaved).toHaveBeenCalledWith("new-copy", true);
  });

  it("only copies into a new storage group when storage changes", async () => {
    const user = userEvent.setup();
    const siteTheme = { ...theme, id: "site-id", name: "Site theme" };
    const stored = { id: siteTheme.id, scope: "site" as const, version: 2, definition: editableDefinition(siteTheme) };
    const create = vi.spyOn(api, "createTheme").mockResolvedValue({ ...stored, id: "personal-copy", scope: "user" });
    const update = vi.spyOn(api, "updateTheme");
    render(
      <ThemeEditorDialog
        theme={siteTheme}
        stored={stored}
        storedThemes={[stored]}
        selectedThemeId={siteTheme.id}
        isAdmin
        onClose={vi.fn()}
        onSaved={vi.fn().mockResolvedValue(undefined)}
        onPreview={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
    await user.click(screen.getByRole("combobox", { name: "Storage" }));
    await user.click(screen.getByRole("option", { name: "Your themes" }));
    expect(screen.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Save copy" }));

    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ name: "Site theme" }), "user"));
    expect(update).not.toHaveBeenCalled();
  });

  it("retains an automatically renamed draft after a copy request fails", async () => {
    const user = userEvent.setup();
    const existing = { id: "existing-id", scope: "user" as const, version: 2, definition: editableDefinition(theme) };
    vi.spyOn(api, "createTheme").mockRejectedValueOnce(new Error("Theme changed in another tab. Refresh and try again"));
    render(
      <ThemeEditorDialog
        theme={theme}
        stored={undefined}
        storedThemes={[existing]}
        selectedThemeId={theme.id}
        isAdmin={false}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onPreview={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "Save copy" }));
    expect(await screen.findByText("Theme changed in another tab. Refresh and try again")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue(`${theme.name} (copy)`);
  });
});
