import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

const demoConnectionId = "85610f49-ab40-4d96-8750-ddab3e8e8764";
const demoPath = "note.md";
const initialMarkdown = Array.from({ length: 140 }, (_, index) => `line ${index + 1}`).join("\n");
const codeBlockNavigationMarkdown = "`test22`\n\nsfd\n\n```txt\nsome text\nline 2\n```\n";
const logicalNavigationMarkdown =
  "`test22`\n\nsfd\n\n```txt\nsome text\nline 2\n```\n\n| Col 1 | Col2 |\n| --- | --- |\n| some data | more data |\n| Second row |  |\n\nomega\n";
const tableCellNavigationMarkdown = "alpha\n\n| Col 1 | Col 2 |\n| --- | --- |\n| A1 | B1 |\n| A2 | B2 |\n\nomega\n";
const loadedEmptyInternalLineMarkdown = "alpha\n\n| Col 1 | Col 2 |\n| --- | --- |\n| A1<br /><br />A3 | B1 |\n\nomega\n";
const markdownEditorFocusSettleDelayMs = 320;

type MockMarkdownViewerApiOptions = {
  onUploadBody?: (body: string) => void;
  persistUploadedMarkdown?: boolean;
};

async function fulfillJson(route: Route, json: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(json),
  });
}

async function mockMarkdownViewerApi(page: Page, markdown = initialMarkdown, options: MockMarkdownViewerApiOptions = {}) {
  let currentMarkdown = markdown;

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
        appearance: {
          theme_id: "sambee-light",
          custom_themes: [],
        },
        localization: {
          language: "browser",
          regional_locale: "browser",
        },
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
        appearance: {
          theme_id: "sambee-light",
          custom_themes: [],
        },
        localization: {
          language: "browser",
          regional_locale: "browser",
        },
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
            size: currentMarkdown.length,
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
        body: currentMarkdown,
      });
      return;
    }

    if (pathname === `/api/browse/${demoConnectionId}/lock` && request.method() === "POST") {
      await fulfillJson(route, {
        lock_id: "lock-1",
        file_path: demoPath,
        locked_by: "demo-admin",
        locked_at: "2026-04-12T12:00:00Z",
      });
      return;
    }

    if (pathname === `/api/browse/${demoConnectionId}/lock/heartbeat` && request.method() === "POST") {
      await route.fulfill({ status: 204, body: "" });
      return;
    }

    if (pathname === `/api/browse/${demoConnectionId}/lock` && request.method() === "DELETE") {
      await route.fulfill({ status: 204, body: "" });
      return;
    }

    if (pathname === `/api/browse/${demoConnectionId}/upload` && request.method() === "POST") {
      const uploadedBody = request.postDataBuffer()?.toString("utf8") ?? "";
      options.onUploadBody?.(uploadedBody);

      if (options.persistUploadedMarkdown) {
        currentMarkdown = uploadedBody;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ path: demoPath }),
      });
      return;
    }

    await fulfillJson(route, { detail: `Unhandled mocked route: ${request.method()} ${pathname}` }, 404);
  });
}

async function openMarkdownEditor(page: Page, markdown = initialMarkdown) {
  await mockMarkdownViewerApi(page, markdown);

  await page.goto("/browse/smb/demo");
  await page.getByRole("button", { name: `File: ${demoPath}` }).click();
  await page.getByRole("button", { name: "Edit" }).click();
  await waitForMarkdownEditorReady(page);
}

async function waitForMarkdownEditorReady(page: Page) {
  const editor = page.getByRole("textbox", { name: "Markdown editor" });
  const saveButton = page.getByRole("button", { name: "Save" });

  await expect(editor).toBeVisible();
  await expect(saveButton).toBeVisible();
}

async function waitForMarkdownEditorFocusToSettle(page: Page) {
  // The viewer schedules several focus-retry passes after entering edit mode.
  // Only boundary-sensitive caret setup needs to wait for that window.
  await page.waitForTimeout(markdownEditorFocusSettleDelayMs);
}

async function getCodeMirrorDocumentText(locator: Locator) {
  return locator.evaluate((element) => {
    if (!(element instanceof HTMLElement)) {
      throw new Error("Expected CodeMirror content element to be present");
    }

    const view = (element as HTMLElement & {
      cmTile?: {
        view?: {
          state: { doc: { toString: () => string } };
        };
      };
    }).cmTile?.view;

    if (!view) {
      throw new Error("Expected CodeMirror view to be present");
    }

    return view.state.doc.toString();
  });
}

async function moveCaretToTableCellBoundaryByKeyboard(
  page: Page,
  cellIndex: number,
  boundary: "end" | "start"
) {
  await waitForMarkdownEditorFocusToSettle(page);
  const targetCell = getTableCellTextbox(page, cellIndex);
  await targetCell.click();
  await waitForEditableFocusWithin(targetCell);

  await moveFocusedCaretToBoundary(page, targetCell, boundary);
}

