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

test('completed Chapter 2 workshop tracks are read-only and closed cycles are reused for review', async () => {
  const { readFileSync } = await import('node:fs');
  const { stripTypeScriptTypes } = await import('node:module');
  const { runInNewContext } = await import('node:vm');
  const source = readFileSync(new URL('../../supabase/functions/unified-workshop/index.ts', import.meta.url), 'utf8');
  const helpers = source.slice(source.indexOf('async function ensureCycle('), source.indexOf('function cycleAllows('));
  class WorkshopContractError extends Error {
    constructor(status, code) {
      super(code);
      this.status = status;
      this.code = code;
    }
  }
  const { ensureCycle, interactiveTrackComplete, requireOpenChapter2 } = runInNewContext(
    stripTypeScriptTypes(helpers) + '\n({ensureCycle, interactiveTrackComplete, requireOpenChapter2})',
    { WorkshopContractError },
  );
  const trace = [];
  const closed = { id: 'saved-cycle', status: 'submitted' };
  const transaction = async (query, ...args) => {
    const statement = query.join('?');
    trace.push(statement);
    if (statement.includes('from private.workshop_cycles')) {
      assert.equal(args[2], true);
      return [closed];
    }
    return [];
  };
  assert.equal(await ensureCycle(transaction, 'workshop', 'student', true), closed);
  assert.equal(trace.some(statement => statement.includes('insert into private.workshop_cycles')), false);

  const readOnly = error => error.status === 409 && error.code === 'workshop_read_only';
  assert.throws(() => requireOpenChapter2(true, closed), readOnly);
  assert.throws(() => requireOpenChapter2(true, { status: 'open' }, true), readOnly);
  assert.doesNotThrow(() => requireOpenChapter2(true, { status: 'open' }, false));
  assert.doesNotThrow(() => requireOpenChapter2(false, { status: 'open' }, true));
  assert.equal(await interactiveTrackComplete(async () => [{ complete: false }], 'cycle', 'track'), false);
  assert.equal(await interactiveTrackComplete(async () => [{ complete: true }], 'cycle', 'track'), true);
});
