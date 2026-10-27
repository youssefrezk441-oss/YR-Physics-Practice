import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyWorkshopOutcome,
  deriveInteractiveProgressAfterRegrade,
  decideInteractiveAttempt,
  gradeWorkshopAnswer,
  normalizeLetter,
  parseStrictNumber,
  previewWorkshopRegrade,
  summarizeWorkshopProgress,
  validateExpectedRevision,
  validateRequestId,
  WorkshopContractError,
} from '../../supabase/functions/_shared/unified-workshop-core.ts';

const emptyProgress = () => ({
  revision: 0,
  attempts_count: 0,
  tried_answers: [],
  first_attempt_correct: null,
  independently_mastered: false,
  assisted: false,
  revealed: false,
});
const policy = { max_unique_attempts: 3, reveal_after_attempts: 2, auto_reveal_mcq: true };

test('normalizes Arabic and Latin MCQ labels without accepting arbitrary choices', () => {
  assert.equal(normalizeLetter('a'), 'أ');
  assert.equal(normalizeLetter('٢'), 'ب');
  assert.deepEqual(gradeWorkshopAnswer('mcq', { option: 'ج' }, '3'), { correct: true, normalized: 'ج' });
  assert.throws(() => gradeWorkshopAnswer('mcq', { option: 'ج' }, 'هـ'), WorkshopContractError);
});

test('grades decimal, Arabic-digit and fractional numeric answers with tolerance', () => {
  assert.equal(parseStrictNumber('١٥٫٥'), 15.5);
  assert.equal(parseStrictNumber('46/3'), 46 / 3);
  assert.equal(gradeWorkshopAnswer('numeric', { value: 2.5, tolerance_abs: 0.01 }, '2.506').correct, true);
  assert.equal(gradeWorkshopAnswer('numeric', { value: 2.5, tolerance_abs: 0.01 }, '2.52').correct, false);
});

test('preserves the first wrong attempt when a later attempt is independently correct', () => {
  const first = decideInteractiveAttempt({
    progress: emptyProgress(), policy, expectedRevision: 0, normalized: 'ب', correct: false, inputType: 'mcq', optionCount: 4,
  });
  assert.equal(first.kind, 'incorrect');
  const second = decideInteractiveAttempt({
    progress: first.progress, policy, expectedRevision: 1, normalized: 'أ', correct: true, inputType: 'mcq', optionCount: 4,
  });
  assert.equal(second.kind, 'mastered');
  assert.equal(second.progress.first_attempt_correct, false);
  assert.equal(classifyWorkshopOutcome(second.progress), 'later_independent');
});

test('does not count duplicate or stale requests as new attempts', () => {
  const first = decideInteractiveAttempt({
    progress: emptyProgress(), policy, expectedRevision: 0, normalized: 'ب', correct: false, inputType: 'mcq', optionCount: 4,
  });
  const duplicate = decideInteractiveAttempt({
    progress: first.progress, policy, expectedRevision: 1, normalized: 'ب', correct: false, inputType: 'mcq', optionCount: 4,
  });
  const stale = decideInteractiveAttempt({
    progress: first.progress, policy, expectedRevision: 0, normalized: 'ج', correct: false, inputType: 'mcq', optionCount: 4,
  });
  assert.equal(duplicate.kind, 'duplicate');
  assert.equal(stale.kind, 'stale');
  assert.equal(duplicate.progress.attempts_count, 1);
  assert.equal(stale.progress.attempts_count, 1);
});

test('classifies automatic MCQ exhaustion as assisted rather than mastery', () => {
  let progress = emptyProgress();
  for (const [index, answer] of ['أ', 'ب', 'ج'].entries()) {
    const result = decideInteractiveAttempt({
      progress, policy, expectedRevision: index, normalized: answer, correct: false, inputType: 'mcq', optionCount: 4,
    });
    progress = result.progress;
  }
  assert.equal(progress.revealed, true);
  assert.equal(progress.independently_mastered, false);
  assert.equal(classifyWorkshopOutcome(progress), 'assisted');
});

test('requires UUIDv4 idempotency keys and integer optimistic revisions', () => {
  assert.equal(validateRequestId('123e4567-e89b-42d3-a456-426614174000'), '123e4567-e89b-42d3-a456-426614174000');
  assert.equal(validateExpectedRevision(0), 0);
  assert.throws(() => validateRequestId('not-a-request-id'), WorkshopContractError);
  assert.throws(() => validateExpectedRevision('0'), WorkshopContractError);
});

test('analytics exclude non-starters from first-attempt accuracy and separate assistance', () => {
  const rows = [
    emptyProgress(),
    { ...emptyProgress(), attempts_count: 1, first_attempt_correct: true, independently_mastered: true },
    { ...emptyProgress(), attempts_count: 2, first_attempt_correct: false, independently_mastered: true },
    { ...emptyProgress(), attempts_count: 2, first_attempt_correct: false, assisted: true, revealed: true },
  ];
  assert.deepEqual(summarizeWorkshopProgress(rows), {
    attempted: 3,
    firstTry: 1,
    laterIndependent: 1,
    independent: 2,
    assisted: 1,
    firstAttemptRate: 33.3,
    independentMasteryRate: 66.7,
    assistedRate: 33.3,
  });
});

test('regrade preview handles wrong-to-right and right-to-wrong without changing answers', () => {
  const decisions = [
    { id: 'one', user_id: 'student-a', answer_snapshot: { raw: 'ب' }, is_correct: false, awarded_points: 0, max_points: 1 },
    { id: 'two', user_id: 'student-b', answer_snapshot: { raw: 'أ' }, is_correct: true, awarded_points: 2, max_points: 2 },
  ];
  const result = previewWorkshopRegrade('mcq', { option: 'ب' }, decisions);
  assert.deepEqual(result.summary, {
    affected_responses: 2,
    affected_students: 2,
    increases: 1,
    decreases: 1,
    total_score_delta: -1,
  });
  assert.equal(decisions[0].answer_snapshot.raw, 'ب');
  assert.equal(decisions[1].answer_snapshot.raw, 'أ');
});

test('regrade keeps reveal as assistance unless the original pre-reveal answer becomes correct', () => {
  const attempts = [
    { is_correct: false, server_received_at: '2026-10-24T10:00:00Z' },
    { is_correct: false, server_received_at: '2026-10-24T10:01:00Z' },
  ];
  assert.deepEqual(deriveInteractiveProgressAfterRegrade(attempts, '2026-10-24T10:02:00Z'), {
    first_attempt_correct: false, independently_mastered: false, assisted: true, revealed: true,
  });
  attempts[0].is_correct = true;
  assert.deepEqual(deriveInteractiveProgressAfterRegrade(attempts, '2026-10-24T10:02:00Z'), {
    first_attempt_correct: true, independently_mastered: true, assisted: false, revealed: false,
  });
});