async function moveFocusedCaretToBoundary(page: Page, locator: Locator, boundary: "end" | "start") {
  await locator.evaluate((element, expectedBoundary) => {
    const selection = window.getSelection();

    if (!selection) {
      throw new Error("Expected DOM selection to exist");
    }

    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return (node.textContent?.length ?? 0) > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });

    while (walker.nextNode()) {
      const currentNode = walker.currentNode;

      if (currentNode instanceof Text) {
        textNodes.push(currentNode);
      }
    }

    const range = document.createRange();

    if (textNodes.length === 0) {
      range.selectNodeContents(element);
      range.collapse(expectedBoundary === "start");
    } else if (expectedBoundary === "start") {
      range.setStart(textNodes[0], 0);
      range.collapse(true);
    } else {
      const lastTextNode = textNodes[textNodes.length - 1];
      range.setStart(lastTextNode, lastTextNode.textContent?.length ?? 0);
      range.collapse(true);
    }

    selection.removeAllRanges();
    selection.addRange(range);

    if (element instanceof HTMLElement) {
      element.focus();
    }
  }, boundary);

  await expect
    .poll(() =>
      locator.evaluate((element, expectedBoundary) => {
        const selection = window.getSelection();

        if (!selection?.anchorNode || !element.contains(selection.anchorNode)) {
          return false;
        }

        const prefixRange = document.createRange();
        prefixRange.selectNodeContents(element);
        prefixRange.setEnd(selection.anchorNode, selection.anchorOffset);

        const caretTextOffset = prefixRange.toString().length;
        const elementTextLength = element.textContent?.length ?? 0;

        return expectedBoundary === "start" ? caretTextOffset === 0 : caretTextOffset >= elementTextLength;
      }, boundary)
    )
    .toBe(true);
}

async function getCaretTextOffset(locator: Locator) {
  return locator.evaluate((element) => {
    const selection = window.getSelection();

    if (!selection?.anchorNode || !element.contains(selection.anchorNode)) {
      return null;
    }

    const prefixRange = document.createRange();
    prefixRange.selectNodeContents(element);
    prefixRange.setEnd(selection.anchorNode, selection.anchorOffset);
    return prefixRange.toString().length;
  });
}

async function moveCaretToTextNodeBoundary(locator: Locator, textContent: string, boundary: "start" | "end") {
  await locator.evaluate(
    (element, { expectedTextContent, expectedBoundary }) => {
      const selection = window.getSelection();

      if (!selection) {
        throw new Error("Expected DOM selection to exist");
      }

      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          return node.textContent && node.textContent.length > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        },
      });

      let targetNode: Text | null = null;

      while (walker.nextNode()) {
        const currentNode = walker.currentNode;

        if (currentNode instanceof Text && currentNode.textContent === expectedTextContent) {
          targetNode = currentNode;
          break;
        }
      }

      if (!targetNode) {
        throw new Error(`Expected to find text node ${expectedTextContent}`);
      }

      const range = document.createRange();
      const offset = expectedBoundary === "start" ? 0 : targetNode.textContent?.length ?? 0;
      range.setStart(targetNode, offset);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);

      if (element instanceof HTMLElement) {
        element.focus();
      }
    },
    { expectedTextContent: textContent, expectedBoundary: boundary }
  );

  await waitForSelectionWithin(locator);
}

async function moveCaretToLoadedEmptyInternalLine(page: Page, locator: Locator) {
  await waitForMarkdownEditorFocusToSettle(page);
  await locator.click();
  await locator.evaluate((element) => {
    const selection = window.getSelection();

    if (!selection) {
      throw new Error("Expected DOM selection to exist");
    }

    const paragraph = element.firstChild;

    if (!(paragraph instanceof Node)) {
      throw new Error("Expected table-cell paragraph node");
    }

    const childNodes = Array.from(paragraph.childNodes);
    const firstBreakIndex = childNodes.findIndex((node) => node.nodeName === "BR");
    const secondBreakIndex = childNodes.findIndex((node, index) => node.nodeName === "BR" && index > firstBreakIndex);

    if (firstBreakIndex < 0 || secondBreakIndex < 0) {
      throw new Error("Expected adjacent BR nodes for the loaded empty internal line");
    }

    const range = document.createRange();
    range.setStart(paragraph, secondBreakIndex);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    if (element instanceof HTMLElement) {
      element.focus();
    }
  });

  await waitForSelectionWithin(locator);
}

function getTableCellTextbox(page: Page, cellIndex: number) {
  return page.locator("table").getByRole("textbox").nth(cellIndex);
}

