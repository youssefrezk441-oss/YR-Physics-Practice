begin;

-- Independent second-term mistake workshop. This migration does not read, update,
-- delete or regrade any first-term table or historical student response.
do $$
begin
  if to_regclass('private.workshop_definitions') is null
     or to_regclass('private.workshop_attempt_events') is null
     or to_regclass('private.workshop_submission_answers') is null then
    raise exception 'unified workshop schema is required before ch2 mistake tracking';
  end if;
  if to_regprocedure('private.reject_history_mutation()') is null then
    raise exception 'immutable history guard is required before ch2 mistake tracking';
  end if;
end
$$;

create table if not exists private.ch2_mistake_source_policies (
  workshop_id uuid primary key references private.workshop_definitions(id) on delete restrict,
  source_contract text not null default 'unified_workshop_v1'
    check (source_contract = 'unified_workshop_v1'),
  enabled boolean not null default true,
  enabled_at timestamptz not null default now(),
  enabled_by uuid references auth.users(id) on delete restrict,
  notes text not null check (length(btrim(notes)) between 8 and 1000)
);

-- Review clicks are append-only organization events. They never prove mastery.
create table if not exists private.ch2_mistake_review_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  user_id uuid not null references auth.users(id) on delete restrict,
  mistake_ref text not null check (
    mistake_ref ~ '^(attempt:[0-9a-f-]{36}|submission:[0-9a-f-]{36}:[0-9a-f-]{36})$'
  ),
  workshop_id uuid not null references private.workshop_definitions(id) on delete restrict,
  version_id uuid not null references private.workshop_versions(id) on delete restrict,
  question_id uuid not null references private.workshop_questions(id) on delete restrict,
  part_id uuid not null references private.workshop_question_parts(id) on delete restrict,
  evidence_kind text not null check (evidence_kind in ('interactive_first_attempt', 'final_submission_wrong')),
  reviewed_at timestamptz not null default now(),
  unique (user_id, request_id),
  foreign key (workshop_id, version_id)
    references private.workshop_versions(workshop_id, id) on delete restrict,
  foreign key (version_id, question_id)
    references private.workshop_questions(version_id, id) on delete restrict,
  foreign key (question_id, part_id)
    references private.workshop_question_parts(question_id, id) on delete restrict
);
create index if not exists ch2_mistake_reviews_user_ref_time_idx
  on private.ch2_mistake_review_events(user_id, mistake_ref, reviewed_at, id);

-- Every independent retry is preserved. A correct row establishes current mastery,
-- but never removes the original evidence or review history.
create table if not exists private.ch2_mistake_mastery_attempts (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  user_id uuid not null references auth.users(id) on delete restrict,
  mistake_ref text not null check (
    mistake_ref ~ '^(attempt:[0-9a-f-]{36}|submission:[0-9a-f-]{36}:[0-9a-f-]{36})$'
  ),
  workshop_id uuid not null references private.workshop_definitions(id) on delete restrict,
  version_id uuid not null references private.workshop_versions(id) on delete restrict,
  question_id uuid not null references private.workshop_questions(id) on delete restrict,
  part_id uuid not null references private.workshop_question_parts(id) on delete restrict,
  attempt_no integer not null check (attempt_no > 0),
  answer_json jsonb not null check (jsonb_typeof(answer_json) = 'object'),
  normalized_answer text not null check (length(normalized_answer) between 1 and 1000),
  key_version_id uuid not null references private.workshop_part_key_versions(id) on delete restrict,
  is_correct boolean not null,
  attempted_at timestamptz not null default now(),
  unique (user_id, request_id),
  unique (user_id, mistake_ref, attempt_no),
  foreign key (workshop_id, version_id)
    references private.workshop_versions(workshop_id, id) on delete restrict,
  foreign key (version_id, question_id)
    references private.workshop_questions(version_id, id) on delete restrict,
  foreign key (question_id, part_id)
    references private.workshop_question_parts(question_id, id) on delete restrict,
  foreign key (part_id, key_version_id)
    references private.workshop_part_key_versions(part_id, id) on delete restrict
);
create index if not exists ch2_mistake_mastery_user_ref_time_idx
  on private.ch2_mistake_mastery_attempts(user_id, mistake_ref, attempted_at, id);
create index if not exists ch2_mistake_mastery_correct_idx
  on private.ch2_mistake_mastery_attempts(user_id, mistake_ref, attempted_at)
  where is_correct = true;

-- One safe contract for every published second-term unified workshop. Future class
-- workshops and electronic homework appear automatically after enabling one policy row.
create or replace view private.ch2_verified_mistake_evidence
with (security_invoker = true)
as
select
  ('attempt:' || event.id::text) as mistake_ref,
  'interactive_first_attempt'::text as evidence_kind,
  event.id::text as source_ref,
  cycle.user_id,
  definition.id as workshop_id,
  question.version_id,
  definition.slug as workshop_slug,
  definition.title as workshop_title,
  definition.lecture_no,
  definition.eligible_group_codes,
  track.id as track_id,
  track.track_key,
  track.title as track_title,
  question.id as question_id,
  question.question_ref,
  question.source_ref as bank_source_ref,
  question.source_kind as question_source_kind,
  question.question_kind,
  question.title as question_title,
  question.prompt_text,
  question.image_path,
  question.image_sha256,
  question.skill_ref,
  skill.name as skill_name,
  question.difficulty,
  part.id as part_id,
  part.part_key,
  part.label as part_label,
  part.input_type,
  part.options_public,
  part.unit_text,
  part.max_points,
  part.public_config,
  event.key_version_id as original_key_version_id,
  event.server_received_at as original_wrong_at
