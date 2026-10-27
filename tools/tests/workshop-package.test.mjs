import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parseCsv } from '../import_workshop_package.mjs';

test('CSV parser preserves quoted commas and escaped quotes in Arabic source records', () => {
  const rows = parseCsv('\uFEFFالمعرف,النص,الملاحظة\r\nQ1,"قيمة، ومعها فاصلة","قال ""راجع"""\r\n');
  assert.deepEqual(rows, [{ المعرف: 'Q1', النص: 'قيمة، ومعها فاصلة', الملاحظة: 'قال "راجع"' }]);
});

test('checked-in L1 public manifest contains no teacher answer fields', () => {
  const manifest = JSON.parse(readFileSync('workshops/third-secondary-term-2-lecture-1/public-content.json', 'utf8'));
  const serialized = JSON.stringify(manifest);
  for (const forbidden of ['"correct"', '"reason"', '"hint"', '"answer_spec"', '"display_answer"', '"source_answer"']) {
    assert.equal(serialized.includes(forbidden), false, `public manifest leaked ${forbidden}`);
  }
  assert.equal(manifest.questions.length, 36);
  assert.equal(manifest.questions.filter((question) => question.track === 'class').length, 18);
  assert.equal(manifest.questions.filter((question) => question.track === 'home').length, 18);
});