async function waitForSelectionWithin(locator: Locator) {
  await expect
    .poll(() =>
      locator.evaluate((element) => {
        const selection = window.getSelection();
        return Boolean(selection?.anchorNode && element.contains(selection.anchorNode));
      })
    )
    .toBe(true);
}

async function waitForEditableFocusWithin(locator: Locator) {
  await expect
    .poll(() =>
      locator.evaluate((element) => {
        const activeElement = document.activeElement;
        const selection = window.getSelection();

        const hasActiveEditable = Boolean(
          activeElement instanceof HTMLElement && element.contains(activeElement) && activeElement.getAttribute("contenteditable") === "true"
        );
        const hasSelectionWithin = Boolean(selection?.anchorNode && element.contains(selection.anchorNode));

        return hasActiveEditable || hasSelectionWithin;
      })
    )
    .toBe(true);
}

async function waitForSelectionAtTextStart(locator: Locator) {
  await expect
    .poll(() =>
      locator.evaluate((element) => {
        const selection = window.getSelection();

        if (!selection?.anchorNode || !element.contains(selection.anchorNode)) {
          return false;
        }

        if (selection.anchorNode.nodeType === Node.TEXT_NODE) {
          return selection.anchorOffset === 0;
        }

        const firstTextNodeWalker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
          acceptNode(node) {
            return node.textContent && node.textContent.length > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
          },
        });
        const firstTextNode = firstTextNodeWalker.nextNode();

        return selection.anchorOffset === 0 && selection.anchorNode.contains(firstTextNode);
      })
    )
    .toBe(true);
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

  const editorWrapper = page.locator(".sambee-markdown-editor .cm-scroller");
  const wrapperScrollTopBefore = await editorWrapper.evaluate((element) => (element as HTMLElement).scrollTop);

  await page.keyboard.press("Escape");

  const unsavedDialog = page.getByRole("dialog", { name: "Unsaved changes" });
  await expect(unsavedDialog).toBeVisible();
  await unsavedDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(unsavedDialog).toBeHidden();

  await expect(editor).toBeFocused();
  await expect.poll(async () => editorWrapper.evaluate((element) => (element as HTMLElement).scrollTop)).toBe(wrapperScrollTopBefore);
});

test("moves ArrowDown from a paragraph into the adjacent code block", async ({ page }) => {
  await mockMarkdownViewerApi(page, codeBlockNavigationMarkdown);

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
    if (!selection) {
      throw new Error("Expected a DOM selection");
    }

    selection.removeAllRanges();

    const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const text = node.textContent ?? "";
        return text.trim().length > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    const firstTextNode = walker.nextNode();

    if (!firstTextNode) {
      throw new Error("Expected markdown editor to contain text");
    }

    const range = document.createRange();
    range.setStart(firstTextNode, 0);
    range.collapse(true);
    selection.addRange(range);
    editable.focus();
  });

  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");

  await page.keyboard.type("X");

  await expect(page.locator(".cm-line").first()).toHaveText("Xsome text");
});

test("moves ArrowDown from a code block into the adjacent table", async ({ page }) => {
  await mockMarkdownViewerApi(page, logicalNavigationMarkdown);

  await page.goto("/browse/smb/demo");
  await page.getByRole("button", { name: `File: ${demoPath}` }).click();
  await page.getByRole("button", { name: "Edit" }).click();
  await waitForMarkdownEditorReady(page);

  await page.locator('.cm-content[role="textbox"]').first().waitFor();

  await page.evaluate(() => {
    const code = document.querySelector('.cm-content[role="textbox"]');

    if (!(code instanceof HTMLElement)) {
      throw new Error("Expected code block editor to be present");
    }

    const view = (code as HTMLElement & {
      cmTile?: {
        view?: {
          dispatch: (spec: { selection: { anchor: number; head: number } }) => void;
          focus: () => void;
          state: { doc: { length: number } };
        };
      };
    }).cmTile?.view;

    if (!view) {
      throw new Error("Expected CodeMirror view to be present");
    }

    const targetOffset = view.state.doc.length;
    view.dispatch({ selection: { anchor: targetOffset, head: targetOffset } });
    view.focus();
  });

  await page.keyboard.press("ArrowDown");
  await waitForEditableFocusWithin(page.locator("table").getByRole("textbox").first());
  await page.keyboard.type("X");

  await expect(page.locator("table").getByRole("textbox").first()).toContainText("Col 1");
  await expect(page.locator("table").getByRole("textbox").first()).toContainText("X");
});

