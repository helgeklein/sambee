import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = process.env.SAMBEE_FRONTEND_BASE_URL ?? 'http://localhost:3000';
const demoConnectionId = '85610f49-ab40-4d96-8750-ddab3e8e8764';
const demoPath = 'note.md';
const tableCellNavigationMarkdown = 'alpha\n\n| Col 1 | Col 2 |\n| --- | --- |\n| A1 | B1 |\n| A2 | B2 |\n\nomega\n';

async function fulfillJson(route, json, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(json),
  });
}

async function mockMarkdownViewerApi(page, markdown) {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;

    if (pathname.endsWith('/auth/config')) {
      await fulfillJson(route, { auth_method: 'none' });
      return;
    }

    if (pathname.endsWith('/logs/config')) {
      await fulfillJson(route, {
        logging_enabled: false,
        logging_level: 'WARNING',
        tracing_enabled: false,
        tracing_level: 'ERROR',
        tracing_components: [],
      });
      return;
    }

    if (pathname.endsWith('/auth/me')) {
      await fulfillJson(route, {
        id: 'user-1',
        username: 'demo-admin',
        role: 'admin',
        is_active: true,
      });
      return;
    }

    if (pathname.endsWith('/auth/me/settings') && request.method() === 'GET') {
      await fulfillJson(route, {
        appearance: {
          theme_id: 'sambee-light',
          custom_themes: [],
        },
        localization: {
          language: 'browser',
          regional_locale: 'browser',
        },
        browser: {
          quick_nav_include_dot_directories: false,
          file_browser_view_mode: 'list',
          pane_mode: 'single',
          selected_connection_id: null,
          viewer_associations: {},
        },
      });
      return;
    }

    if (pathname.endsWith('/auth/me/settings') && request.method() === 'PUT') {
      await fulfillJson(route, {
        appearance: {
          theme_id: 'sambee-light',
          custom_themes: [],
        },
        localization: {
          language: 'browser',
          regional_locale: 'browser',
        },
        browser: {
          quick_nav_include_dot_directories: false,
          file_browser_view_mode: 'list',
          pane_mode: 'single',
          selected_connection_id: null,
          viewer_associations: {},
        },
      });
      return;
    }

    if (pathname.endsWith('/version')) {
      await fulfillJson(route, {
        version: '0.8.0-test',
        build_time: '2026-04-12T12:00:00Z',
        git_commit: 'deadbeef',
      });
      return;
    }

    if (pathname.endsWith('/connections')) {
      await fulfillJson(route, [
        {
          id: demoConnectionId,
          name: 'Demo',
          slug: 'demo',
          type: 'smb',
          host: 'demo.local',
          port: 445,
          share_name: 'data',
          username: 'demo\\tester',
          path_prefix: '\\Demo',
          scope: 'private',
          access_mode: 'read_write',
          can_manage: true,
          created_at: '2026-02-13T20:22:41.779354',
          updated_at: '2026-04-12T10:15:47.930127',
        },
      ]);
      return;
    }

    if (pathname === `/api/browse/${demoConnectionId}/list`) {
      await fulfillJson(route, {
        path: '/',
        items: [
          {
            name: demoPath,
            path: demoPath,
            type: 'file',
            size: markdown.length,
            mime_type: 'text/markdown',
            modified_at: '2026-04-12T12:00:00Z',
          },
        ],
      });
      return;
    }

    if (pathname === `/api/viewer/${demoConnectionId}/file`) {
      await route.fulfill({
        status: 200,
        contentType: 'text/markdown; charset=utf-8',
        body: markdown,
      });
      return;
    }

    if (pathname === `/api/browse/${demoConnectionId}/lock` && request.method() === 'POST') {
      await fulfillJson(route, {
        lock_id: 'lock-1',
        file_path: demoPath,
        locked_by: 'demo-admin',
        locked_at: '2026-04-12T12:00:00Z',
      });
      return;
    }

    if (pathname === `/api/browse/${demoConnectionId}/lock/heartbeat` && request.method() === 'POST') {
      await route.fulfill({ status: 204, body: '' });
      return;
    }

    if (pathname === `/api/browse/${demoConnectionId}/lock` && request.method() === 'DELETE') {
      await route.fulfill({ status: 204, body: '' });
      return;
    }

    if (pathname === `/api/browse/${demoConnectionId}/upload` && request.method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ path: demoPath }),
      });
      return;
    }

    await fulfillJson(route, { detail: `Unhandled mocked route: ${request.method()} ${pathname}` }, 404);
  });
}

