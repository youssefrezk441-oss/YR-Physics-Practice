# YR Physics — Chapter 2 assessment cycle and honor board (third secondary, 2026)

## Production row created with owner authorization (2026-10-30)

- Project: `ltjdhconuiqblxfjzpzj`
- Table: `public.assessment_cycles`
- Cycle ID: `6bc27cf3-c0b9-4b78-889c-73c08df0f950`
- Cycle code: `CHAPTER2-2026-G3-01`
- Arabic title: `الفصل الثاني — رحلة التقييم`
- Grade: `الصف الثالث الثانوي`; education track: `all`
- Status: **`pending_review`** (not `open`); start: `2026-10-27 22:15:41+00` (first chapter-two workshop publication)
- `course_id`, `comprehensive_exam_id`, `comprehensive_exam_date`, `cutoff_at`: NULL
- Weights: quizzes 40%, platform 30%, homework 20%, attendance 10%, matching chapter one.
- Zero linked class sessions, class tests, practice sets, and frozen snapshots **by design**. Nothing from chapter one is copied.
- No changes to existing assessments, results, grades, students or production frontend.

## Real activity already present, but not yet in the assessment metric source

`private.workshop_definitions`:
1. `third-secondary-term-2-lecture-1`: published Oct 27; 9 workshop submissions and 17 student-owned workshop cycles in inspection on Oct 30.
2. `third-secondary-term-2-lecture-1-homework`: published Oct 28; 13 homework submissions on Oct 30.

The current `private.assessment_cycle_metrics[_unscoped]` implementation reads `assessment_cycle_sessions`, `assessment_cycle_tests`, and `assessment_cycle_training_sets` joined to the older practice platform. It does **not** read `private.workshop_submissions` or `private.homework_submissions`. Attempting to label these results with the 30% platform / 20% homework weights without a scoped adapter would misrepresent student results.

Read-only verification on Oct 30:
- Existing `CHAPTER1-2026-G3-01`: still `open`; 35 linked sessions, 13 linked class tests, 4 linked training sets.
- New `CHAPTER2-2026-G3-01`: `pending_review`; 0 linked assessment inputs, 0 eligible rankings. `private.assessment_cycle_metrics(new cycle)` returns 0 participants and 0 scored students.
- Existing deployed `student-honor-board` v22 accepts a selected `cycles.grade3` ID and returns the DB-backed cycle catalog. It sorts `open` cycles before `pending_review`, so the new row **does not replace** the old default cycle.

## Draft UI behavior

- Achievements lists the new chapter-two round and clearly labels it `دورة قيد التجهيز — لا يوجد ترتيب معتمد`.
- Selecting this round displays a dedicated first-class **لوحة شرف الفصل الثاني قيد الإعداد** screen with zero fabricated leaderboards or numerical percentages.
- Existing first-chapter and frozen foundation rounds remain accessible.
- The UI changes stay in draft PR #43, not GitHub Pages production.

## Conditions for publishing real rankings

1. Confirm the intended source of truth and aggregation for chapter-two workshop class vs homework, including pending essay review and first-attempt vs assisted scoring. Do not reuse class-one records or equate `workshop_cycles` with `assessment_cycles`; they are different IDs.
2. Connect chapter-two class attendance, quizzes, homework and platform workshop activity **at the data / metric layer**, scoped by verified workshop IDs, chapter, grade, student ID, and timestamps. Preserve RBAC and avoid exposing private tables via unauthenticated Data API.
3. Validate the result against controlled test students and edge cases: unfinished attempts, pending grading, repeat submissions, absence, empty datasets, grade-two exclusion, and owner-approved scoring formula.
4. Only after real scores are verified, transition cycle status to `open` with an explicit release decision. Never freeze a snapshot or rank students while source linkage is missing.

## Idempotent reference seed for disaster recovery / staging only

**Do not run this on production again; the row already exists.**

```sql
INSERT INTO public.assessment_cycles
 (cycle_code,title,grade_level,education_track,start_at,cutoff_at,
  comprehensive_exam_date,status,weights,notes,comprehensive_exam_id,course_id)
SELECT
 'CHAPTER2-2026-G3-01','الفصل الثاني — رحلة التقييم',
 c.grade_level,c.education_track,TIMESTAMPTZ '2026-10-27 22:15:41+00',
 NULL,NULL,'pending_review',c.weights,
 'دورة مستقلة للفصل الثاني. لا يعتمد ترتيب حتى ربط مصادر الورش والواجب والكويزات والحضور.',
 NULL,NULL
FROM public.assessment_cycles c
WHERE c.cycle_code='CHAPTER1-2026-G3-01'
  AND c.grade_level='الصف الثالث الثانوي' AND c.education_track='all'
ON CONFLICT (cycle_code) DO NOTHING;
```

## Chapter 2 scoring sources

The Chapter 2 readiness formula is 40% quizzes, 10% attendance, 10% homework recorded in class, 10% online homework submissions, and 30% workshops. The same cycle continues to use the existing comprehensive exam formula after approval. The updated calculation is selected by the Chapter 2 cycle's `assessment_model` setting.

- Class records and quizzes follow the existing cycle links. Online activities are discovered by the published grade, chapter, version and availability, and student eligibility uses group membership dates.
- An online book homework is earned by its final submission regardless of the grade. Each counted homework has equal weight within that component.
- The workshop score uses first independent attempts in the class track and the initial final submission in the home track. Track parts contribute their allotted points to the workshop score. Each counted workshop has equal weight within the component.
- Eligible, unstarted or unsubmitted work without a recorded assessment deadline does not reduce the provisional score. When a deadline exists, missing work enters the denominator after it. A score is reported when all four sources have data for that student. The cycle cutoff limits which events can enter the calculation.
- `private.chapter2_assessment_activity_rules` is the assessment override by activity. Set `counts_for_assessment=false` for optional content and record `due_at` when a deadline is assigned.
- Record a classroom session's duplicate assignment in `private.chapter2_assessment_homework_links` when the same paper homework appears online and in the class log. The classroom assignment is then omitted only for students eligible for the online assignment. Attendance remains counted.

### Release and rollback

The migration adds the scoring function and its two private configuration tables. With the original cycle weights, the public board continues to receive the previous results. After the updated Edge Functions and Pages build are available, activate the scoring model only for the live Chapter 2 cycle by setting its weight JSON to `{"assessment_model":"chapter2_sources","quizzes":40,"platform":30,"homework":10,"attendance":10,"online_homework":10}`.

For rollback, restore the prior weight JSON on the live cycle `{"quizzes":40,"homework":20,"platform":30,"attendance":10}`. The calculation then follows the original path. Keep the release's pre-change function definitions and cycle settings available for recovery.