test("moves ArrowUp selection out of a code block after returning from the adjacent table", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "This regression reproduces in the Chromium-based editor environment used for markdown validation.");

  await mockMarkdownViewerApi(page, logicalNavigationMarkdown);

  await page.goto("/browse/smb/demo");
  await page.getByRole("button", { name: `File: ${demoPath}` }).click();
  await page.getByRole("button", { name: "Edit" }).click();
  await waitForMarkdownEditorReady(page);

  await page.locator('.cm-content[role="textbox"]').first().waitFor();

  await page.evaluate(() => {
    const code = document.querySelector('.cm-content[role="textbox"]');

    if (!(code instanceof HTMLElement)) {
      throw new Error("Expected code block editor to be present");
    }

    const view = (code as HTMLElement & {
      cmTile?: {
        view?: {
          dispatch: (spec: { selection: { anchor: number; head: number } }) => void;
          focus: () => void;
          state: { doc: { length: number } };
        };
      };
    }).cmTile?.view;

    if (!view) {
      throw new Error("Expected CodeMirror view to be present");
    }

    const targetOffset = view.state.doc.length;
    view.dispatch({ selection: { anchor: targetOffset, head: targetOffset } });
    view.focus();
  });

  await page.keyboard.press("ArrowDown");
  const firstTableCell = page.locator("table").getByRole("textbox").first();
  await waitForEditableFocusWithin(firstTableCell);

  await page.keyboard.press("ArrowUp");
  await expect(page.locator(".cm-line").first()).toBeVisible();
  const precedingParagraph = page.locator('[contenteditable="true"][aria-label="Markdown editor"] > p').nth(1);
  let escapedIntoParagraph = false;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.keyboard.press("ArrowUp");

    escapedIntoParagraph = await precedingParagraph.evaluate((element) => {
      const selection = window.getSelection();
      return Boolean(selection?.anchorNode && element.contains(selection.anchorNode));
    });

    if (escapedIntoParagraph) {
      break;
    }
  }

  expect(escapedIntoParagraph).toBe(true);
});

test("moves ArrowUp out of the table when there is no cell above", async ({ page }) => {
  await openMarkdownEditor(page, tableCellNavigationMarkdown);

  await moveCaretToTableCellBoundaryByKeyboard(page, 0, "start");
  await page.keyboard.press("ArrowUp");
  const firstParagraph = page.locator('[contenteditable="true"][aria-label="Markdown editor"] > p').first();
  await waitForSelectionWithin(firstParagraph);
  await page.keyboard.type("U");

  await expect(firstParagraph).toHaveText("Ualpha");
});

test("moves ArrowRight to the next cell when the caret is at the end of a cell", async ({ page }) => {
  await openMarkdownEditor(page, tableCellNavigationMarkdown);

  await moveCaretToTableCellBoundaryByKeyboard(page, 2, "end");
  await page.keyboard.press("ArrowRight");
  const targetCell = getTableCellTextbox(page, 3);
  await waitForEditableFocusWithin(targetCell);
  await page.keyboard.type("R");

  await expect(targetCell).toContainText("RB1");
});

test("moves ArrowLeft to the previous cell when the caret is at the start of a cell", async ({ page }) => {
  await openMarkdownEditor(page, tableCellNavigationMarkdown);

  await moveCaretToTableCellBoundaryByKeyboard(page, 3, "start");
  await page.keyboard.press("ArrowLeft");
  const targetCell = getTableCellTextbox(page, 2);
  await waitForEditableFocusWithin(targetCell);
  await page.keyboard.type("L");

  await expect(targetCell).toContainText("A1L");
});

test("moves ArrowDown to the cell below when the caret is at the bottom of a cell", async ({ page }) => {
  await openMarkdownEditor(page, tableCellNavigationMarkdown);

  await moveCaretToTableCellBoundaryByKeyboard(page, 2, "end");
  await page.keyboard.press("ArrowDown");
  const targetCell = getTableCellTextbox(page, 4);
  await waitForEditableFocusWithin(targetCell);
  await page.keyboard.type("D");

  await expect(targetCell).toContainText("DA2");
});

test("moves ArrowUp to the cell above when the caret is at the top of a cell", async ({ page }) => {
  await openMarkdownEditor(page, tableCellNavigationMarkdown);

  await moveCaretToTableCellBoundaryByKeyboard(page, 4, "start");
  await page.keyboard.press("ArrowUp");
  const targetCell = getTableCellTextbox(page, 2);
  await waitForEditableFocusWithin(targetCell);
  await page.keyboard.type("U");

  await expect(targetCell).toContainText("UA1");
});

test("moves ArrowDown out of the table when there is no cell below", async ({ page }) => {
  await openMarkdownEditor(page, tableCellNavigationMarkdown);

  await moveCaretToTableCellBoundaryByKeyboard(page, 3, "end");
  await page.keyboard.press("ArrowDown");
  const targetCell = getTableCellTextbox(page, 5);
  await waitForEditableFocusWithin(targetCell);
  await moveCaretToTableCellBoundaryByKeyboard(page, 5, "end");
  await page.keyboard.press("ArrowDown");
  const secondParagraph = page.locator('[contenteditable="true"][aria-label="Markdown editor"] > p').nth(1);
  await waitForSelectionWithin(secondParagraph);
  await page.keyboard.type("D");

  await expect(secondParagraph).toHaveText("Domega");
});

