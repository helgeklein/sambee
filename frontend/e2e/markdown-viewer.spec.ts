import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

const DEMO_CONNECTION_ID = "85610f49-ab40-4d96-8750-ddab3e8e8764";
const DEMO_PATH = "note.md";

const LINE_BREAK_MARKDOWN = "alpha\n\n| Col 1 | Col 2 |\n| --- | --- |\n| A1 | B1 |\n| A2 | B2 |\n\nomega\n";
const SEARCH_MARKDOWN = "alpha\n\n| Col 1 | Col 2 |\n| --- | --- |\n| alpha | B1 |\n| A2 | alpha |\n\nomega alpha\n";

interface MockMarkdownViewerApiOptions {
  initialMarkdown: string;
  onUploadBody?: (body: string, setCurrentMarkdown: (markdown: string) => void) => void;
}

async function fulfillJson(route: Route, json: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(json),
  });
}

async function mockMarkdownViewerApi(page: Page, { initialMarkdown, onUploadBody }: MockMarkdownViewerApiOptions): Promise<void> {
  let currentMarkdown = initialMarkdown;

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;

    if (pathname.endsWith("/auth/config")) {
      await fulfillJson(route, { auth_method: "none" });
      return;
    }

    if (pathname.endsWith("/logs/config")) {
      await fulfillJson(route, {
        logging_enabled: false,
        logging_level: "WARNING",
        tracing_enabled: false,
        tracing_level: "ERROR",
        tracing_components: [],
      });
      return;
    }

    if (pathname.endsWith("/auth/me")) {
      await fulfillJson(route, {
        id: "user-1",
        username: "demo-admin",
        role: "admin",
        is_active: true,
      });
      return;
    }

    if (pathname.endsWith("/auth/me/settings") && request.method() === "GET") {
      await fulfillJson(route, {
        appearance: { theme_id: "sambee-light", custom_themes: [] },
        localization: { language: "browser", regional_locale: "browser" },
        browser: {
          quick_nav_include_dot_directories: false,
          file_browser_view_mode: "list",
          pane_mode: "single",
          selected_connection_id: null,
          viewer_associations: {},
        },
      });
      return;
    }

    if (pathname.endsWith("/auth/me/settings") && request.method() === "PUT") {
      await fulfillJson(route, {
        appearance: { theme_id: "sambee-light", custom_themes: [] },
        localization: { language: "browser", regional_locale: "browser" },
        browser: {
          quick_nav_include_dot_directories: false,
          file_browser_view_mode: "list",
          pane_mode: "single",
          selected_connection_id: null,
          viewer_associations: {},
        },
      });
      return;
    }

    if (pathname.endsWith("/version")) {
      await fulfillJson(route, {
        version: "0.8.0-test",
        build_time: "2026-04-12T12:00:00Z",
        git_commit: "deadbeef",
      });
      return;
    }

    if (pathname.endsWith("/connections")) {
      await fulfillJson(route, [
        {
          id: DEMO_CONNECTION_ID,
          name: "Demo",
          slug: "demo",
          type: "smb",
          host: "demo.local",
          port: 445,
          share_name: "data",
          username: "demo\\tester",
          path_prefix: "\\Demo",
          scope: "private",
          access_mode: "read_write",
          can_manage: true,
          created_at: "2026-02-13T20:22:41.779354",
          updated_at: "2026-04-12T10:15:47.930127",
        },
      ]);
      return;
    }

    if (pathname === `/api/browse/${DEMO_CONNECTION_ID}/list`) {
      await fulfillJson(route, {
        path: "/",
        items: [
          {
            name: DEMO_PATH,
            path: DEMO_PATH,
            type: "file",
            size: currentMarkdown.length,
            mime_type: "text/markdown",
            modified_at: "2026-04-12T12:00:00Z",
          },
        ],
      });
      return;
    }

    if (pathname === `/api/viewer/${DEMO_CONNECTION_ID}/file`) {
      await route.fulfill({
        status: 200,
        contentType: "text/markdown; charset=utf-8",
        body: currentMarkdown,
      });
      return;
    }

    if (pathname === `/api/browse/${DEMO_CONNECTION_ID}/lock` && request.method() === "POST") {
      await fulfillJson(route, {
        lock_id: "lock-1",
        file_path: DEMO_PATH,
        locked_by: "demo-admin",
        locked_at: "2026-04-12T12:00:00Z",
      });
      return;
    }

    if (pathname === `/api/browse/${DEMO_CONNECTION_ID}/lock/heartbeat` && request.method() === "POST") {
      await route.fulfill({ status: 204, body: "" });
      return;
    }

    if (pathname === `/api/browse/${DEMO_CONNECTION_ID}/lock` && request.method() === "DELETE") {
      await route.fulfill({ status: 204, body: "" });
      return;
    }

    if (pathname === `/api/browse/${DEMO_CONNECTION_ID}/upload` && request.method() === "POST") {
      const uploadBody = request.postDataBuffer()?.toString("utf8") ?? "";
      onUploadBody?.(uploadBody, (markdown) => {
        currentMarkdown = markdown;
      });

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ path: DEMO_PATH }),
      });
      return;
    }

    await fulfillJson(route, { detail: `Unhandled mocked route: ${request.method()} ${pathname}` }, 404);
  });
}

