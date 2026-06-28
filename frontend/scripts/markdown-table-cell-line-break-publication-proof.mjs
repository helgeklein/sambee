import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = process.env.SAMBEE_FRONTEND_BASE_URL ?? 'http://localhost:3000';
const demoConnectionId = '85610f49-ab40-4d96-8750-ddab3e8e8764';
const demoPath = 'note.md';
const tableCellNavigationMarkdown = 'alpha\n\n| Col 1 | Col 2 |\n| --- | --- |\n| A1 | B1 |\n| A2 | B2 |\n\nomega\n';
const MARKDOWN_DEBUG_SESSION_STORAGE_KEY = 'sambee:markdown-debug';
const MARKDOWN_DEBUG_PREFIX = '[sambee-markdown-debug]';

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

async function selectionRemainsWithin(cellLocator) {
  return cellLocator.evaluate((element) => {
    const selection = window.getSelection();
    return Boolean(selection?.anchorNode && element.contains(selection.anchorNode));
  });
}

async function openMarkdownEditor(page, onUploadBody) {
  await page.addInitScript((storageKey) => {
    window.sessionStorage.setItem(storageKey, '1');
  }, MARKDOWN_DEBUG_SESSION_STORAGE_KEY);
  await mockMarkdownViewerApi(page, tableCellNavigationMarkdown, { onUploadBody });
  await page.goto(`${baseUrl}/browse/smb/demo`);
  await page.getByRole('button', { name: `File: ${demoPath}` }).click();
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('textbox', { name: 'Markdown editor' }).waitFor();

  const targetCell = page.locator('table').getByRole('textbox').nth(2);
  await targetCell.waitFor();
  await setCaretToCellBoundary(targetCell, 'end');
  return targetCell;
}

function createPageErrorRecorder(page) {
  const pageErrors = [];
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });
  return pageErrors;
}

function createDebugTraceRecorder(page) {
  const debugLogs = [];
  page.on('console', (message) => {
    const text = message.text();

    if (text.includes(MARKDOWN_DEBUG_PREFIX)) {
      debugLogs.push(text);
    }
  });
  return debugLogs;
}

function formatDebugTrace(debugLogs) {
  if (debugLogs.length === 0) {
    return 'No markdown debug trace captured.';
  }

  return debugLogs.slice(-60).join('\n');
}

function assertNoPageErrors(pageErrors, context) {
  assert.equal(pageErrors.length, 0, `Expected no page errors ${context}, received: ${pageErrors.join(' | ')}`);
}

async function listButtonNames(page) {
  return page.getByRole('button').evaluateAll((buttons) =>
    buttons
      .map((button) => {
        if (!(button instanceof HTMLElement)) {
          return '';
        }

        const ariaLabel = button.getAttribute('aria-label')?.trim();
        const text = button.textContent?.trim();
        return ariaLabel || text || '';
      })
      .filter(Boolean)
  );
}

async function getSaveButtonState(page) {
  const saveButton = page.getByRole('button', { name: 'Save' });

  return {
    visible: await saveButton.isVisible().catch(() => false),
    disabled: await saveButton.isDisabled().catch(() => false),
  };
}

async function getAlertText(page) {
  const alerts = page.getByRole('alert');
  const count = await alerts.count();

  if (count === 0) {
    return null;
  }

  return (await alerts.first().textContent())?.trim() ?? '';
}

async function waitForTrailingOutcome(page, pageErrors, uploadBodies, successLocator) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (pageErrors.length > 0) {
      return {
        kind: 'pageerror',
        detail: pageErrors.join(' | '),
      };
    }

    if (uploadBodies.length > 0) {
      return {
        kind: 'upload',
        detail: uploadBodies[0],
      };
    }

    const alertText = await getAlertText(page);
    if (alertText) {
      return {
        kind: 'alert',
        detail: alertText,
      };
    }

    if (successLocator) {
      const successVisible = await successLocator.isVisible().catch(() => false);
      if (successVisible) {
        return {
          kind: 'success',
          detail: 'success locator became visible',
        };
      }
    }

    await page.waitForTimeout(100);
  }

  return {
    kind: 'timeout',
    detail: `buttons=${JSON.stringify(await listButtonNames(page))};save=${JSON.stringify(await getSaveButtonState(page))}`,
  };
}

async function runProofCase(browser, label, execute) {
  const page = await browser.newPage();
  const debugLogs = createDebugTraceRecorder(page);

  try {
    await execute(page);
    return { label, passed: true };
  } catch (error) {
    return {
      label,
      passed: false,
      error: `${error instanceof Error ? error.message : String(error)}\nTrace:\n${formatDebugTrace(debugLogs)}`,
    };
  } finally {
    await page.close();
  }
}

