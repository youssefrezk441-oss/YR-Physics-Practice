lock table public.l3_workshop_progress in access exclusive mode;
lock table public.l3_workshop_events in access exclusive mode;

create table private.l3_workshop_progress_backup_20260918 as
table public.l3_workshop_progress;
alter table private.l3_workshop_progress_backup_20260918 enable row level security;
revoke all on private.l3_workshop_progress_backup_20260918 from public, anon, authenticated;

create table private.l3_workshop_events_backup_20260918 as
table public.l3_workshop_events;
alter table private.l3_workshop_events_backup_20260918 enable row level security;
revoke all on private.l3_workshop_events_backup_20260918 from public, anon, authenticated;

create temporary table l3_canonical_attempts on commit drop as
with one_per_attempt_number as (
  select
    e.*,
    row_number() over (
      partition by user_id, bank_no, part_index, attempt_no
      order by is_correct desc nulls last, created_at, id
    ) as pick
  from public.l3_workshop_events e
  where event_type = 'attempt'
),
one_per_distinct_answer as (
  select
    x.*,
    row_number() over (
      partition by user_id, bank_no, part_index, answer_text
      order by created_at, id
    ) as repeated_answer
  from one_per_attempt_number x
  where pick = 1
)
select
  user_id,
  bank_no,
  part_index,
  row_number() over (
    partition by user_id, bank_no, part_index
    order by created_at, id
  )::integer as attempt_no,
  answer_text,
  is_correct,
  created_at
from one_per_distinct_answer
where repeated_answer = 1;

delete from public.l3_workshop_events
where event_type = 'attempt';

insert into public.l3_workshop_events
  (user_id, bank_no, part_index, event_type, attempt_no, answer_text, is_correct, created_at)
select user_id, bank_no, part_index, 'attempt', attempt_no, answer_text, is_correct, created_at
from l3_canonical_attempts
order by created_at, user_id, bank_no, part_index, attempt_no;

delete from public.l3_workshop_events r
where r.event_type = 'reveal'
  and exists (
    select 1
    from public.l3_workshop_events a
    where a.event_type = 'attempt'
      and a.user_id = r.user_id
      and a.bank_no = r.bank_no
      and a.part_index = r.part_index
      and a.is_correct = true
  );

delete from public.l3_workshop_progress;

insert into public.l3_workshop_progress
  (user_id, bank_no, part_index, attempts_count, tried_answers,
   first_attempt_correct, mastered, revealed, last_answer, created_at, updated_at)
select
  a.user_id,
  a.bank_no,
  a.part_index,
  count(*)::integer,
  jsonb_agg(to_jsonb(a.answer_text) order by a.attempt_no),
  bool_or(a.is_correct) filter (where a.attempt_no = 1),
  bool_or(a.is_correct),
  (not bool_or(a.is_correct)) and exists (
    select 1
    from public.l3_workshop_events r
    where r.event_type = 'reveal'
      and r.user_id = a.user_id
      and r.bank_no = a.bank_no
      and r.part_index = a.part_index
  ),
  (array_agg(a.answer_text order by a.attempt_no desc))[1],
  min(a.created_at),
  greatest(
    max(a.created_at),
    coalesce((
      select max(r.created_at)
      from public.l3_workshop_events r
      where r.event_type = 'reveal'
        and r.user_id = a.user_id
        and r.bank_no = a.bank_no
        and r.part_index = a.part_index
    ), max(a.created_at))
  )
from public.l3_workshop_events a
where a.event_type = 'attempt'
group by a.user_id, a.bank_no, a.part_index;

alter table public.l3_workshop_progress
  add constraint l3_workshop_progress_tried_answers_array_check
  check (jsonb_typeof(tried_answers) = 'array');

alter table public.l3_workshop_events
  add constraint l3_workshop_events_payload_check
  check (
    (
      event_type = 'attempt'
      and attempt_no between 1 and 3
      and answer_text is not null
      and is_correct is not null
    )
    or
    (
      event_type = 'reveal'
      and attempt_no is null
      and answer_text is null
      and is_correct is null
    )
  );

create unique index l3_workshop_events_attempt_unique
  on public.l3_workshop_events (user_id, bank_no, part_index, attempt_no)
  where event_type = 'attempt';

create unique index l3_workshop_events_reveal_unique
  on public.l3_workshop_events (user_id, bank_no, part_index)
  where event_type = 'reveal';
