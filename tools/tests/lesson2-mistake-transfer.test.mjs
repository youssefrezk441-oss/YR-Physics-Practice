import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  isVerifiedCh2MistakeEvidence,
  validateCh2MistakeRef,
  classifyCh2MistakeStatus,
} from '../../supabase/functions/_shared/ch2-mistakes-core.ts';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const page = read('../../lesson2-book-homework.html');
const studentMistakes = read('../../student-ch2-mistakes.js');
const mistakesEndpoint = read('../../supabase/functions/student-ch2-mistakes/index.ts');
const homeworkEndpoint = read('../../supabase/functions/paper-homework/index.ts');
const uuid = '4e9b6a31-0f91-4b54-a524-6a0676ebd15a';

test('lesson-two submitted results expose the existing personal mistake workshop', () => {
  assert.match(page, /id="results"/);
  assert.match(page, /student-ch2-mistakes\.html\?lecture=2&amp;status=mistakes/);
  assert.match(page, /إجابات الاختيار الخاطئة تنتقل/);
  assert.match(page, /«خطأ» أو «جزئي»/);
  assert.match(page, /السؤال الذي لم تحله لا يُحسب خطأ/);
});

test('mistake workshop deep-link is filtered to lesson two and preserves working source links', () => {
  assert.match(studentMistakes, /new URLSearchParams\(location\.search\)/);
  assert.match(studentMistakes, /\$\('lecture-filter'\)\.value=entryLecture/);
  assert.match(studentMistakes, /\$\('status-filter'\)\.value=entryStatus/);
  assert.match(studentMistakes, /'third-secondary-term-2-lesson-2-book-homework':'\.\/lesson2-book-homework\.html'/);
  assert.match(studentMistakes, /'third-secondary-term-2-lesson-1-book-remaining':'\.\/lesson1-book-remaining\.html'/);
});

test('automatic evidence is derived server-side from immutable submitted history, without client migration', () => {
  assert.match(mistakesEndpoint, /private\.ch2_verified_mistake_evidence/);
  assert.match(mistakesEndpoint, /private\.ch2_paper_homework_mistake_evidence/);
  assert.match(mistakesEndpoint, /union all/);
  assert.match(homeworkEndpoint, /paper_homework/);
  assert.match(mistakesEndpoint, /attempt_mastery/);
  assert.match(mistakesEndpoint, /begin_essay_mastery/);
  assert.match(mistakesEndpoint, /assess_essay_mastery/);
});

test('stable paper homework evidence requires an actual wrong submitted answer', () => {
  assert.equal(validateCh2MistakeRef('homework:' + uuid), 'homework:' + uuid);
  assert.equal(validateCh2MistakeRef('homework-review:' + uuid), 'homework-review:' + uuid);
  const evidence = { source_kind: 'paper_homework_wrong', source_ref: uuid, is_correct: false, submitted: true };
  assert.equal(isVerifiedCh2MistakeEvidence(evidence), true);
  assert.equal(isVerifiedCh2MistakeEvidence({ ...evidence, submitted: false }), false);
  assert.equal(isVerifiedCh2MistakeEvidence({ ...evidence, is_correct: true }), false);
  assert.equal(isVerifiedCh2MistakeEvidence({ ...evidence, is_correct: null }), false);
  assert.equal(classifyCh2MistakeStatus({ reviewed_at: '2026-11-11T00:00:00Z' }), 'reviewed');
  assert.equal(classifyCh2MistakeStatus({ reviewed_at: '2026-11-11T00:00:00Z', mastery_attempts: [{ is_correct: true }] }), 'mastered');
});
