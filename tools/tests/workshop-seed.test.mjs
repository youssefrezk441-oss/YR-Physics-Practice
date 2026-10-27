import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { renderWorkshopSeed } from '../render_workshop_seed_sql.mjs';

const publicManifest = {
  workshop: { slug: 'synthetic-workshop', status: 'draft' },
  tracks: [], skills: [], questions: [],
};
const contentHash = createHash('sha256').update(JSON.stringify(publicManifest)).digest('hex');
const privateImport = { workshop_slug: 'synthetic-workshop', public_content_sha256: contentHash, keys: [] };
const report = { ok: true, issues: [], warnings: [] };

test('private seed stays draft and refuses to overwrite an existing workshop', () => {
  const sql = renderWorkshopSeed(publicManifest, privateImport, report);
  assert.match(sql, /status\)\s*\n`?\s*values/u);
  assert.match(sql, /'draft'/);
  assert.match(sql, /import is intentionally non-overwriting/);
  assert.doesNotMatch(sql, /status\s*=\s*'published'/i);
  assert.doesNotMatch(sql, /delete\s+from|truncate/i);
});

test('private seed rejects mismatched public content', () => {
  assert.throws(() => renderWorkshopSeed({ ...publicManifest, questions: [{ id: 'changed' }] }, privateImport, report), /hash differs/);
});
