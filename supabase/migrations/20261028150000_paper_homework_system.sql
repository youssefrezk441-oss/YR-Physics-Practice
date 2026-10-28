begin;

-- Generic paper-homework answer capture for published unified content. This migration
-- is additive and does not update, delete, reset or regrade an existing student record.
do $$
begin
  if to_regclass('private.workshop_definitions') is null
     or to_regclass('private.workshop_question_parts') is null
     or to_regclass('private.workshop_part_key_versions') is null
     or to_regclass('private.ch2_mistake_source_policies') is null
     or to_regprocedure('private.reject_history_mutation()') is null then
    raise exception 'unified workshop and second-term mistake schemas are required';
  end if;
end
$$;

create table if not exists private.homework_delivery_policies (
  workshop_id uuid primary key references private.workshop_definitions(id) on delete restrict,
  delivery_contract text not null default 'paper_homework_capture_v1'
    check (delivery_contract = 'paper_homework_capture_v1'),
  enabled boolean not null default false,
  allow_unanswered boolean not null default true,
  essay_self_review boolean not null default true,
  enabled_at timestamptz,
  enabled_by uuid references auth.users(id) on delete restrict,
  notes text not null check (length(btrim(notes)) between 8 and 1000),
  check ((enabled and enabled_at is not null) or (not enabled))
);