from private.workshop_attempt_events event
join private.workshop_cycles cycle on cycle.id = event.cycle_id and cycle.source = 'initial'
join private.workshop_definitions definition on definition.id = cycle.workshop_id
join private.ch2_mistake_source_policies policy on policy.workshop_id = definition.id and policy.enabled
join private.workshop_tracks track on track.id = event.track_id and track.mode = 'interactive'
join private.workshop_questions question on question.id = event.question_id
join private.workshop_skills skill on skill.version_id = question.version_id and skill.skill_ref = question.skill_ref
join private.workshop_question_parts part on part.id = event.part_id and part.question_id = question.id
where definition.academic_term = 'second'
  and definition.status = 'published'
  and event.attempt_no = 1
  and event.is_correct = false
union all
select
  ('submission:' || submission.id::text || ':' || answer.part_id::text) as mistake_ref,
  'final_submission_wrong'::text as evidence_kind,
  (submission.id::text || ':' || answer.part_id::text) as source_ref,
  cycle.user_id,
  definition.id as workshop_id,
  question.version_id,
  definition.slug as workshop_slug,
  definition.title as workshop_title,
  definition.lecture_no,
  definition.eligible_group_codes,
  track.id as track_id,
  track.track_key,
  track.title as track_title,
  question.id as question_id,
  question.question_ref,
  question.source_ref as bank_source_ref,
  question.source_kind as question_source_kind,
  question.question_kind,
  question.title as question_title,
  question.prompt_text,
  question.image_path,
  question.image_sha256,
  question.skill_ref,
  skill.name as skill_name,
  question.difficulty,
  part.id as part_id,
  part.part_key,
  part.label as part_label,
  part.input_type,
  part.options_public,
  part.unit_text,
  part.max_points,
  part.public_config,
  answer.key_version_id as original_key_version_id,
  submission.submitted_at as original_wrong_at
from private.workshop_submission_answers answer
join private.workshop_submissions submission on submission.id = answer.submission_id
join private.workshop_cycles cycle on cycle.id = submission.cycle_id and cycle.source = 'initial'
join private.workshop_definitions definition on definition.id = cycle.workshop_id
join private.ch2_mistake_source_policies policy on policy.workshop_id = definition.id and policy.enabled
join private.workshop_tracks track on track.id = submission.track_id and track.mode = 'final_submit'
join private.workshop_questions question on question.id = answer.question_id
join private.workshop_skills skill on skill.version_id = question.version_id and skill.skill_ref = question.skill_ref
join private.workshop_question_parts part on part.id = answer.part_id and part.question_id = question.id
where definition.academic_term = 'second'
  and definition.status = 'published'
  and answer.is_correct = false;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'ch2_mistake_review_events',
    'ch2_mistake_mastery_attempts'
  ] loop
    execute format('drop trigger if exists %I on private.%I', 'reject_ch2_mistake_history_mutation', table_name);
    execute format(
      'create trigger %I before update or delete on private.%I for each row execute function private.reject_history_mutation()',
      'reject_ch2_mistake_history_mutation', table_name
    );
  end loop;
end
$$;

alter table private.ch2_mistake_source_policies enable row level security;
alter table private.ch2_mistake_review_events enable row level security;
alter table private.ch2_mistake_mastery_attempts enable row level security;

revoke all on private.ch2_mistake_source_policies from public, anon, authenticated;
revoke all on private.ch2_mistake_review_events from public, anon, authenticated;
revoke all on private.ch2_mistake_mastery_attempts from public, anon, authenticated;
revoke all on private.ch2_verified_mistake_evidence from public, anon, authenticated;

insert into private.ch2_mistake_source_policies(workshop_id, enabled, notes)
select id, true, 'Enable verified mistake evidence for the published second-term lecture-one workshop.'
from private.workshop_definitions
where slug = 'third-secondary-term-2-lecture-1'
  and academic_term = 'second'
on conflict (workshop_id) do nothing;

comment on table private.ch2_mistake_source_policies is
  'Explicit opt-in for unified second-term workshops; no first-term source is permitted.';
comment on table private.ch2_mistake_review_events is
  'Append-only review history. A review click is never evidence of mastery.';
comment on table private.ch2_mistake_mastery_attempts is
  'Append-only independent retry history graded server-side without exposing answer keys.';
comment on view private.ch2_verified_mistake_evidence is
  'Verified wrong evidence only: first interactive attempt or immutable wrong final submission.';

commit;
