import test from 'node:test';
import assert from 'node:assert/strict';
import { gradeHomeworkPart, summarizeHomework, validateHomeworkAnswer, validateSelfAssessment } from '../../supabase/functions/_shared/paper-homework-core.ts';

test('keeps unanswered separate from wrong MCQ evidence', () => {
  const result = gradeHomeworkPart({ responseKind: 'auto_mcq', answerState: 'unanswered', answer: null, answerSpec: { option: 'أ' }, maxPoints: 1 });
  assert.deepEqual(result, { normalized: null, isCorrect: null, awardedPoints: 0, countsAsMistake: false });
});

test('grades only answered MCQ and never auto-grades essay text', () => {
  assert.equal(gradeHomeworkPart({ responseKind: 'auto_mcq', answerState: 'answered', answer: { raw: 'ب' }, answerSpec: { option: 'ب' }, maxPoints: 1 }).isCorrect, true);
  const essay = gradeHomeworkPart({ responseKind: 'essay_self_review', answerState: 'answered', answer: { text: 'أي نص' }, answerSpec: {}, maxPoints: 1 });
  assert.equal(essay.isCorrect, null);
  assert.equal(essay.countsAsMistake, false);
});

test('validates paper answers and locks unanswered self-review semantics', () => {
  assert.deepEqual(validateHomeworkAnswer({ responseKind: 'auto_mcq', state: 'answered', answer: { raw: 'ج' } }).answer, { raw: 'ج' });
  assert.throws(() => validateHomeworkAnswer({ responseKind: 'auto_mcq', state: 'answered', answer: { raw: 'هـ' } }), /اختر/);
  assert.equal(validateSelfAssessment('unanswered', 'unanswered'), 'unanswered');
  assert.throws(() => validateSelfAssessment('incorrect', 'unanswered'), /غير المحلولة/);
});

test('summary excludes essays from automatic score', () => {
  const summary = summarizeHomework([
    { responseKind: 'auto_mcq', answerState: 'answered', isCorrect: true, awardedPoints: 1, maxPoints: 1 },
    { responseKind: 'auto_mcq', answerState: 'unanswered', isCorrect: null, awardedPoints: 0, maxPoints: 1 },
    { responseKind: 'essay_self_review', answerState: 'answered', isCorrect: null, awardedPoints: 0, maxPoints: 1 },
  ]);
  assert.deepEqual(summary, { answeredParts: 2, unansweredParts: 1, mcqScore: 1, mcqMaxScore: 2, mcqWrong: 0, mcqUnanswered: 1 });
});