test("moves ArrowDown out of the table from the other last-row cell", async ({ page }) => {
  await openMarkdownEditor(page, tableCellNavigationMarkdown);

  await moveCaretToTableCellBoundaryByKeyboard(page, 2, "end");
  await page.keyboard.press("ArrowDown");
  const targetCell = getTableCellTextbox(page, 4);
  await waitForEditableFocusWithin(targetCell);
  await moveCaretToTableCellBoundaryByKeyboard(page, 4, "end");
  await page.keyboard.press("ArrowDown");
  const secondParagraph = page.locator('[contenteditable="true"][aria-label="Markdown editor"] > p').nth(1);
  await waitForSelectionWithin(secondParagraph);
  await page.keyboard.type("D");

  await expect(secondParagraph).toHaveText("Domega");
});

test("saves Shift+Enter table-cell breaks as canonical br tags", async ({ page }) => {
  const uploadBodies: string[] = [];

  await mockMarkdownViewerApi(page, tableCellNavigationMarkdown, {
    onUploadBody: (body) => {
      uploadBodies.push(body);
    },
  });

  await page.goto("/browse/smb/demo");
  await page.getByRole("button", { name: `File: ${demoPath}` }).click();
  await page.getByRole("button", { name: "Edit" }).click();
  await waitForMarkdownEditorReady(page);

  await moveCaretToTableCellBoundaryByKeyboard(page, 2, "end");

  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("bar");

  const saveButton = page.getByRole("button", { name: "Save" });
  await expect(saveButton).toBeEnabled();
  await saveButton.click();

  await expect.poll(() => uploadBodies.length).toBe(1);
  expect(uploadBodies[0]).toContain("A1<br />bar");
  expect(uploadBodies[0]).not.toContain("A1&#10;bar");
});

test("saves consecutive Shift+Enter table-cell breaks as repeated canonical br tags", async ({ page }) => {
  const uploadBodies: string[] = [];

  await mockMarkdownViewerApi(page, tableCellNavigationMarkdown, {
    onUploadBody: (body) => {
      uploadBodies.push(body);
    },
  });

  await page.goto("/browse/smb/demo");
  await page.getByRole("button", { name: `File: ${demoPath}` }).click();
  await page.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByRole("textbox", { name: "Markdown editor" })).toBeVisible();

  await moveCaretToTableCellBoundaryByKeyboard(page, 2, "end");

  await page.keyboard.press("Shift+Enter");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("bar");

  const saveButton = page.getByRole("button", { name: "Save" });
  await expect(saveButton).toBeEnabled();
  await saveButton.click();

  await expect.poll(() => uploadBodies.length).toBe(1);
  expect(uploadBodies[0]).toContain("A1<br /><br />bar");
  expect(uploadBodies[0]).not.toContain("A1&#10;&#xA;bar");
});

test("deletes across an internal Shift+Enter break and saves the joined canonical cell content", async ({ page }) => {
  const uploadBodies: string[] = [];

  await mockMarkdownViewerApi(page, tableCellNavigationMarkdown, {
    onUploadBody: (body) => {
      uploadBodies.push(body);
    },
  });

  await page.goto("/browse/smb/demo");
  await page.getByRole("button", { name: `File: ${demoPath}` }).click();
  await page.getByRole("button", { name: "Edit" }).click();
  await waitForMarkdownEditorReady(page);

  await moveCaretToTableCellBoundaryByKeyboard(page, 2, "end");

  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("b");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("c");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Backspace");

  const saveButton = page.getByRole("button", { name: "Save" });
  await expect(saveButton).toBeEnabled();
  await saveButton.click();

  await expect.poll(() => uploadBodies.length).toBe(1);
  expect(uploadBodies[0]).toContain("A1<br />bc");
  expect(uploadBodies[0]).not.toContain("A1<br />b<br />c");
});

test("undoes and redoes Shift+Enter table-cell edits before saving", async ({ page }) => {
  const uploadBodies: string[] = [];

  await mockMarkdownViewerApi(page, tableCellNavigationMarkdown, {
    onUploadBody: (body) => {
      uploadBodies.push(body);
    },
  });

  await page.goto("/browse/smb/demo");
  await page.getByRole("button", { name: `File: ${demoPath}` }).click();
  await page.getByRole("button", { name: "Edit" }).click();
  await waitForMarkdownEditorReady(page);

  await moveCaretToTableCellBoundaryByKeyboard(page, 2, "end");

  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("b");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("c");
  await page.keyboard.press("Control+Z");
  await page.keyboard.press("Control+Z");
  await page.keyboard.press("Control+Y");
  await page.keyboard.press("Control+Y");

  const saveButton = page.getByRole("button", { name: "Save" });
  await expect(saveButton).toBeEnabled();
  await saveButton.click();

  await expect.poll(() => uploadBodies.length).toBe(1);
  expect(uploadBodies[0]).toContain("A1<br />b<br />c");
});

