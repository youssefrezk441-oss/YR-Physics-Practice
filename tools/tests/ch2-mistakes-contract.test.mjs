import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = file => readFileSync(new URL(file, root), 'utf8');
const migration = read('supabase/migrations/20261028120000_ch2_mistake_workshop.sql');
const endpoint = read('supabase/functions/student-ch2-mistakes/index.ts');
const page = read('student-ch2-mistakes.html');
const client = read('student-ch2-mistakes.js');

test('second-term storage is additive, isolated and append-only', () => {
  assert.doesNotMatch(migration, /\b(?:public|private)\.ch1[_a-z0-9]*/i);
  assert.doesNotMatch(migration, /\b(?:delete\s+from|truncate|update\s+(?:public|private)\.)/i);
  assert.match(migration, /definition\.academic_term = 'second'/);
  assert.match(migration, /event\.attempt_no = 1\s+and event\.is_correct = false/);
  assert.match(migration, /answer\.is_correct = false/);
  assert.match(migration, /before update or delete[\s\S]*private\.reject_history_mutation\(\)/);
  assert.match(migration, /revoke all on private\.ch2_mistake_review_events from public, anon, authenticated/);
  assert.match(migration, /join private\.ch2_mistake_source_policies policy[\s\S]*policy\.enabled/);
  assert.match(migration, /foreign key \(workshop_id, version_id\)[\s\S]*workshop_versions\(workshop_id, id\)/);
  assert.match(migration, /foreign key \(part_id, key_version_id\)[\s\S]*workshop_part_key_versions\(part_id, id\)/);
});

test('student endpoint authenticates and scopes every source to term and group', () => {
  assert.match(endpoint, /auth\.getUser\(/);
  assert.match(endpoint, /app_metadata\?\.role !== "student"/);
  assert.doesNotMatch(endpoint, /body\??\.user_id|body\[\s*["']user_id/);
  assert.match(endpoint, /definition\.academic_term = 'second'/);
  assert.match(endpoint, /jsonb_array_length\(evidence\.eligible_group_codes\) = 0/);
  assert.match(endpoint, /evidence\.eligible_group_codes \? \$\{groupCode\}/);
  assert.match(endpoint, /private\.ch2_verified_mistake_evidence/);
  assert.match(endpoint, /private\.current_workshop_part_keys/);
  assert.match(endpoint, /gradeWorkshopAnswer\(/);
});

test('public list projection and browser page contain no grading secrets', () => {
  const projection = endpoint.slice(endpoint.indexOf('function publicQuestion'), endpoint.indexOf('function filtersFrom'));
  for (const forbidden of ['answer_spec', 'display_answer', 'feedback_hint', 'explanation', 'key_version_id', 'public_config']) {
    assert.doesNotMatch(projection, new RegExp(forbidden), `${forbidden} must not be in the student list projection`);
    assert.doesNotMatch(client, new RegExp(forbidden), `${forbidden} must not be expected by the browser`);
  }
  assert.match(page, /غير مكتمل — ليس خطأ/);
  assert.match(page, /الإتقان لا يُسجل إلا بعد إجابة صحيحة في محاولة مستقلة جديدة/);
  assert.match(client, /kind==='incomplete'/);
  assert.match(client, /attempt_mastery/);
  assert.match(client, /mark_reviewed/);
});
