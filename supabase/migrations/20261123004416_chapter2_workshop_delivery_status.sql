begin;

create or replace function private.chapter2_assessment_metrics(
  p_cycle_id uuid,
  p_as_of timestamptz default now()
)
returns setof jsonb
language sql stable
set search_path = pg_catalog, private, public
as $function$
-- Each activity type uses one denominator for the whole Chapter 2 roster.
-- For quizzes, use the maximum marks of the student who sat the most quizzes.
-- Among equal counts, use the highest total maximum marks.
with cycle as (
  select id, grade_level, start_at, cutoff_at, least(p_as_of, coalesce(cutoff_at, 'infinity'::timestamptz)) as as_of
  from public.assessment_cycles
  where id = p_cycle_id
    and cycle_code = 'CHAPTER2-2026-G3-01'
    and grade_level = 'الصف الثالث الثانوي'
),
roster as (
  select (m->>'user_id')::uuid as user_id, m
  from cycle c
  cross join lateral private.assessment_cycle_metrics_unscoped(c.id) m
  where coalesce(m->>'group_code', '') ~ '^[NK]3-'
),
sat_quizzes as (
  select r.user_id, count(*) as taken, sum(ct.max_score::numeric) as possible
  from cycle c
  join public.assessment_cycle_tests link on link.cycle_id = c.id and link.role = 'quiz'
  join public.class_tests ct on ct.id = link.test_id
  join public.session_student_records sr on sr.session_id = ct.session_id
  join roster r on r.user_id = sr.user_id
  join public.class_test_scores score
    on score.test_id = ct.id and score.user_id = r.user_id and score.status = 'scored'
  group by r.user_id
),
quiz_reference as (
  select (select possible from sat_quizzes order by taken desc, possible desc limit 1) as possible
),
activities as (
  select d.id, d.slug, d.title, d.active_version_id, d.eligible_group_codes, v.published_at,
         case when r.due_at >= v.published_at then r.due_at end as due_at,
         h.workshop_id is not null as is_paper,
         c.start_at, c.cutoff_at, c.as_of, c.grade_level
  from cycle c
  join private.workshop_definitions d on d.grade_level = c.grade_level
  join private.workshop_versions v on v.id = d.active_version_id and v.status = 'published'
  left join private.homework_delivery_policies h
    on h.workshop_id = d.id and h.delivery_contract = 'paper_homework_capture_v1'
  left join private.chapter2_assessment_activity_rules r on r.workshop_id = d.id
  where d.academic_term = 'second' and d.status in ('published', 'paused', 'archived')
    and v.published_at >= c.start_at and v.published_at <= c.as_of
    and (h.workshop_id is null or h.enabled or h.enabled_at is not null)
    and coalesce(r.counts_for_assessment, true)
),
paper as (
  select h.user_id, h.workshop_id, min(h.submitted_at) as submitted_at
  from activities a
  join private.homework_submissions h on h.workshop_id = a.id
  where a.is_paper
    and h.submitted_at >= a.start_at and h.submitted_at <= a.as_of
    and (a.cutoff_at is null or h.submitted_at < a.cutoff_at)
  group by h.user_id, h.workshop_id
),
tracks as (
  select a.id as workshop_id, t.id as track_id, t.mode
  from activities a
  join private.workshop_tracks t on t.version_id = a.active_version_id
  where not a.is_paper
),
track_parts as (
  select t.track_id, p.id as part_id, p.max_points
  from tracks t
  join private.workshop_track_questions tq on tq.track_id = t.track_id
  join private.workshop_questions q on q.id = tq.question_id and q.active
  join private.workshop_question_parts p on p.question_id = q.id
),
track_limits as (
  select track_id, count(*) as total_parts, sum(max_points) as max_points
  from track_parts group by track_id
),
first_attempts as (
  select distinct on (w.user_id, e.track_id, e.part_id)
         w.user_id, e.track_id, e.part_id, e.server_received_at,
         case when e.is_correct and e.outcome = 'first_try' then e.awarded_points else 0 end as points
  from tracks t
  join activities a on a.id = t.workshop_id
  join private.workshop_attempt_events e on e.track_id = t.track_id and e.attempt_no = 1
  join track_parts p on p.track_id = e.track_id and p.part_id = e.part_id
  join private.workshop_cycles w on w.id = e.cycle_id and w.workshop_id = t.workshop_id
  where t.mode = 'interactive' and w.source = 'initial'
    and e.server_received_at >= a.start_at and e.server_received_at <= a.as_of
    and (a.cutoff_at is null or e.server_received_at < a.cutoff_at)
  order by w.user_id, e.track_id, e.part_id, e.server_received_at, e.id
),
workshop_scores as (
  select f.user_id, f.track_id, min(f.server_received_at) as activity_at, sum(f.points) as points,
         count(*) = limits.total_parts as completed, count(*) as answered_parts
  from first_attempts f
  join track_limits limits on limits.track_id = f.track_id
  group by f.user_id, f.track_id, limits.total_parts
  union all
  (select distinct on (w.user_id, s.track_id) w.user_id, s.track_id, s.submitted_at,
         limits.max_points * s.score / nullif(s.max_score, 0), true, limits.total_parts
  from tracks t
  join activities a on a.id = t.workshop_id
  join track_limits limits on limits.track_id = t.track_id
  join private.workshop_submissions s on s.track_id = t.track_id
  join private.workshop_cycles w on w.id = s.cycle_id and w.workshop_id = t.workshop_id
  where t.mode = 'final_submit' and w.source = 'initial'
    and s.submitted_at >= a.start_at and s.submitted_at <= a.as_of
    and (a.cutoff_at is null or s.submitted_at < a.cutoff_at)
  order by w.user_id, s.track_id, s.submitted_at, s.id)
),
workshop_activity as (
  select s.user_id, t.workshop_id, min(s.activity_at) as activity_at
  from workshop_scores s join tracks t on t.track_id = s.track_id
  group by s.user_id, t.workshop_id
),
assigned as (
  select r.user_id, a.id, a.slug, a.title, a.is_paper, p.submitted_at is not null as submitted
  from roster r cross join activities a
  left join paper p on p.user_id = r.user_id and p.workshop_id = a.id
  left join workshop_activity w on w.user_id = r.user_id and w.workshop_id = a.id
  where exists (
    select 1
    from public.student_group_memberships m
    join public.student_groups g on g.id = m.group_id and g.grade_level = a.grade_level
    where m.user_id = r.user_id
      and (jsonb_array_length(a.eligible_group_codes) = 0 or a.eligible_group_codes ? g.group_code)
      and coalesce(m.joined_on, (m.created_at at time zone 'Africa/Cairo')::date) <= (greatest(
        a.published_at, case when a.due_at is not null then least(a.due_at, a.as_of) end,
        p.submitted_at, w.activity_at
      ) at time zone 'Africa/Cairo')::date
      and (m.left_on is null or m.left_on >= (a.published_at at time zone 'Africa/Cairo')::date)
  )
),
paper_summary as (
  select user_id, count(*)::int as available,
         count(*) filter (where submitted)::int as submitted
  from assigned where is_paper group by user_id
),
class_homework as (
  select r.user_id, count(*) filter (where a.id is null)::int as total,
         count(*) filter (where a.id is null and r.homework_status is null)::int as missing,
         round(100 * sum(case r.homework_status
           when 'mastered' then 1 when 'legacy_done' then 1 when 'done' then .8
           when 'partial' then .5 else 0 end) filter (where a.id is null)
           / nullif(count(*) filter (where a.id is null), 0), 1) as rate
  from cycle c
  join public.assessment_cycle_sessions link on link.cycle_id = c.id
  join public.class_sessions session on session.id = link.session_id and session.has_homework
  join public.session_student_records r on r.session_id = session.id
  left join private.chapter2_assessment_homework_links duplicate on duplicate.session_id = session.id
  left join assigned a on a.id = duplicate.workshop_id and a.user_id = r.user_id and a.is_paper
  group by r.user_id
),
per_workshop as (
  select a.user_id, a.id, a.slug, a.title,
         bool_and(coalesce(s.completed, false)) as completed,
         100 * sum(coalesce(s.points, 0)) / nullif(sum(l.max_points), 0) as percentage,
         coalesce(sum(l.total_parts) filter (where t.mode = 'interactive'), 0)::int as class_parts,
         coalesce(sum(s.answered_parts) filter (where t.mode = 'interactive'), 0)::int as class_answered,
         bool_or(t.mode = 'final_submit') as home_required,
         min(s.activity_at) filter (where t.mode = 'final_submit') as home_submitted_at
  from assigned a
  join tracks t on t.workshop_id = a.id
  join track_limits l on l.track_id = t.track_id
  left join workshop_scores s on s.track_id = t.track_id and s.user_id = a.user_id
  where not a.is_paper
  group by a.user_id, a.id, a.slug, a.title
),
workshop_summary as (
  select user_id,
         count(*) filter (where completed)::int as submitted,
         sum(percentage) filter (where completed) as points,
         count(*) filter (where home_submitted_at is not null and class_answered < class_parts)::int as home_pending_class,
         jsonb_agg(jsonb_build_object(
           'slug', slug,
           'title', title,
           'class_parts', class_parts,
           'class_answered', class_answered,
           'home_required', home_required,
           'home_submitted_at', home_submitted_at,
           'counted', completed
         ) order by slug) as deliveries
  from per_workshop
  group by user_id
),
denominators as (
  select (select coalesce(max(submitted), 0) from paper_summary) as paper,
         (select coalesce(max(submitted), 0) from workshop_summary) as workshop
),
source_rates as (
  select r.user_id,
         coalesce(p.submitted, 0) as paper_submitted,
         coalesce(p.available, 0) as paper_available,
         d.paper as paper_counted,
         round(100.0 * coalesce(p.submitted, 0) / nullif(d.paper, 0), 1) as paper_rate,
         coalesce(w.submitted, 0) as workshop_submitted,
         d.workshop as workshop_counted,
         coalesce(w.home_pending_class, 0) as workshop_home_pending_class,
         coalesce(w.deliveries, '[]'::jsonb) as workshop_deliveries,
         coalesce(w.points, 0) as workshop_points,
         100 * d.workshop as workshop_possible,
         round(coalesce(w.points, 0) / nullif(d.workshop, 0), 1) as workshop_rate
  from roster r
  cross join denominators d
  left join paper_summary p on p.user_id = r.user_id
  left join workshop_summary w on w.user_id = r.user_id
),
quiz_rates as (
  select r.user_id, coalesce(ref.possible, 0) as possible,
         case when ref.possible > 0 then
           least(100, round(100.0 * (r.m->>'quiz_earned')::numeric / ref.possible, 1))
         end as rate
  from roster r cross join quiz_reference ref
),
metrics as (
  select r.m, s.*, h.rate as class_homework_rate, q.possible as quiz_possible, q.rate as quiz_rate,
         coalesce(h.total, 0) as class_homework_total,
         coalesce(h.missing, 0) as class_homework_missing,
         coalesce((r.m->>'total_sessions')::int, 0) > 0
           and h.rate is not null and q.rate is not null
           and h.missing = 0
           and coalesce((r.m->>'quiz_pending')::int, 0) = 0
           and s.paper_rate is not null and s.workshop_rate is not null as complete
  from roster r
  left join class_homework h on h.user_id = r.user_id
  join source_rates s on s.user_id = r.user_id
  join quiz_rates q on q.user_id = r.user_id
)
select m || jsonb_build_object(
  'assessment_model', 'chapter2_sources',
  'quiz_possible', quiz_possible,
  'quiz_ratio', quiz_rate,
  'homework_rate', class_homework_rate,
  'homework_known', class_homework_total,
  'homework_unknown', class_homework_missing,
  'online_homework_rate', paper_rate,
  'online_homework_submitted', paper_submitted,
  'online_homework_available', paper_available,
  'online_homework_counted', paper_counted,
  'workshop_counted', workshop_counted,
  'workshop_home_pending_class', workshop_home_pending_class,
  'workshop_deliveries', workshop_deliveries,
  'platform_score', workshop_rate,
  'platform_quality_ratio', workshop_rate,
  'platform_completed', workshop_submitted,
  'platform_graded_sets', workshop_submitted,
  'platform_available', workshop_counted,
  'platform_completion_rate', round(100.0 * workshop_submitted / nullif(workshop_counted, 0), 1),
  'platform_best_score_sum', workshop_points,
  'platform_total_possible', workshop_possible,
  'pending_platform_attempts', 0,
  'pending_essay_answers', 0,
  'pending_essay_attempts', 0,
  'data_complete', complete,
  'readiness_score', case when complete then round(
    quiz_rate * .40 + (m->>'attendance_rate')::numeric * .10
    + class_homework_rate * .10 + paper_rate * .10 + workshop_rate * .30, 1) end
)
from metrics;
$function$;

revoke all on function private.chapter2_assessment_metrics(uuid, timestamptz) from public, anon, authenticated;

commit;
