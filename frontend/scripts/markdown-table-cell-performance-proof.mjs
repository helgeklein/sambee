import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = process.env.SAMBEE_FRONTEND_BASE_URL ?? 'http://localhost:3000';
const demoConnectionId = '85610f49-ab40-4d96-8750-ddab3e8e8764';
const demoPath = 'note.md';
const SMALL_PUBLICATION_THRESHOLD_MS = 50;
const LARGE_PUBLICATION_THRESHOLD_MS = 150;
const SMALL_FLUSH_THRESHOLD_MS = 50;
const LARGE_FLUSH_THRESHOLD_MS = 150;
const SMALL_SOURCE_MODE_THRESHOLD_MS = 150;
const LARGE_SOURCE_MODE_THRESHOLD_MS = 250;
const BURST_EDIT_COUNT = 6;

const smallMarkdown = 'alpha\n\n| Col 1 | Col 2 |\n| --- | --- |\n| A1 | B1 |\n| A2 | B2 |\n\nomega\n';
const largeMarkdown = Array.from({ length: 800 }, (_, index) => `line ${index + 1}`).join('\n') + '\n\n| Col 1 | Col 2 |\n| --- | --- |\n| A1 | B1 |\n| A2 | B2 |\n\n' + Array.from({ length: 800 }, (_, index) => `tail ${index + 1}`).join('\n') + '\n';

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

async function setCaretToCellBoundary(cellLocator, boundary) {
  await cellLocator.click();
  await cellLocator.evaluate((element, targetBoundary) => {
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

    const textNodes = [];
    let currentNode = walker.nextNode();

    while (currentNode) {
      textNodes.push(currentNode);
      currentNode = walker.nextNode();
    }

    const targetNode = targetBoundary === 'start' ? textNodes[0] : textNodes[textNodes.length - 1];

    if (!targetNode || !(targetNode instanceof Text)) {
      throw new Error('Expected the table cell editable to contain text');
    }

    const range = document.createRange();
    const offset = targetBoundary === 'start' ? 0 : targetNode.textContent?.length ?? 0;
    range.setStart(targetNode, offset);
    range.collapse(true);
    selection.addRange(range);
    element.focus();
  }, boundary);
}

async function openMarkdownEditor(page, markdown, onUploadBody) {
  await mockMarkdownViewerApi(page, markdown, { onUploadBody });
  await page.goto(`${baseUrl}/browse/smb/demo`);
  await page.getByRole('button', { name: `File: ${demoPath}` }).click();
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('textbox', { name: 'Markdown editor' }).waitFor();

  const targetCell = page.locator('table').getByRole('textbox').nth(2);
  await targetCell.waitFor();
  await setCaretToCellBoundary(targetCell, 'end');
  return targetCell;
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

async function waitForEnabled(locator) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const isEnabled = await locator.isEnabled().catch(() => false);

    if (isEnabled) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error('Expected control to become enabled');
}