test("moves the caret left and back right across the final internal Shift+Enter break", async ({ page }) => {
  const uploadBodies: string[] = [];

  await mockMarkdownViewerApi(page, tableCellNavigationMarkdown, {
    onUploadBody: (body) => {
      uploadBodies.push(body);
    },
  });

  await page.goto("/browse/smb/demo");
  await page.getByRole("button", { name: `File: ${demoPath}` }).click();
  await page.getByRole("button", { name: "Edit" }).click();
  await waitForMarkdownEditorReady(page);

  await moveCaretToTableCellBoundaryByKeyboard(page, 2, "end");

  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("b");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("c");

  const targetCell = getTableCellTextbox(page, 2);
  const endingOffset = await getCaretTextOffset(targetCell);

  expect(endingOffset).not.toBeNull();

  await page.keyboard.press("ArrowLeft");
  await waitForEditableFocusWithin(targetCell);
  await expect.poll(() => getCaretTextOffset(targetCell)).toBe((endingOffset ?? 0) - 1);

  await page.keyboard.press("ArrowRight");
  await waitForEditableFocusWithin(targetCell);
  await expect.poll(() => getCaretTextOffset(targetCell)).toBe(endingOffset);

  await page.keyboard.type("X");

  const saveButton = page.getByRole("button", { name: "Save" });
  await expect(saveButton).toBeEnabled();
  await saveButton.click();

  await expect.poll(() => uploadBodies.length).toBe(1);
  expect(uploadBodies[0]).toContain("A1<br />b<br />cX");
});

test("moves the caret left across the first internal Shift+Enter break and inserts before the next line", async ({ page }) => {
  const uploadBodies: string[] = [];

  await mockMarkdownViewerApi(page, tableCellNavigationMarkdown, {
    onUploadBody: (body) => {
      uploadBodies.push(body);
    },
  });

  await page.goto("/browse/smb/demo");
  await page.getByRole("button", { name: `File: ${demoPath}` }).click();
  await page.getByRole("button", { name: "Edit" }).click();
  await waitForMarkdownEditorReady(page);

  await moveCaretToTableCellBoundaryByKeyboard(page, 2, "end");

  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("b");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("c");

  const targetCell = getTableCellTextbox(page, 2);
  await moveCaretToTextNodeBoundary(targetCell, "b", "start");

  await page.keyboard.press("ArrowLeft");
  await waitForEditableFocusWithin(targetCell);
  await page.keyboard.type("X");

  const saveButton = page.getByRole("button", { name: "Save" });
  await expect(saveButton).toBeEnabled();
  await saveButton.click();

  await expect.poll(() => uploadBodies.length).toBe(1);
  expect(uploadBodies[0]).toContain("A1X<br />b<br />c");
});

test("reloads and structurally renders saved consecutive Shift+Enter breaks inside the table cell", async ({ page }) => {
  const uploadBodies: string[] = [];

  await mockMarkdownViewerApi(page, tableCellNavigationMarkdown, {
    onUploadBody: (body) => {
      uploadBodies.push(body);
    },
    persistUploadedMarkdown: true,
  });

  await page.goto("/browse/smb/demo");
  await page.getByRole("button", { name: `File: ${demoPath}` }).click();
  await page.getByRole("button", { name: "Edit" }).click();
  await waitForMarkdownEditorReady(page);

  await moveCaretToTableCellBoundaryByKeyboard(page, 2, "end");

  await page.keyboard.press("Shift+Enter");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("bar");

  const saveButton = page.getByRole("button", { name: "Save" });
  await expect(saveButton).toBeEnabled();
  await saveButton.click();

  await expect.poll(() => uploadBodies.length).toBe(1);
  expect(uploadBodies[0]).toContain("A1<br /><br />bar");

  await page.reload();
  await page.getByRole("button", { name: `File: ${demoPath}` }).click();

  const firstDataCell = page.locator("table td").first();
  await expect(firstDataCell).toBeVisible();
  await expect.poll(() => firstDataCell.evaluate((element) => element.querySelectorAll("br").length)).toBe(2);
});