async function runProof() {
  const browser = await chromium.launch({ headless: true });

  try {
    const results = [];

    results.push(
      await runProofCase(browser, 'continued typing followed by save publishes canonical <br /> output', async (page) => {
        const uploadBodies = [];
        const pageErrors = createPageErrorRecorder(page);
        const targetCell = await openMarkdownEditor(page, (body) => {
          uploadBodies.push(body);
        });

        await page.keyboard.press('Shift+Enter');
        const focusRetainedAfterBreak = await selectionRemainsWithin(targetCell);
        assertNoPageErrors(pageErrors, 'immediately after Shift+Enter');

        await page.keyboard.type('bar');
        const focusRetainedAfterTyping = await selectionRemainsWithin(targetCell);
        assertNoPageErrors(pageErrors, 'after continued typing');

        const saveButton = page.getByRole('button', { name: 'Save' });
        await saveButton.click();
        await page.waitForLoadState('networkidle');

        assertNoPageErrors(pageErrors, 'after save');
        assert.equal(focusRetainedAfterBreak, true, 'Expected selection to remain within the edited table cell immediately after Shift+Enter');
        assert.equal(focusRetainedAfterTyping, true, 'Expected selection to remain within the edited table cell after continued typing');
        assert.equal(uploadBodies.length, 1, `Expected exactly one upload request, received ${uploadBodies.length}`);
        assert.match(uploadBodies[0], /A1<br\s*\/>bar/, 'Expected the saved payload to contain canonical <br /> output for the edited cell');
        assert.doesNotMatch(uploadBodies[0], /A1&#10;bar/, 'Did not expect the saved payload to contain numeric newline entities for the edited cell');
      })
    );

    results.push(
      await runProofCase(browser, 'immediate save after a trailing Shift+Enter is safe and strips the trailing break', async (page) => {
        const uploadBodies = [];
        const pageErrors = createPageErrorRecorder(page);
        const targetCell = await openMarkdownEditor(page, (body) => {
          uploadBodies.push(body);
        });

        await page.keyboard.press('Shift+Enter');
        const focusRetainedAfterBreak = await selectionRemainsWithin(targetCell);
        assertNoPageErrors(pageErrors, 'immediately after Shift+Enter');

        const saveButton = page.getByRole('button', { name: 'Save' });
        await saveButton.waitFor();
        await saveButton.click();
        const outcome = await waitForTrailingOutcome(page, pageErrors, uploadBodies, null);

        assertNoPageErrors(pageErrors, 'after save');
        assert.equal(focusRetainedAfterBreak, true, 'Expected selection to remain within the edited table cell immediately after Shift+Enter');
        assert.equal(outcome.kind, 'upload', `Expected save to reach upload or a clear fail-closed path, received ${outcome.kind}: ${outcome.detail}`);
        assert.equal(uploadBodies.length, 1, `Expected exactly one upload request, received ${uploadBodies.length}`);
        assert.doesNotMatch(uploadBodies[0], /A1<br\s*\/>/, 'Did not expect a transient trailing break to be persisted');
      })
    );

    results.push(
      await runProofCase(browser, 'Ctrl+S after a trailing Shift+Enter reaches the same save completion boundary', async (page) => {
        const uploadBodies = [];
        const pageErrors = createPageErrorRecorder(page);
        const targetCell = await openMarkdownEditor(page, (body) => {
          uploadBodies.push(body);
        });

        await page.keyboard.press('Shift+Enter');
        const focusRetainedAfterBreak = await selectionRemainsWithin(targetCell);
        assertNoPageErrors(pageErrors, 'immediately after Shift+Enter');

        await page.keyboard.press('Control+S');
        const outcome = await waitForTrailingOutcome(page, pageErrors, uploadBodies, null);

        assertNoPageErrors(pageErrors, 'after Ctrl+S save request');
        assert.equal(focusRetainedAfterBreak, true, 'Expected selection to remain within the edited table cell immediately after Shift+Enter');
        assert.equal(
          outcome.kind,
          'upload',
          `Expected Ctrl+S save to reach upload or a clear fail-closed path, received ${outcome.kind}: ${outcome.detail}`
        );
        assert.equal(uploadBodies.length, 1, `Expected exactly one upload request, received ${uploadBodies.length}`);
        assert.doesNotMatch(uploadBodies[0], /A1<br\s*\/>/, 'Did not expect a transient trailing break to be persisted after Ctrl+S save');
      })
    );

    results.push(
      await runProofCase(browser, 'source-mode flush after a trailing Shift+Enter is safe and exposes canonical source content', async (page) => {
        const pageErrors = createPageErrorRecorder(page);
        await openMarkdownEditor(page, () => {});

        await page.keyboard.press('Shift+Enter');
        assertNoPageErrors(pageErrors, 'immediately after Shift+Enter');

        const sourceEditor = page.locator('.cm-content[role="textbox"]').first();
        // MDXEditor exposes the mode switch as a radio-style toggle item, not a plain button.
        const sourceModeButton = page.getByRole('radio', { name: 'Source mode' });
        const sourceModeButtonVisible = await sourceModeButton.isVisible().catch(() => false);

        assert.equal(
          sourceModeButtonVisible,
          true,
          `Expected Source mode button to remain reachable after trailing Shift+Enter. Visible buttons: ${JSON.stringify(await listButtonNames(page))}`
        );

        await sourceModeButton.click();
        const outcome = await waitForTrailingOutcome(page, pageErrors, [], sourceEditor);

        assert.equal(
          outcome.kind,
          'success',
          `Expected source-mode transition to complete or fail cleanly after trailing Shift+Enter, received ${outcome.kind}: ${outcome.detail}`
        );

        await sourceEditor.waitFor();
        const sourceText = await sourceEditor.textContent();

        assertNoPageErrors(pageErrors, 'after switching to source mode');
        assert.ok(sourceText?.includes('A1') ?? false, 'Expected the source editor to contain the edited cell content');
        assert.doesNotMatch(sourceText ?? '', /A1<br\s*\/>/, 'Did not expect a transient trailing break to survive source-mode canonicalization');
      })
    );

    const failedResults = results.filter((result) => !result.passed);

    for (const result of results) {
      console.log(`${result.passed ? 'PASS' : 'FAIL'}: ${result.label}`);
      if (!result.passed) {
        console.log(`  ${result.error}`);
      }
    }

    assert.equal(failedResults.length, 0, `Expected all proof cases to pass, but ${failedResults.length} failed.`);
  } finally {
    await browser.close();
  }
}

runProof().catch((error) => {
  console.error('Proof 2A failed.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
