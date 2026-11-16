begin;

-- An optional deadline is an assessment deadline. The activity's existing delivery
-- rules can still accept work after that deadline while the cycle is open.
create table if not exists private.chapter2_assessment_activity_rules (
  workshop_id uuid primary key references private.workshop_definitions(id),
  counts_for_assessment boolean not null default true,
  due_at timestamptz
);

alter table private.chapter2_assessment_activity_rules enable row level security;
revoke all on private.chapter2_assessment_activity_rules from public, anon, authenticated;

-- Mark a classroom entry as the same assigned paper homework when the teacher
-- records it in both places. Attendance on the linked session still counts.
create table if not exists private.chapter2_assessment_homework_links (
  session_id uuid primary key references public.class_sessions(id),
  workshop_id uuid not null references private.workshop_definitions(id)
);

alter table private.chapter2_assessment_homework_links enable row level security;
revoke all on private.chapter2_assessment_homework_links from public, anon, authenticated;

create or replace function private.chapter2_assessment_metrics(
  p_cycle_id uuid,
  p_as_of timestamptz default now()
)
returns setof jsonb
language sql stable
set search_path = pg_catalog, private, public
as $function$
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
activities as (
  select d.id, d.active_version_id, d.eligible_group_codes, v.published_at,
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
  select track_id, sum(max_points) as max_points
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
  select f.user_id, f.track_id, min(f.server_received_at) as activity_at, sum(f.points) as points
  from first_attempts f group by f.user_id, f.track_id
  union all
  (select distinct on (w.user_id, s.track_id) w.user_id, s.track_id, s.submitted_at,
         limits.max_points * s.score / s.max_score
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
  select r.user_id, a.id, a.is_paper, a.due_at <= a.as_of as due,
         p.submitted_at is not null as submitted
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
         count(*) filter (where submitted)::int as submitted,
         count(*) filter (where submitted or due)::int as counted,
         round(100.0 * count(*) filter (where submitted) /
           nullif(count(*) filter (where submitted or due), 0), 1) as rate
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
  select a.user_id, a.id,
         count(*) filter (where s.activity_at is not null)::int as begun,
         count(*) filter (where s.activity_at is not null or a.due)::int as counted,
         count(*)::int as available,
         sum(s.points) as points,
         sum(l.max_points) filter (where s.activity_at is not null or a.due) as possible
  from assigned a
  join tracks t on t.workshop_id = a.id
  join track_limits l on l.track_id = t.track_id
  left join workshop_scores s on s.track_id = t.track_id and s.user_id = a.user_id
  where not a.is_paper
  group by a.user_id, a.id
),
workshop_summary as (
  select user_id, sum(begun)::int as begun, sum(available)::int as available,
         count(*) filter (where counted > 0)::int as counted_workshops,
         sum(coalesce(points, 0)) as points, sum(possible) as possible,
         round(avg(100 * coalesce(points, 0) / nullif(possible, 0)), 1) as rate
  from per_workshop group by user_id
),
metrics as (
  select r.m, p.rate as paper_rate, w.rate as workshop_rate, h.rate as class_homework_rate,
         coalesce(h.total, 0) as class_homework_total, coalesce(h.missing, 0) as class_homework_missing,
         coalesce(p.available, 0) as paper_available, coalesce(p.submitted, 0) as paper_submitted,
         coalesce(p.counted, 0) as paper_counted, coalesce(w.begun, 0) as workshop_begun,
         coalesce(w.available, 0) as workshop_available, coalesce(w.counted_workshops, 0) as workshop_counted,
         coalesce(w.points, 0) as workshop_points, coalesce(w.possible, 0) as workshop_possible,
         coalesce((r.m->>'total_sessions')::int, 0) > 0
           and h.rate is not null and r.m->>'quiz_ratio' is not null
           and h.missing = 0
           and coalesce((r.m->>'quiz_pending')::int, 0) = 0
           and p.rate is not null and w.rate is not null as complete
  from roster r
  left join class_homework h on h.user_id = r.user_id
  left join paper_summary p on p.user_id = r.user_id
  left join workshop_summary w on w.user_id = r.user_id
)
select m || jsonb_build_object(
  'assessment_model', 'chapter2_sources',
  'homework_rate', class_homework_rate,
  'homework_known', class_homework_total,
  'homework_unknown', class_homework_missing,
  'online_homework_rate', paper_rate,
  'online_homework_submitted', paper_submitted,
  'online_homework_available', paper_available,
  'online_homework_counted', paper_counted,
  'workshop_counted', workshop_counted,
  'platform_score', workshop_rate,
  'platform_quality_ratio', workshop_rate,
  'platform_completed', workshop_begun,
  'platform_graded_sets', workshop_begun,
  'platform_available', workshop_available,
  'platform_completion_rate', round(100.0 * workshop_begun / nullif(workshop_available, 0), 1),
  'platform_best_score_sum', workshop_points,
  'platform_total_possible', workshop_possible,
  'pending_platform_attempts', 0,
  'pending_essay_answers', 0,
  'pending_essay_attempts', 0,
  'data_complete', complete,
  'readiness_score', case when complete then round(
    (m->>'quiz_ratio')::numeric * .40 + (m->>'attendance_rate')::numeric * .10
    + class_homework_rate * .10 + paper_rate * .10 + workshop_rate * .30, 1) end
)
from metrics;
$function$;

revoke all on function private.chapter2_assessment_metrics(uuid, timestamptz) from public, anon, authenticated;

-- Apply the new calculation only after the Chapter 2 cycle's weights are explicitly
-- activated. The original function still serves every other cycle and archived reads.
create or replace function private.assessment_cycle_metrics(p_cycle_id uuid)
returns setof jsonb
language plpgsql stable
set search_path = pg_catalog, private, public
as $function$
declare
  c public.assessment_cycles%rowtype;
begin
  select * into c from public.assessment_cycles where id = p_cycle_id;
  if not found then return; end if;
  if c.cycle_code = 'CHAPTER2-2026-G3-01' and c.weights->>'assessment_model' = 'chapter2_sources' then
    return query select * from private.chapter2_assessment_metrics(p_cycle_id);
    return;
  end if;
  return query
    select m
    from private.assessment_cycle_metrics_unscoped(p_cycle_id) m
    where (c.grade_level = 'الصف الثالث الثانوي' and coalesce(m->>'group_code', '') ~ '^[NK]3-')
       or (c.grade_level = 'الصف الثاني الثانوي' and coalesce(m->>'group_code', '') ~ '^[NK]2-'
          and (c.education_track = 'all' or c.education_track = private.assessment_track_for_group(m->>'group_code')));
end;
$function$;

commit;
