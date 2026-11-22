import type postgres from "npm:postgres@3.4.7";
import { PaperHomeworkError } from "./paper-homework-core.ts";

export const homeworkAdminActions = new Set(["overview", "students", "student_detail", "questions", "skills"]);

const text = (value: unknown, max: number) => String(value ?? "").normalize("NFKC").trim().slice(0, max);

export async function loadHomeworkAnalytics(sql: postgres.Sql, action: string, body: Record<string, unknown>, level: string) {
  if (!homeworkAdminActions.has(action)) throw new PaperHomeworkError(400, "unknown_action", "العملية غير معروفة.");
  const slug = text(body.workshop_slug || "third-secondary-term-2-lecture-1-homework", 180);
  const group = text(body.group_code, 80);
  const search = text(body.search, 120);
  const [work] = await sql`
    select id, active_version_id as version_id, eligible_group_codes
    from private.workshop_definitions where slug = ${slug} limit 1`;
  if (!work) throw new PaperHomeworkError(404, "not_found", "الواجب غير موجود.");

  const groupCodes = JSON.stringify(work.eligible_group_codes ?? []);
  const eligible = sql`
    select profile.user_id, profile.student_code, profile.full_name, profile.group_code
    from public.student_profiles profile
    left join public.student_groups student_group on student_group.group_code = profile.group_code
    where profile.is_active
      and (coalesce(student_group.grade_level, profile.grade_level, '') ~ '^3([^0-9]|$)'
           or coalesce(student_group.grade_level, profile.grade_level, '') like '%الثالث%')
      and (jsonb_array_length(${groupCodes}::jsonb) = 0 or ${groupCodes}::jsonb ? profile.group_code)
      ${group ? sql`and profile.group_code = ${group}` : sql``}`;
  const scopedSubmissions = sql`
    select submission.*
    from private.homework_submissions submission
    join eligible on eligible.user_id = submission.user_id
    where submission.workshop_id = ${work.id}::uuid`;

  if (action === "overview") {
    const [summary] = await sql`
      with eligible as (${eligible}), submissions as (${scopedSubmissions}),
      essay_counts as (
        select count(*) filter (where review.assessment = 'correct')::int as correct,
               count(*) filter (where review.assessment = 'partial')::int as partial,
               count(*) filter (where review.assessment = 'incorrect')::int as incorrect,
               count(*) filter (where answer.answer_state = 'answered' and review.id is null)::int as pending
        from private.homework_submission_answers answer
        join submissions on submissions.id = answer.submission_id
        left join private.homework_self_review_events review on review.submission_answer_id = answer.id
        where answer.response_kind = 'essay_self_review'
      ), mistake_counts as (
        select count(*)::int as total,
          count(*) filter (where exists (
            select 1 from private.ch2_mistake_review_events review
            where review.user_id = evidence.user_id and review.mistake_ref = evidence.mistake_ref
          ))::int as reviewed,
          count(*) filter (where exists (
            select 1 from private.ch2_mistake_mastery_attempts attempt
            where attempt.user_id = evidence.user_id and attempt.mistake_ref = evidence.mistake_ref and attempt.is_correct
          ) or exists (
            select 1 from private.ch2_essay_mastery_retries retry
            join private.ch2_essay_mastery_reviews review on review.retry_id = retry.id and review.assessment = 'correct'
            where retry.user_id = evidence.user_id and retry.mistake_ref = evidence.mistake_ref
          ))::int as mastered
        from private.ch2_paper_homework_mistake_evidence evidence
        join eligible on eligible.user_id = evidence.user_id
        where evidence.workshop_id = ${work.id}::uuid
      )
      select (select count(*)::int from eligible) as eligible,
             count(*)::int as submitted,
             round(avg(mcq_score * 100.0 / nullif(mcq_max_score, 0)), 2) as average_mcq,
             coalesce(sum(unanswered_parts), 0)::int as unanswered,
             (select to_jsonb(essay_counts) from essay_counts) as essay_self_review,
             (select to_jsonb(mistake_counts) from mistake_counts) as mistake_progress
      from submissions`;
    return {
      ok: true,
      level,
      overview: {
        ...summary,
        unsubmitted: summary.eligible - summary.submitted,
        average_mcq: summary.average_mcq === null ? null : Number(summary.average_mcq),
      },
    };
  }

  if (action === "students") {
    const rows = await sql`
      with eligible as (${eligible}), submissions as (${scopedSubmissions})
      select eligible.*, submission.id as submission_id, submission.mcq_score, submission.mcq_max_score,
             submission.answered_parts, submission.unanswered_parts, submission.submitted_at
      from eligible left join submissions submission on submission.user_id = eligible.user_id
      ${search ? sql`where eligible.full_name ilike ${'%' + search + '%'} or eligible.student_code ilike ${'%' + search + '%'}` : sql``}
      order by (submission.id is null), eligible.full_name, eligible.user_id`;
    return { ok: true, students: rows };
  }

  if (action === "student_detail") {
    const userId = text(body.user_id, 80);
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(userId)) {
      throw new PaperHomeworkError(400, "invalid_student", "معرف الطالب غير صالح.");
    }
    const rows = await sql`select question.question_ref,question.source_ref,question.title,question.image_path,question.skill_ref,skill.name as skill_name,part.part_key,part.label,answer.response_kind,answer.answer_state,answer.answer_json,answer.is_correct,answer.awarded_points,answer.max_points,review.assessment,review.reviewed_at from private.homework_submission_answers answer join private.homework_submissions submission on submission.id=answer.submission_id join private.workshop_questions question on question.id=answer.question_id join private.workshop_skills skill on skill.version_id=question.version_id and skill.skill_ref=question.skill_ref join private.workshop_question_parts part on part.id=answer.part_id left join private.homework_self_review_events review on review.submission_answer_id=answer.id where submission.workshop_id=${work.id}::uuid and submission.user_id=${userId}::uuid order by question.question_ref,part.sort_order`;
    return { ok: true, answers: rows };
  }

  const scopedAnswers = sql`
    select answer.*
    from private.homework_submission_answers answer
    join submissions on submissions.id = answer.submission_id`;
  if (action === "questions") {
    const rows = await sql`
      with eligible as (${eligible}), submissions as (${scopedSubmissions}), answers as (${scopedAnswers})
      select question.question_ref, question.source_ref, question.title, question.skill_ref, skill.name as skill_name,
             part.part_key, part.label, count(answer.id)::int as submissions,
             count(*) filter (where answer.answer_state = 'answered' and answer.is_correct = false)::int as wrong,
             count(*) filter (where answer.answer_state = 'unanswered')::int as unanswered
      from private.workshop_questions question
      join private.workshop_skills skill on skill.version_id = question.version_id and skill.skill_ref = question.skill_ref
      join private.workshop_question_parts part on part.question_id = question.id
      left join answers answer on answer.part_id = part.id
      where question.version_id = ${work.version_id}::uuid and question.active
      group by question.question_ref, question.source_ref, question.title, question.skill_ref, skill.name,
               part.part_key, part.label, part.sort_order
      order by wrong desc, question.question_ref, part.sort_order`;
    return { ok: true, questions: rows };
  }

  const rows = await sql`
    with eligible as (${eligible}), submissions as (${scopedSubmissions}), answers as (${scopedAnswers})
    select skill.skill_ref, skill.name,
           count(*) filter (where answer.answer_state = 'answered')::int as answered,
           count(*) filter (where answer.answer_state = 'answered' and answer.is_correct = false)::int as wrong,
           count(*) filter (where answer.answer_state = 'unanswered')::int as unanswered
    from private.workshop_skills skill
    join private.workshop_questions question on question.version_id = skill.version_id and question.skill_ref = skill.skill_ref and question.active
    join private.workshop_question_parts part on part.question_id = question.id
    left join answers answer on answer.part_id = part.id
    where skill.version_id = ${work.version_id}::uuid
    group by skill.skill_ref, skill.name, skill.sort_order
    order by skill.sort_order`;
  return { ok: true, skills: rows };
}