create table if not exists private.homework_attempts (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references private.workshop_definitions(id) on delete restrict,
  version_id uuid not null references private.workshop_versions(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft', 'submitted')),
  opened_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  submitted_at timestamptz,
  unique (workshop_id, user_id),
  foreign key (workshop_id, version_id)
    references private.workshop_versions(workshop_id, id) on delete restrict,
  check ((status = 'submitted') = (submitted_at is not null))
);
create index if not exists homework_attempts_user_time_idx
  on private.homework_attempts(user_id, opened_at desc, id);

create table if not exists private.homework_draft_answers (
  attempt_id uuid not null references private.homework_attempts(id) on delete restrict,
  question_id uuid not null references private.workshop_questions(id) on delete restrict,
  part_id uuid not null references private.workshop_question_parts(id) on delete restrict,
  answer_state text not null check (answer_state in ('answered', 'unanswered')),
  answer_json jsonb,
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  primary key (attempt_id, part_id),
  foreign key (question_id, part_id)
    references private.workshop_question_parts(question_id, id) on delete restrict,
  check (
    (answer_state = 'answered' and answer_json is not null and jsonb_typeof(answer_json) = 'object')
    or (answer_state = 'unanswered' and answer_json is null)
  )
);

create table if not exists private.homework_answer_images (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  attempt_id uuid not null references private.homework_attempts(id) on delete restrict,
  question_id uuid not null references private.workshop_questions(id) on delete restrict,
  object_path text not null unique check (length(btrim(object_path)) between 20 and 1000),
  mime_type text not null check (mime_type in ('image/webp', 'image/jpeg')),
  size_bytes integer not null check (size_bytes between 1 and 409600),
  image_sha256 text not null check (image_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  unique (attempt_id, request_id)
);
create index if not exists homework_answer_images_attempt_question_idx
  on private.homework_answer_images(attempt_id, question_id, created_at, id)
  where removed_at is null;

create table if not exists private.homework_submissions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  attempt_id uuid not null unique references private.homework_attempts(id) on delete restrict,
  workshop_id uuid not null references private.workshop_definitions(id) on delete restrict,
  version_id uuid not null references private.workshop_versions(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  mcq_score numeric(10,4) not null check (mcq_score >= 0),
  mcq_max_score numeric(10,4) not null check (mcq_max_score >= 0 and mcq_score <= mcq_max_score),
  answered_parts integer not null check (answered_parts >= 0),
  unanswered_parts integer not null check (unanswered_parts >= 0),
  submitted_at timestamptz not null default now(),
  unique (user_id, request_id),
  foreign key (workshop_id, version_id)
    references private.workshop_versions(workshop_id, id) on delete restrict
);
create index if not exists homework_submissions_workshop_time_idx
  on private.homework_submissions(workshop_id, submitted_at desc, id);

create table if not exists private.homework_submission_answers (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references private.homework_submissions(id) on delete restrict,
  question_id uuid not null references private.workshop_questions(id) on delete restrict,
  part_id uuid not null references private.workshop_question_parts(id) on delete restrict,
  response_kind text not null check (response_kind in ('auto_mcq', 'essay_self_review')),
  answer_state text not null check (answer_state in ('answered', 'unanswered')),
  answer_json jsonb,
  normalized_answer text,
  key_version_id uuid not null references private.workshop_part_key_versions(id) on delete restrict,
  is_correct boolean,
  awarded_points numeric(10,4) not null check (awarded_points >= 0),
  max_points numeric(10,4) not null check (max_points > 0 and awarded_points <= max_points),
  created_at timestamptz not null default now(),
  unique (submission_id, part_id),
  foreign key (question_id, part_id)
    references private.workshop_question_parts(question_id, id) on delete restrict,
  foreign key (part_id, key_version_id)
    references private.workshop_part_key_versions(part_id, id) on delete restrict,
  check (
    (answer_state = 'answered' and answer_json is not null and jsonb_typeof(answer_json) = 'object')
    or (answer_state = 'unanswered' and answer_json is null and normalized_answer is null)
  ),
  check (
    (response_kind = 'auto_mcq' and (
      (answer_state = 'answered' and is_correct is not null)
      or (answer_state = 'unanswered' and is_correct is null)
    ))
    or (response_kind = 'essay_self_review' and is_correct is null)
  ),
  check (answer_state = 'answered' or awarded_points = 0)
);
create index if not exists homework_submission_answers_question_idx
  on private.homework_submission_answers(question_id, answer_state, is_correct);

create table if not exists private.homework_self_review_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  user_id uuid not null references auth.users(id) on delete restrict,
  submission_answer_id uuid not null unique references private.homework_submission_answers(id) on delete restrict,
  assessment text not null check (assessment in ('correct', 'partial', 'incorrect', 'unanswered')),
  reviewed_at timestamptz not null default now(),
  unique (user_id, request_id)
);
create index if not exists homework_self_review_user_time_idx
  on private.homework_self_review_events(user_id, reviewed_at desc, id);

create table if not exists private.homework_mutation_receipts (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  user_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (length(action) between 1 and 80),
  body_sha256 text not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
  response_json jsonb not null check (jsonb_typeof(response_json) = 'object'),
  created_at timestamptz not null default now(),
  unique (user_id, request_id)
);

-- Essay mastery is never inferred by comparing free text. The student first stores a
-- new independent answer, then sees the model steps and locks a separate self-review.
create table if not exists private.ch2_essay_mastery_retries (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  user_id uuid not null references auth.users(id) on delete restrict,
  mistake_ref text not null check (mistake_ref ~ '^homework-review:[0-9a-f-]{36}$'),
  workshop_id uuid not null references private.workshop_definitions(id) on delete restrict,
  version_id uuid not null references private.workshop_versions(id) on delete restrict,
  question_id uuid not null references private.workshop_questions(id) on delete restrict,
  part_id uuid not null references private.workshop_question_parts(id) on delete restrict,
  answer_json jsonb not null check (jsonb_typeof(answer_json) = 'object'),
  key_version_id uuid not null references private.workshop_part_key_versions(id) on delete restrict,
  attempted_at timestamptz not null default now(),
  unique (user_id, request_id),
  foreign key (workshop_id, version_id) references private.workshop_versions(workshop_id, id) on delete restrict,
  foreign key (version_id, question_id) references private.workshop_questions(version_id, id) on delete restrict,
  foreign key (question_id, part_id) references private.workshop_question_parts(question_id, id) on delete restrict,
  foreign key (part_id, key_version_id) references private.workshop_part_key_versions(part_id, id) on delete restrict
);

create table if not exists private.ch2_essay_mastery_reviews (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  user_id uuid not null references auth.users(id) on delete restrict,
  retry_id uuid not null unique references private.ch2_essay_mastery_retries(id) on delete restrict,
  assessment text not null check (assessment in ('correct', 'partial', 'incorrect')),
  reviewed_at timestamptz not null default now(),
  unique (user_id, request_id)
);

do $$
begin
  alter table private.ch2_mistake_source_policies drop constraint if exists ch2_mistake_source_policies_source_contract_check;
  alter table private.ch2_mistake_source_policies drop constraint if exists ch2_mistake_source_contract_v2_check;
  alter table private.ch2_mistake_source_policies add constraint ch2_mistake_source_contract_v2_check
    check (source_contract in ('unified_workshop_v1', 'paper_homework_capture_v1'));
  if to_regclass('private.ch2_mistake_review_events') is not null then
    alter table private.ch2_mistake_review_events drop constraint if exists ch2_mistake_review_events_mistake_ref_check;
    alter table private.ch2_mistake_review_events drop constraint if exists ch2_mistake_review_events_evidence_kind_check;
    alter table private.ch2_mistake_review_events drop constraint if exists ch2_mistake_review_ref_v2_check;
    alter table private.ch2_mistake_review_events drop constraint if exists ch2_mistake_review_kind_v2_check;
    alter table private.ch2_mistake_review_events add constraint ch2_mistake_review_ref_v2_check check (
      mistake_ref ~ '^(attempt:[0-9a-f-]{36}|submission:[0-9a-f-]{36}:[0-9a-f-]{36}|homework:[0-9a-f-]{36}|homework-review:[0-9a-f-]{36})$'
    );
    alter table private.ch2_mistake_review_events add constraint ch2_mistake_review_kind_v2_check check (
      evidence_kind in ('interactive_first_attempt', 'final_submission_wrong', 'paper_homework_wrong', 'paper_homework_essay_self_review')
    );
  end if;
  if to_regclass('private.ch2_mistake_mastery_attempts') is not null then
    alter table private.ch2_mistake_mastery_attempts drop constraint if exists ch2_mistake_mastery_attempts_mistake_ref_check;
    alter table private.ch2_mistake_mastery_attempts drop constraint if exists ch2_mistake_mastery_ref_v2_check;
    alter table private.ch2_mistake_mastery_attempts add constraint ch2_mistake_mastery_ref_v2_check check (
      mistake_ref ~ '^(attempt:[0-9a-f-]{36}|submission:[0-9a-f-]{36}:[0-9a-f-]{36}|homework:[0-9a-f-]{36})$'
    );
  end if;
end
$$;

create or replace view private.ch2_paper_homework_mistake_evidence
with (security_invoker = true)
as
select
  ('homework:' || answer.id::text) as mistake_ref,
  'paper_homework_wrong'::text as evidence_kind,
  answer.id::text as source_ref,
  submission.user_id, definition.id as workshop_id, answer_submission.version_id,
  definition.slug as workshop_slug, definition.title as workshop_title, definition.lecture_no,
  definition.eligible_group_codes, track.id as track_id, track.track_key, track.title as track_title,
  question.id as question_id, question.question_ref, question.source_ref as bank_source_ref,
  question.source_kind as question_source_kind, question.question_kind, question.title as question_title,
  question.prompt_text, question.image_path, question.image_sha256, question.skill_ref,
  skill.name as skill_name, question.difficulty, part.id as part_id, part.part_key,
  part.label as part_label, part.input_type, part.options_public, part.unit_text,
  part.max_points, part.public_config, answer.key_version_id as original_key_version_id,
  submission.submitted_at as original_wrong_at
from private.homework_submission_answers answer
join private.homework_submissions submission on submission.id = answer.submission_id
join private.homework_attempts answer_submission on answer_submission.id = submission.attempt_id
join private.workshop_definitions definition on definition.id = submission.workshop_id
join private.ch2_mistake_source_policies policy on policy.workshop_id = definition.id and policy.enabled
join private.workshop_tracks track on track.version_id = submission.version_id and track.track_key = 'home'
join private.workshop_questions question on question.id = answer.question_id
join private.workshop_skills skill on skill.version_id = question.version_id and skill.skill_ref = question.skill_ref
join private.workshop_question_parts part on part.id = answer.part_id
where definition.academic_term = 'second' and definition.status in ('published', 'paused', 'archived')
  and answer.response_kind = 'auto_mcq' and answer.answer_state = 'answered' and answer.is_correct = false
union all
select
  ('homework-review:' || review.id::text) as mistake_ref,
  'paper_homework_essay_self_review'::text as evidence_kind,
  review.id::text as source_ref,
  submission.user_id, definition.id as workshop_id, answer_submission.version_id,
  definition.slug as workshop_slug, definition.title as workshop_title, definition.lecture_no,
  definition.eligible_group_codes, track.id as track_id, track.track_key, track.title as track_title,
  question.id as question_id, question.question_ref, question.source_ref as bank_source_ref,
  question.source_kind as question_source_kind, question.question_kind, question.title as question_title,
  question.prompt_text, question.image_path, question.image_sha256, question.skill_ref,
  skill.name as skill_name, question.difficulty, part.id as part_id, part.part_key,
  part.label as part_label, part.input_type, part.options_public, part.unit_text,
  part.max_points, part.public_config, answer.key_version_id as original_key_version_id,
  review.reviewed_at as original_wrong_at
from private.homework_self_review_events review
join private.homework_submission_answers answer on answer.id = review.submission_answer_id
join private.homework_submissions submission on submission.id = answer.submission_id
join private.homework_attempts answer_submission on answer_submission.id = submission.attempt_id
join private.workshop_definitions definition on definition.id = submission.workshop_id
join private.ch2_mistake_source_policies policy on policy.workshop_id = definition.id and policy.enabled
join private.workshop_tracks track on track.version_id = submission.version_id and track.track_key = 'home'
join private.workshop_questions question on question.id = answer.question_id
join private.workshop_skills skill on skill.version_id = question.version_id and skill.skill_ref = question.skill_ref
join private.workshop_question_parts part on part.id = answer.part_id
where definition.academic_term = 'second' and definition.status in ('published', 'paused', 'archived')
  and answer.response_kind = 'essay_self_review' and review.assessment in ('partial', 'incorrect');

create or replace function private.guard_homework_attempt_history()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'homework attempts are retained'
      using errcode = '55000';
  end if;
  if old.status = 'submitted' then
    raise exception 'submitted homework attempt is immutable'
      using errcode = '55000';
  end if;
  if new.id <> old.id or new.workshop_id <> old.workshop_id or new.version_id <> old.version_id
     or new.user_id <> old.user_id or new.opened_at <> old.opened_at then
    raise exception 'homework attempt identity is immutable'
      using errcode = '55000';
  end if;
  if new.status = 'draft' and new.submitted_at is null then return new; end if;
  if new.status = 'submitted' and new.submitted_at is not null then return new; end if;
  raise exception 'invalid homework attempt transition'
    using errcode = '55000';
end
$$;

create or replace function private.guard_homework_draft_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  target_attempt uuid;
begin
  target_attempt := case when tg_op = 'DELETE' then old.attempt_id else new.attempt_id end;
  if exists (select 1 from private.homework_attempts where id = target_attempt and status = 'submitted') then
    raise exception 'submitted homework answers are immutable'
      using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;

drop trigger if exists guard_homework_attempt_history on private.homework_attempts;
create trigger guard_homework_attempt_history
before update or delete on private.homework_attempts
for each row execute function private.guard_homework_attempt_history();

drop trigger if exists guard_homework_drafts on private.homework_draft_answers;
create trigger guard_homework_drafts
before update or delete on private.homework_draft_answers
for each row execute function private.guard_homework_draft_mutation();

drop trigger if exists guard_homework_images on private.homework_answer_images;
create trigger guard_homework_images
before update or delete on private.homework_answer_images
for each row execute function private.guard_homework_draft_mutation();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'homework_submissions',
    'homework_submission_answers',
    'homework_self_review_events',
    'homework_mutation_receipts',
    'ch2_essay_mastery_retries',
    'ch2_essay_mastery_reviews'
  ] loop
    execute format('drop trigger if exists %I on private.%I', 'reject_homework_history_mutation', table_name);
    execute format(
      'create trigger %I before update or delete on private.%I for each row execute function private.reject_history_mutation()',
      'reject_homework_history_mutation', table_name
    );
  end loop;
end
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'homework_delivery_policies', 'homework_attempts', 'homework_draft_answers',
    'homework_answer_images', 'homework_submissions', 'homework_submission_answers',
    'homework_self_review_events', 'homework_mutation_receipts',
    'ch2_essay_mastery_retries', 'ch2_essay_mastery_reviews'
  ] loop
    execute format('alter table private.%I enable row level security', table_name);
    execute format('revoke all on private.%I from public, anon, authenticated', table_name);
  end loop;
end
$$;

revoke all on private.ch2_paper_homework_mistake_evidence from public, anon, authenticated;

revoke all on function private.guard_homework_attempt_history() from public, anon, authenticated;
revoke all on function private.guard_homework_draft_mutation() from public, anon, authenticated;

-- Signed uploads are issued by the authenticated Edge Function. No direct public policy is added.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('homework-answer-images', 'homework-answer-images', false, 409600, array['image/webp', 'image/jpeg'])
on conflict (id) do nothing;

comment on table private.homework_submission_answers is
  'Immutable original paper-homework answers; unanswered is distinct from an incorrect answer.';
comment on table private.homework_self_review_events is
  'One locked self-assessment per essay part after final submission.';

commit;
