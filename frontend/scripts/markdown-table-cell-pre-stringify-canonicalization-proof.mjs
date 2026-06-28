import assert from 'node:assert/strict';
import { toMarkdown } from 'mdast-util-to-markdown';
import { gfmTableToMarkdown } from 'mdast-util-gfm-table';

function createTableCellMarkdown(children) {
  return toMarkdown(
    {
      type: 'root',
      children: [
        {
          type: 'table',
          align: [null],
          children: [
            { type: 'tableRow', children: [{ type: 'tableCell', children: [{ type: 'text', value: 'A' }] }] },
            { type: 'tableRow', children: [{ type: 'tableCell', children }] },
          ],
        },
      ],
    },
    {
      extensions: [gfmTableToMarkdown()],
      allowDangerousHtml: true,
    }
  );
}

function runProof() {
  const emittedFromRawNewlineText = createTableCellMarkdown([{ type: 'text', value: 'foo\nbar' }]);
  const emittedFromCanonicalBreakNodes = createTableCellMarkdown([
    { type: 'text', value: 'foo' },
    { type: 'html', value: '<br />' },
    { type: 'text', value: 'bar' },
  ]);

  assert.ok(
    emittedFromRawNewlineText.includes('foo&#xA;bar'),
    'mdast text nodes containing raw newlines should stringify to numeric newline character references in GFM tables'
  );

  assert.ok(
    emittedFromCanonicalBreakNodes.includes('foo<br />bar'),
    'mdast html break nodes should stringify to canonical <br /> output in GFM tables'
  );

  assert.ok(
    !emittedFromCanonicalBreakNodes.includes('&#xA;'),
    'canonical break-node output should avoid numeric newline character references'
  );

  console.log('Proof 1B passed. Verified pre-stringify canonicalization facts:');
  console.log('- Raw newline text in table-cell mdast stringifies as numeric newline character references.');
  console.log('- Html break nodes in table-cell mdast stringify as canonical <br /> output.');
  console.log('- Therefore, a pre-stringify mdast transform can enforce canonical <br /> output before raw pipe-table markdown is finalized.');
}

runProof();
