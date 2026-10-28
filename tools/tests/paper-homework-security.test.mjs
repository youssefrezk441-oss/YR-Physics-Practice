import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const migration = readFileSync(new URL('supabase/migrations/20261028150000_paper_homework_system.sql', root), 'utf8');
const api = readFileSync(new URL('supabase/functions/paper-homework/index.ts', root), 'utf8');
const mistakes = readFileSync(new URL('supabase/functions/student-ch2-mistakes/index.ts', root), 'utf8');

test('homework history is immutable and unanswered is nullable, not wrong', () => {
  assert.match(migration, /submitted homework attempt is immutable/);
  assert.match(migration, /reject_homework_history_mutation/);
  assert.match(migration, /answer_state = 'unanswered' and is_correct is null/);
  assert.match(migration, /answer\.answer_state = 'answered' and answer\.is_correct = false/);
});

test('student endpoint gates keys behind immutable submission', () => {
  const firstKeyProjection = api.indexOf('key.display_answer');
  const submissionLoader = api.indexOf('async function submissionResult');
  assert.ok(firstKeyProjection > submissionLoader);
  assert.match(api, /attempt\.status === "submitted" \? await submissionResult/);
  assert.match(api, /pg_advisory_xact_lock/);
  assert.match(api, /homework_mutation_receipts/);
});

test('essay mastery stores a new answer before revealing a solution and is self-reviewed', () => {
  const insert = mistakes.indexOf('insert into private.ch2_essay_mastery_retries');
  const reveal = mistakes.indexOf('model_answer: key.display_answer');
  assert.ok(insert > 0 && reveal > insert);
  assert.match(mistakes, /essay_requires_self_review/);
  assert.match(mistakes, /mastery_kind: "essay_self_review"/);
});