async function openMarkdownEditor(page) {
  await mockMarkdownViewerApi(page, tableCellNavigationMarkdown);
  await page.goto(`${baseUrl}/browse/smb/demo`);
  await page.getByRole('button', { name: `File: ${demoPath}` }).click();
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('textbox', { name: 'Markdown editor' }).waitFor();
  const targetCell = page.locator('table').getByRole('textbox').nth(2);
  await targetCell.waitFor();
  return targetCell;
}

async function setCaretToCellEnd(cellLocator) {
  await cellLocator.click();
  await cellLocator.evaluate((element) => {
    if (!(element instanceof HTMLElement)) {
      throw new Error('Expected table cell editable to be an HTMLElement');
    }

    const selection = window.getSelection();

    if (!selection) {
      throw new Error('Expected a DOM selection');
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
      throw new Error('Expected the table cell editable to contain text');
    }

    const range = document.createRange();
    range.setStart(targetNode, targetNode.textContent?.length ?? 0);
    range.collapse(true);
    selection.addRange(range);
    element.focus();
  });
}

async function selectionIsWithin(cellLocator) {
  return cellLocator.evaluate((element) => {
    const selection = window.getSelection();
    return Boolean(selection?.anchorNode && element.contains(selection.anchorNode));
  });
}

async function runProof() {
  const browser = await chromium.launch({ headless: true });

  try {
    const shiftEnterPage = await browser.newPage();
    const shiftEnterErrors = [];
    shiftEnterPage.on('pageerror', (error) => {
      shiftEnterErrors.push(error.message);
    });

    const shiftEnterCell = await openMarkdownEditor(shiftEnterPage);
    await setCaretToCellEnd(shiftEnterCell);
    await shiftEnterPage.keyboard.press('Shift+Enter');
    const shiftEnterStayedInCell = await selectionIsWithin(shiftEnterCell);

    const plainEnterPage = await browser.newPage();
    const plainEnterErrors = [];
    plainEnterPage.on('pageerror', (error) => {
      plainEnterErrors.push(error.message);
    });

    const originalCell = await openMarkdownEditor(plainEnterPage);
    const nextRowCell = plainEnterPage.locator('table').getByRole('textbox').nth(4);
    await nextRowCell.waitFor();
    await setCaretToCellEnd(originalCell);
    await plainEnterPage.keyboard.press('Enter');
    const plainEnterStayedInOriginalCell = await selectionIsWithin(originalCell);
    const plainEnterMovedToNextRow = await selectionIsWithin(nextRowCell);

    assert.equal(shiftEnterErrors.length, 0, `Expected no page errors after Shift+Enter, received: ${shiftEnterErrors.join(' | ')}`);
    assert.equal(shiftEnterStayedInCell, true, 'Expected Shift+Enter to keep focus in the edited table cell');
    assert.equal(plainEnterErrors.length, 0, `Expected no page errors after plain Enter, received: ${plainEnterErrors.join(' | ')}`);
    assert.equal(plainEnterStayedInOriginalCell, false, 'Expected plain Enter to stop using the original cell focus path');
    assert.equal(plainEnterMovedToNextRow, true, 'Expected plain Enter to follow the upstream table-navigation path into the next row');

    console.log('Proof 2B passed.');
    console.log('- Shift+Enter stayed within the edited table cell without page errors.');
    console.log('- Plain Enter preserved the upstream table navigation path into the next row.');

    await shiftEnterPage.close();
    await plainEnterPage.close();
  } finally {
    await browser.close();
  }
}

runProof().catch((error) => {
  console.error('Proof 2B failed.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
