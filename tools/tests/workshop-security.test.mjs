import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_WORKSHOP_REQUEST_BYTES,
  WorkshopRequestError,
  expectedAttempts,
  isStaleProgress,
  readWorkshopJson,
  staleProgressResult,
} from '../../supabase/functions/_shared/workshop-security.ts';

test('accepts a small JSON object', async () => {
  const body = await readWorkshopJson(new Request('https://example.test', {
    method: 'POST',
    body: JSON.stringify({ action: 'attempt', expected_attempts_count: 0 }),
  }));
  assert.equal(body.action, 'attempt');
});

test('rejects arrays, malformed JSON and oversized bodies', async () => {
  await assert.rejects(
    readWorkshopJson(new Request('https://example.test', { method: 'POST', body: '[]' })),
    error => error instanceof WorkshopRequestError && error.status === 400,
  );
  await assert.rejects(
    readWorkshopJson(new Request('https://example.test', { method: 'POST', body: '{' })),
    error => error instanceof WorkshopRequestError && error.code === 'invalid_json',
  );
  await assert.rejects(
    readWorkshopJson(new Request('https://example.test', {
      method: 'POST',
      body: 'x'.repeat(MAX_WORKSHOP_REQUEST_BYTES + 1),
    })),
    error => error instanceof WorkshopRequestError && error.status === 413,
  );
});

test('validates optimistic concurrency versions', () => {
  assert.equal(expectedAttempts(undefined), null);
  assert.equal(expectedAttempts(0), 0);
  assert.equal(expectedAttempts(3), 3);
  assert.throws(() => expectedAttempts('3'), WorkshopRequestError);
  assert.throws(() => expectedAttempts(-1), WorkshopRequestError);
  assert.equal(isStaleProgress(1, 2), true);
  assert.equal(isStaleProgress(2, 2), false);
  assert.equal(isStaleProgress(null, 7), false);
  const result = staleProgressResult({ attempts_count: 2 }, 2);
  assert.equal(result.ok, true);
  assert.equal(result.stale, true);
  assert.equal(result.attempts_count, 2);
});