test("saves, reloads, and renders a loaded empty internal table-cell line as canonical br tags", async ({ page }) => {
  const uploadBodies: string[] = [];

  await mockMarkdownViewerApi(page, loadedEmptyInternalLineMarkdown, {
    onUploadBody: (body) => {
      uploadBodies.push(body);
    },
    persistUploadedMarkdown: true,
  });

  await page.goto("/browse/smb/demo");
  await page.getByRole("button", { name: `File: ${demoPath}` }).click();
  await page.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByRole("textbox", { name: "Markdown editor" })).toBeVisible();

  const targetCell = getTableCellTextbox(page, 2);
  await moveCaretToLoadedEmptyInternalLine(page, targetCell);
  await page.keyboard.type("s");

  const saveButton = page.getByRole("button", { name: "Save" });
  await expect(saveButton).toBeEnabled();
  await saveButton.click();

  await expect.poll(() => uploadBodies.length).toBe(1);
  expect(uploadBodies[0]).toContain("A1<br />s<br />A3");
  expect(uploadBodies[0]).not.toContain("A1<br /><br />s</br>A3");

  await page.reload();
  await page.getByRole("button", { name: `File: ${demoPath}` }).click();

  const firstDataCell = page.locator("table td").first();
  await expect(firstDataCell).toBeVisible();
  await expect.poll(() => firstDataCell.evaluate((element) => element.querySelectorAll("br").length)).toBe(2);
  await expect(firstDataCell).toContainText("A1");
  await expect(firstDataCell).toContainText("s");
  await expect(firstDataCell).toContainText("A3");
});

test("switches to source mode after typing into a loaded empty internal table-cell line with canonical br tags", async ({ page }) => {
  await mockMarkdownViewerApi(page, loadedEmptyInternalLineMarkdown);

  await page.goto("/browse/smb/demo");
  await page.getByRole("button", { name: `File: ${demoPath}` }).click();
  await page.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByRole("textbox", { name: "Markdown editor" })).toBeVisible();

  const targetCell = getTableCellTextbox(page, 2);
  await moveCaretToLoadedEmptyInternalLine(page, targetCell);
  await page.keyboard.type("s");

  const sourceModeToggle = page.getByRole("radio", { name: "Source mode" });
  await expect(sourceModeToggle).toBeVisible();
  await sourceModeToggle.click();

  const sourceEditor = page.locator('.cm-content[role="textbox"]').first();
  await expect(sourceEditor).toBeVisible();

  await expect.poll(() => getCodeMirrorDocumentText(sourceEditor)).toContain("A1<br />s<br />A3");
  expect(await getCodeMirrorDocumentText(sourceEditor)).not.toContain("A1<br /><br />s</br>A3");
});

test("switches to source mode after a trailing Shift+Enter without persisting the unsupported trailing break", async ({ page }) => {
  await mockMarkdownViewerApi(page, tableCellNavigationMarkdown);

  await page.goto("/browse/smb/demo");
  await page.getByRole("button", { name: `File: ${demoPath}` }).click();
  await page.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByRole("textbox", { name: "Markdown editor" })).toBeVisible();

  await moveCaretToTableCellBoundaryByKeyboard(page, 2, "end");

  await page.keyboard.press("Shift+Enter");

  const sourceModeToggle = page.getByRole("radio", { name: "Source mode" });
  await expect(sourceModeToggle).toBeVisible();
  await sourceModeToggle.click();

  const sourceEditor = page.locator('.cm-content[role="textbox"]').first();
  await expect(sourceEditor).toBeVisible();

  const sourceText = await getCodeMirrorDocumentText(sourceEditor);
  expect(sourceText).toContain("A1");
  expect(sourceText).not.toMatch(/A1<br\s*\/>/);
});

test("switches to source mode after Shift+Enter plus continued typing with canonical br tags", async ({ page }) => {
  await mockMarkdownViewerApi(page, tableCellNavigationMarkdown);

  await page.goto("/browse/smb/demo");
  await page.getByRole("button", { name: `File: ${demoPath}` }).click();
  await page.getByRole("button", { name: "Edit" }).click();
  await waitForMarkdownEditorReady(page);

  await moveCaretToTableCellBoundaryByKeyboard(page, 2, "end");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("bar");

  const sourceModeToggle = page.getByRole("radio", { name: "Source mode" });
  await expect(sourceModeToggle).toBeVisible();
  await sourceModeToggle.click();

  const sourceEditor = page.locator('.cm-content[role="textbox"]').first();
  await expect(sourceEditor).toBeVisible();

  await expect.poll(() => getCodeMirrorDocumentText(sourceEditor)).toContain("A1<br />bar");
  expect(await getCodeMirrorDocumentText(sourceEditor)).not.toContain("A1&#xA;bar");
});

