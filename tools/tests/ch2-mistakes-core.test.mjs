import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyCh2MistakeStatus,
  filterCh2MistakeItems,
  isVerifiedCh2MistakeEvidence,
  summarizeCh2Mistakes,
  validateCh2MistakeRef,
} from '../../supabase/functions/_shared/ch2-mistakes-core.ts';

const attemptId = '4e9b6a31-0f91-4b54-a524-6a0676ebd15a';
const submissionId = 'a0a454ff-09f9-45f9-b0a8-d379f4ad8e53';
const partId = '9a5e86ce-f2a9-45e0-ad94-c4d6ba6ab2a1';

test('accepts only stable mistake references', () => {
  assert.equal(validateCh2MistakeRef(`attempt:${attemptId}`), `attempt:${attemptId}`);
  assert.equal(validateCh2MistakeRef(`submission:${submissionId}:${partId}`), `submission:${submissionId}:${partId}`);
  assert.throws(() => validateCh2MistakeRef('attempt:not-a-uuid'), /invalid_mistake_ref/);
});

test('does not invent a mistake from incomplete or missing evidence', () => {
  assert.equal(isVerifiedCh2MistakeEvidence({ source_kind: 'interactive_first_attempt', source_ref: attemptId, attempt_no: 1, is_correct: false }), true);
  assert.equal(isVerifiedCh2MistakeEvidence({ source_kind: 'interactive_first_attempt', source_ref: attemptId, attempt_no: 0, is_correct: false }), false);
  assert.equal(isVerifiedCh2MistakeEvidence({ source_kind: 'interactive_first_attempt', source_ref: attemptId, attempt_no: 1, is_correct: null }), false);
  assert.equal(isVerifiedCh2MistakeEvidence({ source_kind: 'final_submission_wrong', source_ref: submissionId, is_correct: false, submitted: true }), true);
  assert.equal(isVerifiedCh2MistakeEvidence({ source_kind: 'final_submission_wrong', source_ref: submissionId, is_correct: false, submitted: false }), false);
});

test('review alone never becomes mastery', () => {
  assert.equal(classifyCh2MistakeStatus({}), 'needs_review');
  assert.equal(classifyCh2MistakeStatus({ reviewed_at: '2026-10-28T10:00:00Z' }), 'reviewed');
  assert.equal(classifyCh2MistakeStatus({ reviewed_at: '2026-10-28T10:00:00Z', mastery_attempts: [{ is_correct: false }] }), 'reviewed');
  assert.equal(classifyCh2MistakeStatus({ mastery_attempts: [{ is_correct: false }, { is_correct: true }] }), 'mastered');
});

test('filters by lecture, track, skill and mastery state', () => {
  const items = [
    { lecture_no: 1, track_key: 'class', skill_ref: 'MAG-001', status: 'needs_review' },
    { lecture_no: 1, track_key: 'home', skill_ref: 'MAG-002', status: 'mastered' },
    { lecture_no: 2, track_key: 'class', skill_ref: 'MAG-001', status: 'incomplete' },
  ];
  assert.equal(filterCh2MistakeItems(items, { lecture_no: 1 }).length, 2);
  assert.equal(filterCh2MistakeItems(items, { track_key: 'home', status: 'mastered' }).length, 1);
  assert.equal(filterCh2MistakeItems(items, { skill_ref: 'MAG-001', status: 'incomplete' }).length, 1);
  assert.deepEqual(summarizeCh2Mistakes(items), { total_mistakes: 2, needs_review: 1, reviewed: 0, mastered: 1, incomplete: 1 });
});
