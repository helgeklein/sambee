import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = process.env.SAMBEE_FRONTEND_BASE_URL ?? 'http://localhost:3000';
const demoConnectionId = '85610f49-ab40-4d96-8750-ddab3e8e8764';
const demoPath = 'note.md';
const loadedEmptyLineMarkdown = 'alpha\n\n| Col 1 | Col 2 |\n| --- | --- |\n| A1<br /><br />A3 | B1 |\n\nomega\n';

async function fulfillJson(route, json, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(json),
  });
}

async function mockMarkdownViewerApi(page, markdown, options = {}) {
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
        appearance: { theme_id: 'sambee-light', custom_themes: [] },
        localization: { language: 'browser', regional_locale: 'browser' },
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
        appearance: { theme_id: 'sambee-light', custom_themes: [] },
        localization: { language: 'browser', regional_locale: 'browser' },
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
      options.onUploadBody?.(request.postDataBuffer()?.toString('utf8') ?? '');
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

function createPageErrorRecorder(page) {
  const pageErrors = [];
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });
  return pageErrors;
}

function assertNoPageErrors(pageErrors, context) {
  assert.equal(pageErrors.length, 0, `Expected no page errors ${context}, received: ${pageErrors.join(' | ')}`);
}

async function openMarkdownEditor(page, onUploadBody) {
  await mockMarkdownViewerApi(page, loadedEmptyLineMarkdown, { onUploadBody });
  await page.goto(`${baseUrl}/browse/smb/demo`);
  await page.getByRole('button', { name: `File: ${demoPath}` }).click();
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('textbox', { name: 'Markdown editor' }).waitFor();

  const targetCell = page.locator('table').getByRole('textbox').nth(2);
  await targetCell.waitFor();
  return targetCell;
}

async function moveCaretToLoadedEmptyLine(cellLocator) {
  await cellLocator.click();
  await cellLocator.evaluate((element) => {
    if (!(element instanceof HTMLElement)) {
      throw new Error('Expected table cell editable to be an HTMLElement');
    }

    const selection = window.getSelection();

    if (!selection) {
      throw new Error('Expected a DOM selection');
    }

    const paragraph = element.firstChild;

    if (!(paragraph instanceof Node)) {
      throw new Error('Expected table-cell paragraph');
    }

    const childNodes = Array.from(paragraph.childNodes);
    const firstBreakIndex = childNodes.findIndex((node) => node.nodeName === 'BR');
    const secondBreakIndex = childNodes.findIndex((node, index) => node.nodeName === 'BR' && index > firstBreakIndex);

    if (firstBreakIndex < 0 || secondBreakIndex < 0) {
      throw new Error('Expected adjacent BR nodes');
    }

    const range = document.createRange();
    range.setStart(paragraph, secondBreakIndex);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    element.focus();
  });
}

async function selectionRemainsWithin(cellLocator) {
  return cellLocator.evaluate((element) => {
    const selection = window.getSelection();
    return Boolean(selection?.anchorNode && element.contains(selection.anchorNode));
  });
}

async function waitForUpload(uploadBodies) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (uploadBodies.length > 0) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error('Expected upload request to be observed');
}

const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();
  const uploadBodies = [];
  const pageErrors = createPageErrorRecorder(page);
  const targetCell = await openMarkdownEditor(page, (body) => {
    uploadBodies.push(body);
  });

  await moveCaretToLoadedEmptyLine(targetCell);
  await page.keyboard.type('s');
  const focusRetainedAfterTyping = await selectionRemainsWithin(targetCell);
  assertNoPageErrors(pageErrors, 'after typing into the loaded empty line');

  const saveButton = page.getByRole('button', { name: 'Save' });
  await saveButton.click();
  await waitForUpload(uploadBodies);
  await page.waitForLoadState('networkidle');

  assertNoPageErrors(pageErrors, 'after save');
  assert.equal(focusRetainedAfterTyping, true, 'Expected selection to remain within the edited table cell after typing into the loaded empty line');
  assert.equal(uploadBodies.length, 1, `Expected exactly one upload request, received ${uploadBodies.length}`);
  assert.match(uploadBodies[0], /A1<br\s*\/>s<br\s*\/>A3/, 'Expected the saved payload to preserve the middle line as canonical <br /> output');
  assert.doesNotMatch(uploadBodies[0], /A1<br\s*\/><br\s*>s<\/br>A3/, 'Did not expect the malformed adjacent-break save topology');

  console.log(JSON.stringify({
    uploadBody: uploadBodies[0],
    focusRetainedAfterTyping,
  }, null, 2));

  await page.close();
} finally {
  await browser.close();
}