async function openMarkdownViewer(page: Page): Promise<void> {
  await page.goto("/browse/smb/demo");
  await page.getByRole("button", { name: `File: ${DEMO_PATH}` }).click();
}

async function enterMarkdownEditMode(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("textbox", { name: "Markdown editor" }).waitFor();
  await page.locator(".tbl-table-widget").first().waitFor();
}

async function activateCellEditor(cellLocator: Locator): Promise<Locator> {
  await cellLocator.click();

  const cellRoot = cellLocator.locator(
    "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' tbl-cell ')][1]"
  );
  const nestedEditor = cellRoot.locator(".tbl-cell-editor .cm-content[role='textbox']");

  try {
    await nestedEditor.waitFor({ state: "visible", timeout: 1000 });
  } catch {
    await cellLocator.click();
    await nestedEditor.waitFor({ state: "visible" });
  }

  await nestedEditor.click();

  return nestedEditor;
}

async function setCaretToCellEnd(cellEditorLocator: Locator): Promise<void> {
  await cellEditorLocator.evaluate((element) => {
    if (!(element instanceof HTMLElement)) {
      throw new Error("Expected table cell editable to be an HTMLElement");
    }

    const selection = window.getSelection();

    if (!selection) {
      throw new Error("Expected a DOM selection");
    }

    selection.removeAllRanges();

    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return (node.textContent?.length ?? 0) > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });

    let targetNode = walker.nextNode();
    let currentNode = targetNode;

    while (currentNode) {
      targetNode = currentNode;
      currentNode = walker.nextNode();
    }

    if (!(targetNode instanceof Text)) {
      throw new Error("Expected the table cell editable to contain text");
    }

    const range = document.createRange();
    range.setStart(targetNode, targetNode.textContent?.length ?? 0);
    range.collapse(true);
    selection.addRange(range);
    element.focus();
  });
}

test.describe("markdown viewer table editing", () => {
  test("saves Shift+Enter table-cell edits as canonical br tags and reopens cleanly", async ({ page }) => {
    const expectedSavedMarkdown = "alpha\n\n| Col 1 | Col 2 |\n| --- | --- |\n| A1<br />bar | B1 |\n| A2 | B2 |\n\nomega\n";
    const uploadBodies: string[] = [];

    await mockMarkdownViewerApi(page, {
      initialMarkdown: LINE_BREAK_MARKDOWN,
      onUploadBody: (body, setCurrentMarkdown) => {
        uploadBodies.push(body);
        setCurrentMarkdown(expectedSavedMarkdown);
      },
    });

    await openMarkdownViewer(page);
    await enterMarkdownEditMode(page);
    const targetCell = page.locator(".tbl-data-cell .tbl-cell-view").first();
    await targetCell.waitFor();
    const activeCellEditor = await activateCellEditor(targetCell);
    await setCaretToCellEnd(activeCellEditor);

    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("bar");
    await page.getByRole("button", { name: "Save" }).click();

    await expect.poll(() => uploadBodies.length).toBe(1);
    expect(uploadBodies[0]).toContain("A1<br />bar");
    expect(uploadBodies[0]).not.toContain("A1&#10;bar");

    await page.reload();
    await openMarkdownViewer(page);
    await expect(page.getByRole("cell", { name: /A1\s+bar/ })).toBeVisible();

    await page.getByRole("button", { name: "Edit" }).click();
    await expect(page.getByText("Unsaved changes")).toHaveCount(0);
  });

  test("keeps root-document search results and Mod-g navigation active while a table cell editor is focused", async ({ page }) => {
    await mockMarkdownViewerApi(page, { initialMarkdown: SEARCH_MARKDOWN });

    await openMarkdownViewer(page);
    await enterMarkdownEditMode(page);
    const targetCell = page.locator(".tbl-data-cell .tbl-cell-view").first();
    await targetCell.waitFor();
    await activateCellEditor(targetCell);

    await page.getByRole("button", { name: "Search" }).click();
    await page.getByPlaceholder("Search").fill("alpha");

    await expect(page.getByText("0 / 4")).toBeVisible();

    await page.getByRole("button", { name: "Next match" }).click();
    await expect(page.getByText(/current match\..*on line 6\./)).toBeVisible();
    await expect(page.getByText("3 / 4")).toBeVisible();

    await page.getByRole("button", { name: "Previous match" }).click();
    await expect(page.getByText(/current match\..*on line 5\./)).toBeVisible();
    await expect(page.getByText("2 / 4")).toBeVisible();
  });
});
