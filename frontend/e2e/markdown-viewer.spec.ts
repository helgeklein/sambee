import { expect, test, type Page, type Route } from "@playwright/test";

const demoConnectionId = "85610f49-ab40-4d96-8750-ddab3e8e8764";
const demoPath = "note.md";
const initialMarkdown = Array.from({ length: 140 }, (_, index) => `line ${index + 1}`).join("\n");

async function fulfillJson(route: Route, json: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(json),
  });
}

async function mockMarkdownViewerApi(page: Page) {
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

    if (pathname.endsWith("/connections")) {
      await fulfillJson(route, [
        {
          id: demoConnectionId,
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

    if (pathname === `/api/browse/${demoConnectionId}/list`) {
      await fulfillJson(route, {
        path: "/",
        items: [
          {
            name: demoPath,
            path: demoPath,
            type: "file",
            size: initialMarkdown.length,
            mime_type: "text/markdown",
            modified_at: "2026-04-12T12:00:00Z",
          },
        ],
      });
      return;
    }

    if (pathname === `/api/viewer/${demoConnectionId}/file`) {
      await route.fulfill({
        status: 200,
        contentType: "text/markdown; charset=utf-8",
        body: initialMarkdown,
      });
      return;
    }

    if (pathname === `/api/companion/${demoConnectionId}/lock` && request.method() === "POST") {
      await fulfillJson(route, {
        lock_id: "lock-1",
        file_path: demoPath,
        locked_by: "demo-admin",
        locked_at: "2026-04-12T12:00:00Z",
      });
      return;
    }

    if (pathname === `/api/companion/${demoConnectionId}/lock/heartbeat` && request.method() === "POST") {
      await route.fulfill({ status: 204, body: "" });
      return;
    }

    if (pathname === `/api/companion/${demoConnectionId}/lock` && request.method() === "DELETE") {
      await route.fulfill({ status: 204, body: "" });
      return;
    }

    await fulfillJson(route, { detail: `Unhandled mocked route: ${request.method()} ${pathname}` }, 404);
  });
}

test("keeps the markdown editor viewport stable after cancelling the unsaved changes dialog", async ({ page }) => {
  await mockMarkdownViewerApi(page);

  await page.goto("/browse/smb/demo");
  await page.getByRole("button", { name: `File: ${demoPath}` }).click();
  await page.getByRole("button", { name: "Edit" }).click();

  const editor = page.getByRole("textbox", { name: "Markdown editor" });
  await expect(editor).toBeVisible();

  await page.evaluate(() => {
    const editable = document.querySelector('[contenteditable="true"][aria-label="Markdown editor"]');

    if (!(editable instanceof HTMLElement)) {
      throw new Error("Expected markdown editor to be present");
    }

    const selection = window.getSelection();
    selection?.removeAllRanges();

    const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT);
    let currentNode: Node | null = null;
    let lastTextNode: Node | null = null;

    while ((currentNode = walker.nextNode())) {
      lastTextNode = currentNode;
    }

    if (!lastTextNode) {
      throw new Error("Expected markdown editor to contain text");
    }

    const range = document.createRange();
    range.setStart(lastTextNode, lastTextNode.textContent?.length ?? 0);
    range.collapse(true);
    selection?.addRange(range);
    editable.focus();

    let element = editable.parentElement;
    while (element) {
      if (element.scrollHeight > element.clientHeight + 20) {
        element.scrollTop = 700;
      }
      element = element.parentElement;
    }
  });

  await page.keyboard.type("x");

  await page.evaluate(() => {
    const editable = document.querySelector('[contenteditable="true"][aria-label="Markdown editor"]');

    if (!(editable instanceof HTMLElement)) {
      throw new Error("Expected markdown editor to be present");
    }

    let element = editable.parentElement;
    while (element) {
      if (element.scrollHeight > element.clientHeight + 20) {
        element.scrollTop = 700;
      }
      element = element.parentElement;
    }
  });

  const editorWrapper = page.locator(".mdxeditor");
  const wrapperScrollTopBefore = await editorWrapper.evaluate((element) => (element as HTMLElement).scrollTop);

  await page.keyboard.press("Escape");

  const unsavedDialog = page.getByRole("dialog", { name: "Unsaved changes" });
  await expect(unsavedDialog).toBeVisible();
  await unsavedDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(unsavedDialog).toBeHidden();

  await expect(editor).toBeFocused();
  await expect.poll(async () => editorWrapper.evaluate((element) => (element as HTMLElement).scrollTop)).toBe(wrapperScrollTopBefore);
});
