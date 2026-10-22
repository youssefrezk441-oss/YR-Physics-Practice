import assert from 'node:assert/strict';
import test from 'node:test';
import { assertRegradeApproval, summarizeRegradeImpact } from '../../supabase/functions/_shared/regrade-impact.ts';

const synthetic = Object.freeze([
  Object.freeze({ attemptRef: 'attempt-a', responseRef: 'response-a1', studentUserId: 'student-a', previousPoints: 1, proposedPoints: 2, maxPoints: 2 }),
  Object.freeze({ attemptRef: 'attempt-a', responseRef: 'response-a2', studentUserId: 'student-a', previousPoints: 2, proposedPoints: 2, maxPoints: 2 }),
  Object.freeze({ attemptRef: 'attempt-b', responseRef: 'response-b1', studentUserId: 'student-b', previousPoints: 2, proposedPoints: 1.5, maxPoints: 2 }),
]);

test('builds a deterministic impact summary without mutating historical inputs', () => {
  const before = JSON.stringify(synthetic);
  const summary = summarizeRegradeImpact(synthetic);
  assert.deepEqual(summary, {
    affectedResponses: 2,
    affectedAttempts: 2,
    affectedStudents: 2,
    increases: 1,
    decreases: 1,
    unchanged: 1,
    totalScoreDelta: 0.5,
  });
  assert.equal(JSON.stringify(synthetic), before);
});

test('rejects duplicate responses and scores outside the question maximum', () => {
  assert.throws(() => summarizeRegradeImpact([synthetic[0], synthetic[0]]), /Duplicate response/);
  assert.throws(() => summarizeRegradeImpact([
    { attemptRef: 'a', responseRef: 'r', previousPoints: 3, proposedPoints: 2, maxPoints: 2 },
  ]), /Invalid score bounds/);
});

test('requires a matching, unexpired two-person approval', () => {
  const summary = summarizeRegradeImpact(synthetic);
  const preview = { id: 'preview-1', createdBy: 'admin-a', expiresAt: '2030-01-02T00:00:00Z', summary };
  assert.doesNotThrow(() => assertRegradeApproval(preview, {
    previewId: 'preview-1', approvedBy: 'admin-b',
    expectedAffectedAttempts: 2, expectedTotalScoreDelta: 0.5,
  }, new Date('2030-01-01T00:00:00Z')));
  assert.throws(() => assertRegradeApproval(preview, {
    previewId: 'preview-1', approvedBy: 'admin-a',
    expectedAffectedAttempts: 2, expectedTotalScoreDelta: 0.5,
  }, new Date('2030-01-01T00:00:00Z')), /second administrator/);
  assert.throws(() => assertRegradeApproval(preview, {
    previewId: 'preview-1', approvedBy: 'admin-b',
    expectedAffectedAttempts: 2, expectedTotalScoreDelta: 0.5,
  }, new Date('2030-01-03T00:00:00Z')), /expired/);
});
