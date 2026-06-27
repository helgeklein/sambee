import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = process.env.SAMBEE_FRONTEND_BASE_URL ?? 'http://localhost:3000';
const harnessUrl = `${baseUrl}/mdxeditor-table-cell-harness.html`;

async function moveCaretToLoadedEmptyLine(page) {
  const targetCell = page.locator('table').getByRole('textbox').nth(2);
  await targetCell.waitFor();
  await targetCell.click();
  await targetCell.evaluate((element) => {
    const selection = window.getSelection();

    if (!selection) {
      throw new Error('Expected DOM selection');
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

    if (element instanceof HTMLElement) {
      element.focus();
    }
  });
}

async function readHarnessState(page) {
  return page.evaluate(() => {
    return window.__MDX_TABLE_CELL_HARNESS__?.getState() ?? null;
  });
}

async function clearHarnessLog(page) {
  await page.evaluate(() => {
    window.__MDX_TABLE_CELL_HARNESS__?.clearLog();
  });
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

try {
  await page.goto(harnessUrl);
  await page.getByRole('heading', { name: 'MDXEditor Table Cell Harness' }).waitFor();

  await clearHarnessLog(page);
  await moveCaretToLoadedEmptyLine(page);
  await page.keyboard.type('s');
  await page.keyboard.press('Tab');

  const harnessState = await readHarnessState(page);

  assert.ok(harnessState, 'Expected harness state to be available');

  const controlledInsertionEntry = harnessState.log.find((entry) => entry.reason === 'controlled-text-insertion');
  const beforeInputEntry = harnessState.log.find((entry) => entry.reason === 'beforeinput');

  console.log(JSON.stringify({
    harnessUrl,
    latestMarkdown: harnessState.latestMarkdown,
    controlledInsertionEntry,
    beforeInputEntry,
    logLength: harnessState.log.length,
  }, null, 2));
} finally {
  await page.close();
  await browser.close();
}
