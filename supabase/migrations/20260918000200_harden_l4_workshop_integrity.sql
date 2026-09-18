begin;

-- Preserve the pre-repair state before normalizing legacy JSONB payloads.
create table if not exists private.l4_workshop_progress_backup_20260918
as table public.l4_workshop_progress with data;
create table if not exists private.l4_workshop_events_backup_20260918
as table public.l4_workshop_events with data;
alter table private.l4_workshop_progress_backup_20260918 enable row level security;
alter table private.l4_workshop_events_backup_20260918 enable row level security;

-- Older Edge Function versions double-encoded JSON values as JSON strings.
update public.l4_workshop_progress
set tried_answers = (tried_answers #>> '{}')::jsonb
where jsonb_typeof(tried_answers) = 'string';

update public.l4_workshop_progress
set last_answer = (last_answer #>> '{}')::jsonb
where last_answer is not null
  and jsonb_typeof(last_answer) = 'string';

update public.l4_workshop_events
set answer_json = (answer_json #>> '{}')::jsonb
where answer_json is not null
  and jsonb_typeof(answer_json) = 'string';

-- Keep one canonical reveal event per student/question part.
with ranked as (
  select id,
         row_number() over (
           partition by user_id, bank_no, part_key
           order by created_at, id
         ) as rn
  from public.l4_workshop_events
  where event_type = 'reveal'
)
delete from public.l4_workshop_events e
using ranked r
where e.id = r.id
  and r.rn > 1;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'l4_workshop_progress_attempts_range') then
    alter table public.l4_workshop_progress
      add constraint l4_workshop_progress_attempts_range
      check (attempts_count between 0 and 3);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'l4_workshop_progress_tried_array') then
    alter table public.l4_workshop_progress
      add constraint l4_workshop_progress_tried_array
      check (jsonb_typeof(tried_answers) = 'array');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'l4_workshop_progress_last_answer_object') then
    alter table public.l4_workshop_progress
      add constraint l4_workshop_progress_last_answer_object
      check (last_answer is null or jsonb_typeof(last_answer) = 'object');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'l4_workshop_progress_state_exclusive') then
    alter table public.l4_workshop_progress
      add constraint l4_workshop_progress_state_exclusive
      check (not (mastered and revealed));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'l4_workshop_events_payload_shape') then
    alter table public.l4_workshop_events
      add constraint l4_workshop_events_payload_shape
      check (
        (
          event_type = 'attempt'
          and attempt_no between 1 and 3
          and answer_json is not null
          and jsonb_typeof(answer_json) = 'object'
          and is_correct is not null
        )
        or
        (
          event_type = 'reveal'
          and attempt_no is null
          and answer_json is null
          and is_correct is null
        )
      );
  end if;
end
$$;

create unique index if not exists l4_workshop_events_attempt_unique
  on public.l4_workshop_events(user_id, bank_no, part_key, attempt_no)
  where event_type = 'attempt';

create unique index if not exists l4_workshop_events_reveal_unique
  on public.l4_workshop_events(user_id, bank_no, part_key)
  where event_type = 'reveal';

-- Align the five public question contracts with the verified answer keys.
update public.l4_workshop_questions
set grading_mode = 'symbolic',
    question_type = 'symbolic',
    answer_schema = '{"type":"symbolic","parts":[{"key":"main","unit":"","input":"text","label":"اكتب ترتيب القراءات"}]}'::jsonb,
    updated_at = now()
where bank_no = 311;

update public.l4_workshop_questions
set grading_mode = 'multi_qualitative',
    question_type = 'multi_qualitative',
    answer_schema = '{"type":"multi_qualitative","parts":[{"key":"main","unit":"","input":"text","label":"الإجابة"}]}'::jsonb,
    updated_at = now()
where bank_no = 381;

update public.l4_workshop_questions
set grading_mode = 'multi_qualitative',
    question_type = 'multi_qualitative',
    answer_schema = '{"type":"multi_qualitative","parts":[{"key":"main","unit":"","input":"text","label":"التغير"}]}'::jsonb,
    updated_at = now()
where bank_no = 383;

update public.l4_workshop_questions
set grading_mode = 'symbolic',
    question_type = 'symbolic',
    answer_schema = '{"type":"symbolic","parts":[{"key":"main","unit":"","input":"text","label":"اكتب العلاقة"}]}'::jsonb,
    updated_at = now()
where bank_no = 384;

update public.l4_workshop_questions
set grading_mode = 'multi_qualitative',
    question_type = 'multi_qualitative',
    answer_schema = '{"type":"multi_qualitative","parts":[{"key":"A1","unit":"","input":"text","label":"الأميتر A1"},{"key":"A2","unit":"","input":"text","label":"الأميتر A2"}]}'::jsonb,
    updated_at = now()
where bank_no = 392;

-- Private schemas are not Data API exposed, but RLS remains useful defense in depth.
alter table private.student_code_counters enable row level security;
alter table private.answer_image_cleanup_runs enable row level security;
alter table private.answer_image_review_tokens enable row level security;
alter table private.essay_grading_bundle_tokens enable row level security;
alter table private.essay_grading_artifact_keys enable row level security;

commit;