test("mobile toolbar can switch to source mode after Shift+Enter without persisting a trailing break", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockMarkdownViewerApi(page, tableCellNavigationMarkdown);

  await page.goto("/browse/smb/demo");
  await page.getByRole("button", { name: `File: ${demoPath}` }).click();
  await page.getByRole("button", { name: "Edit" }).click();
  await waitForMarkdownEditorReady(page);

  await moveCaretToTableCellBoundaryByKeyboard(page, 2, "end");
  await page.keyboard.press("Shift+Enter");

  const moreActionsButton = page.getByRole("button", { name: "More actions" });
  await expect(moreActionsButton).toBeVisible();
  await moreActionsButton.click();

  const sourceModeMenuItem = page.getByRole("menuitem", { name: "Source mode" });
  await expect(sourceModeMenuItem).toBeVisible();
  await sourceModeMenuItem.click();

  const sourceEditor = page.locator('.cm-content[role="textbox"]').first();
  await expect(sourceEditor).toBeVisible();

  const sourceText = await getCodeMirrorDocumentText(sourceEditor);
  expect(sourceText).toContain("A1");
  expect(sourceText).not.toMatch(/A1<br\s*\/>/);
});

test("mobile toolbar switches to source mode after Shift+Enter plus continued typing with canonical br tags", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockMarkdownViewerApi(page, tableCellNavigationMarkdown);

  await page.goto("/browse/smb/demo");
  await page.getByRole("button", { name: `File: ${demoPath}` }).click();
  await page.getByRole("button", { name: "Edit" }).click();
  await waitForMarkdownEditorReady(page);

  await moveCaretToTableCellBoundaryByKeyboard(page, 2, "end");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("bar");

  const moreActionsButton = page.getByRole("button", { name: "More actions" });
  await expect(moreActionsButton).toBeVisible();
  await moreActionsButton.click();

  const sourceModeMenuItem = page.getByRole("menuitem", { name: "Source mode" });
  await expect(sourceModeMenuItem).toBeVisible();
  await sourceModeMenuItem.click();

  const sourceEditor = page.locator('.cm-content[role="textbox"]').first();
  await expect(sourceEditor).toBeVisible();

  await expect.poll(() => getCodeMirrorDocumentText(sourceEditor)).toContain("A1<br />bar");
  expect(await getCodeMirrorDocumentText(sourceEditor)).not.toContain("A1&#xA;bar");
});

test("enters markdown edit mode without refetching the file or remounting the editor subtree", async ({ page }) => {
  let viewerFileRequestCount = 0;

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
      viewerFileRequestCount += 1;
      await route.fulfill({
        status: 200,
        contentType: "text/markdown; charset=utf-8",
        body: initialMarkdown,
      });
      return;
    }

    if (pathname === `/api/browse/${demoConnectionId}/lock` && request.method() === "POST") {
      await fulfillJson(route, {
        lock_id: "lock-1",
        file_path: demoPath,
        locked_by: "demo-admin",
        locked_at: "2026-04-12T12:00:00Z",
      });
      return;
    }

    if (pathname === `/api/browse/${demoConnectionId}/lock/heartbeat` && request.method() === "POST") {
      await route.fulfill({ status: 204, body: "" });
      return;
    }

    if (pathname === `/api/browse/${demoConnectionId}/lock` && request.method() === "DELETE") {
      await route.fulfill({ status: 204, body: "" });
      return;
    }

    await fulfillJson(route, { detail: `Unhandled mocked route: ${request.method()} ${pathname}` }, 404);
  });

  await page.goto("/browse/smb/demo");
  await page.getByRole("button", { name: `File: ${demoPath}` }).click();
  await page.getByTestId("markdown-viewer-content").waitFor();

  await expect.poll(() => viewerFileRequestCount).toBeGreaterThan(0);
  const viewerFileRequestCountBeforeEdit = viewerFileRequestCount;

  await page.evaluate(() => {
    const target = document.querySelector('[data-testid="markdown-viewer-content"]');

    if (!(target instanceof HTMLElement)) {
      throw new Error("Expected markdown viewer content to exist");
    }

    const events: Array<{ type: "added" | "removed"; node: string }> = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof HTMLElement)) {
            continue;
          }

          if (node.matches(".sambee-markdown-editor") || node.querySelector(".sambee-markdown-editor")) {
            events.push({ type: "added", node: node.className });
          }
        }

        for (const node of record.removedNodes) {
          if (!(node instanceof HTMLElement)) {
            continue;
          }

          if (node.matches(".sambee-markdown-editor") || node.querySelector(".sambee-markdown-editor")) {
            events.push({ type: "removed", node: node.className });
          }
        }
      }
    });

    observer.observe(target, { childList: true, subtree: true });
    window.__markdownEditorMountEvents = events;
    window.__markdownEditorMountObserver = observer;
  });

  await page.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByRole("textbox", { name: "Markdown editor" })).toBeVisible();

  const mountEvents = await page.evaluate(() => {
    const observer = window.__markdownEditorMountObserver;
    observer?.disconnect();
    return window.__markdownEditorMountEvents;
  });

  expect(viewerFileRequestCount).toBe(viewerFileRequestCountBeforeEdit);
  expect(mountEvents).toEqual([{ type: "added", node: expect.stringContaining("sambee-markdown-editor") }]);
});