async function waitForSourceText(sourceEditor, expectedText) {
  let lastSourceText = '';

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const sourceText = await sourceEditor.evaluate((element) => {
      if (!(element instanceof HTMLElement)) {
        throw new Error('Expected source editor element to be an HTMLElement');
      }

      const view = element.cmTile?.view;

      if (!view) {
        throw new Error('Expected CodeMirror view to be present');
      }

      return view.state.doc.toString();
    });
    lastSourceText = sourceText ?? '';

    if (sourceText?.includes(expectedText)) {
      return sourceText;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(
    `Expected source-mode content to include: ${expectedText}\nObserved source-mode text snippet: ${lastSourceText.slice(lastSourceText.indexOf('A1') >= 0 ? lastSourceText.indexOf('A1') : 0, (lastSourceText.indexOf('A1') >= 0 ? lastSourceText.indexOf('A1') : 0) + 200)}`
  );
}

async function runScenario(browser, label, markdown, thresholds) {
  const page = await browser.newPage();
  const uploadBodies = [];

  try {
    await openMarkdownEditor(page, markdown, (body) => {
      uploadBodies.push(body);
    });

    const saveButton = page.getByRole('button', { name: 'Save' });
    const publicationStart = performance.now();

    for (let index = 0; index < BURST_EDIT_COUNT; index += 1) {
      await page.keyboard.press('Shift+Enter');
      await page.keyboard.type(`x${index}`);
    }

    await waitForEnabled(saveButton);
    const publicationLatencyMs = Number((performance.now() - publicationStart).toFixed(2));

    const expectedCanonicalPayload = `A1<br />x0<br />x1<br />x2<br />x3<br />x4<br />x5`;
    const saveStart = performance.now();
    await saveButton.click();
    await waitForUpload(uploadBodies);
    const flushLatencyMs = Number((performance.now() - saveStart).toFixed(2));

    assert.equal(uploadBodies.length, 1, `${label}: expected exactly one upload request`);
    assert.match(uploadBodies[0], new RegExp(expectedCanonicalPayload.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      `${label}: expected canonical <br /> output in saved payload`);

    const sourceModeToggle = page.getByRole('radio', { name: 'Source mode' });
    const sourceModeStart = performance.now();
    await sourceModeToggle.click();
    const sourceEditor = page.locator('.cm-content[role="textbox"]').first();
    await sourceEditor.waitFor();
    const sourceText = await waitForSourceText(sourceEditor, expectedCanonicalPayload);
    const sourceModeLatencyMs = Number((performance.now() - sourceModeStart).toFixed(2));

    assert.ok(sourceText?.includes(expectedCanonicalPayload) ?? false, `${label}: expected canonical source-mode content after save`);

    return {
      label,
      publicationLatencyMs,
      flushLatencyMs,
      sourceModeLatencyMs,
      payloadLength: uploadBodies[0].length,
      thresholds,
    };
  } finally {
    await page.close();
  }
}

function getThresholdFailures(result) {
  const failures = [];

  if (result.publicationLatencyMs > result.thresholds.publicationMs) {
    failures.push(
      `publication latency ${result.publicationLatencyMs}ms exceeded ${result.thresholds.publicationMs}ms`
    );
  }

  if (result.flushLatencyMs > result.thresholds.flushMs) {
    failures.push(`flush latency ${result.flushLatencyMs}ms exceeded ${result.thresholds.flushMs}ms`);
  }

  if (result.sourceModeLatencyMs > result.thresholds.sourceModeMs) {
    failures.push(
      `source-mode latency ${result.sourceModeLatencyMs}ms exceeded ${result.thresholds.sourceModeMs}ms`
    );
  }

  return failures;
}

async function runProof() {
  const browser = await chromium.launch({ headless: true });

  try {
    const results = [];
    results.push(
      await runScenario(browser, 'small fixture burst publication', smallMarkdown, {
        publicationMs: SMALL_PUBLICATION_THRESHOLD_MS,
        flushMs: SMALL_FLUSH_THRESHOLD_MS,
        sourceModeMs: SMALL_SOURCE_MODE_THRESHOLD_MS,
      })
    );
    results.push(
      await runScenario(browser, 'large fixture burst publication', largeMarkdown, {
        publicationMs: LARGE_PUBLICATION_THRESHOLD_MS,
        flushMs: LARGE_FLUSH_THRESHOLD_MS,
        sourceModeMs: LARGE_SOURCE_MODE_THRESHOLD_MS,
      })
    );

    for (const result of results) {
      console.log(
        `  ${result.label}: publication=${result.publicationLatencyMs}ms flush=${result.flushLatencyMs}ms sourceMode=${result.sourceModeLatencyMs}ms payloadLength=${result.payloadLength}`
      );
    }

    const failures = results.flatMap((result) =>
      getThresholdFailures(result).map((message) => `${result.label}: ${message}`)
    );

    if (failures.length > 0) {
      throw new Error(failures.join('\n'));
    }

    console.log('PASS: markdown table-cell performance proof');
  } finally {
    await browser.close();
  }
}

runProof().catch((error) => {
  console.error('Performance proof failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
