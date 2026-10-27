begin;

-- Additive schema for the second-term unified workshop engine. It does not touch
-- L3/L4/L5/L6 tables or any existing student record. Apply to anonymized staging first.
create schema if not exists private;

create table if not exists private.workshop_definitions (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  title text not null check (length(btrim(title)) between 3 and 300),
  grade_level text not null check (length(btrim(grade_level)) between 1 and 100),
  academic_term text not null check (academic_term in ('first', 'second', 'year_round')),
  lecture_no integer not null check (lecture_no > 0),
  status text not null default 'draft' check (status in ('draft', 'published', 'paused', 'archived')),
  active_version_id uuid,
  eligible_group_codes jsonb not null default '[]'::jsonb check (jsonb_typeof(eligible_group_codes) = 'array'),
  created_at timestamptz not null default now(),
  created_by uuid
);

create table if not exists private.workshop_versions (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references private.workshop_definitions(id) on delete restrict,
  version_no integer not null check (version_no > 0),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  source_label text not null check (length(btrim(source_label)) between 1 and 500),
  status text not null default 'draft' check (status in ('draft', 'validated', 'published', 'retired')),
  validation_report jsonb not null default '{}'::jsonb check (jsonb_typeof(validation_report) = 'object'),
  created_at timestamptz not null default now(),
  created_by uuid,
  published_at timestamptz,
  published_by uuid,
  unique (workshop_id, version_no),
  unique (workshop_id, content_sha256),
  unique (workshop_id, id),
  check (
    (status in ('draft', 'validated') and published_at is null)
    or (status in ('published', 'retired') and published_at is not null)
  )
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'workshop_definitions_active_version_fk') then
    alter table private.workshop_definitions
      add constraint workshop_definitions_active_version_fk
      foreign key (id, active_version_id)
      references private.workshop_versions(workshop_id, id) on delete restrict;
  end if;
end
$$;

create table if not exists private.workshop_tracks (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references private.workshop_versions(id) on delete restrict,
  track_key text not null check (track_key in ('class', 'home')),
  title text not null check (length(btrim(title)) between 1 and 200),
  mode text not null check (mode in ('interactive', 'final_submit')),
  sort_order integer not null check (sort_order > 0),
  policy jsonb not null check (jsonb_typeof(policy) = 'object'),
  unique (version_id, track_key),
  unique (version_id, sort_order),
  unique (version_id, id)
);

create table if not exists private.workshop_skills (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references private.workshop_versions(id) on delete restrict,
  skill_ref text not null check (length(btrim(skill_ref)) between 1 and 80),
  name text not null check (length(btrim(name)) between 1 and 300),
  parent_skill_ref text,
  sort_order integer not null check (sort_order > 0),
  unique (version_id, skill_ref),
  unique (version_id, id)
);

create table if not exists private.workshop_questions (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references private.workshop_versions(id) on delete restrict,
  question_ref text not null check (length(btrim(question_ref)) between 1 and 120),
  source_ref text,
  source_kind text not null check (source_kind in ('original_bank_image', 'authored_concept')),
  question_kind text not null check (question_kind in ('image', 'concept')),
  title text not null check (length(btrim(title)) between 1 and 300),
  prompt_text text,
  image_path text,
  image_sha256 text check (image_sha256 is null or image_sha256 ~ '^[0-9a-f]{64}$'),
  skill_ref text not null,
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  active boolean not null default true,
  unique (version_id, question_ref),
  unique (version_id, id),
  foreign key (version_id, skill_ref)
    references private.workshop_skills(version_id, skill_ref) on delete restrict,
  check (
    (question_kind = 'image' and image_path is not null and image_sha256 is not null)
    or (question_kind = 'concept' and prompt_text is not null and image_path is null and image_sha256 is null)
  )
);

create table if not exists private.workshop_track_questions (
  version_id uuid not null,
  track_id uuid not null,
  question_id uuid not null,
  sort_order integer not null check (sort_order > 0),
  primary key (track_id, question_id),
  unique (track_id, sort_order),
  foreign key (version_id, track_id)
    references private.workshop_tracks(version_id, id) on delete restrict,
  foreign key (version_id, question_id)
    references private.workshop_questions(version_id, id) on delete restrict
);

create table if not exists private.workshop_question_parts (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null,
  question_id uuid not null,
  part_key text not null check (length(btrim(part_key)) between 1 and 80),
  label text not null check (length(btrim(label)) between 1 and 300),
  input_type text not null check (input_type in ('mcq', 'numeric', 'text', 'symbolic')),
  options_public jsonb not null default '[]'::jsonb check (jsonb_typeof(options_public) = 'array'),
  unit_text text,
  max_points numeric(10,4) not null default 1 check (max_points > 0),
  public_config jsonb not null default '{}'::jsonb check (jsonb_typeof(public_config) = 'object'),
  sort_order integer not null check (sort_order > 0),
  unique (question_id, part_key),
  unique (question_id, sort_order),
  unique (question_id, id),
  foreign key (version_id, question_id)
    references private.workshop_questions(version_id, id) on delete restrict,
  check ((input_type = 'mcq' and jsonb_array_length(options_public) between 2 and 8) or input_type <> 'mcq')
);

-- Keys are immutable versions. A correction is activated by a second administrator;
-- no old key or grading decision is overwritten.
create table if not exists private.workshop_part_key_versions (
  id uuid primary key default gen_random_uuid(),
  part_id uuid not null references private.workshop_question_parts(id) on delete restrict,
  version_no integer not null check (version_no > 0),
  answer_spec jsonb not null check (jsonb_typeof(answer_spec) = 'object'),
  display_answer text not null check (length(btrim(display_answer)) between 1 and 2000),
  feedback_hint text,
  explanation text,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  change_reason text not null check (length(btrim(change_reason)) between 8 and 2000),
  source_kind text not null check (source_kind in ('initial_import', 'approved_correction')),
  created_at timestamptz not null default now(),
  created_by uuid,
  unique (part_id, version_no),
  unique (part_id, content_sha256),
  unique (part_id, id)
);

create table if not exists private.workshop_part_key_activations (
  id uuid primary key default gen_random_uuid(),
  part_id uuid not null references private.workshop_question_parts(id) on delete restrict,
  key_version_id uuid not null,
  previous_key_version_id uuid,
  activation_kind text not null check (activation_kind in ('initial_import', 'approved_correction')),
  activation_reason text not null check (length(btrim(activation_reason)) between 8 and 2000),
  activated_at timestamptz not null default now(),
  activated_by uuid,
  approved_by uuid,
  foreign key (part_id, key_version_id)
    references private.workshop_part_key_versions(part_id, id) on delete restrict,
  foreign key (part_id, previous_key_version_id)
    references private.workshop_part_key_versions(part_id, id) on delete restrict,
  check (previous_key_version_id is null or previous_key_version_id <> key_version_id),
  check (
    (activation_kind = 'initial_import' and previous_key_version_id is null)
    or (activation_kind = 'approved_correction' and previous_key_version_id is not null
        and activated_by is not null and approved_by is not null and activated_by <> approved_by)
  )
);
create index if not exists workshop_key_activations_current_idx
  on private.workshop_part_key_activations(part_id, activated_at desc, id desc);

create table if not exists private.workshop_cycles (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references private.workshop_definitions(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  cycle_no integer not null check (cycle_no > 0),
  source text not null check (source in ('initial', 'admin_reopen')),
  scope_kind text not null check (scope_kind in ('workshop', 'track', 'question')),
  scope_ref text,
  status text not null default 'open' check (status in ('open', 'submitted', 'closed')),
  opened_at timestamptz not null default now(),
  opened_by uuid,
  opened_reason text not null check (length(btrim(opened_reason)) between 8 and 2000),
  closed_at timestamptz,
  unique (workshop_id, user_id, cycle_no),
  unique (workshop_id, user_id, id),
  check ((scope_kind = 'workshop' and scope_ref is null) or (scope_kind <> 'workshop' and scope_ref is not null)),
  check ((status = 'closed') = (closed_at is not null))
);
create unique index if not exists workshop_cycles_one_open_uq
  on private.workshop_cycles(workshop_id, user_id) where status = 'open';

create table if not exists private.workshop_mutation_receipts (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  user_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (length(action) between 1 and 80),
  body_sha256 text not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
  response_json jsonb not null check (jsonb_typeof(response_json) = 'object'),
  created_at timestamptz not null default now(),
  unique (user_id, request_id)
);

create table if not exists private.workshop_progress (
  cycle_id uuid not null references private.workshop_cycles(id) on delete restrict,
  track_id uuid not null references private.workshop_tracks(id) on delete restrict,
  part_id uuid not null references private.workshop_question_parts(id) on delete restrict,
  revision integer not null default 0 check (revision >= 0),
  attempts_count integer not null default 0 check (attempts_count >= 0),
  tried_answers jsonb not null default '[]'::jsonb check (jsonb_typeof(tried_answers) = 'array'),
  first_attempt_correct boolean,
  independently_mastered boolean not null default false,
  assisted boolean not null default false,
  revealed boolean not null default false,
  last_answer jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (cycle_id, track_id, part_id),
  check (not (independently_mastered and (assisted or revealed))),
  check (last_answer is null or jsonb_typeof(last_answer) = 'object')
);

create table if not exists private.workshop_attempt_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  cycle_id uuid not null references private.workshop_cycles(id) on delete restrict,
  track_id uuid not null references private.workshop_tracks(id) on delete restrict,
  question_id uuid not null references private.workshop_questions(id) on delete restrict,
  part_id uuid not null references private.workshop_question_parts(id) on delete restrict,
  attempt_no integer not null check (attempt_no > 0),
  answer_json jsonb not null check (jsonb_typeof(answer_json) = 'object'),
  normalized_answer text not null,
  key_version_id uuid not null references private.workshop_part_key_versions(id) on delete restrict,
  is_correct boolean not null,
  outcome text not null check (outcome in ('incorrect', 'first_try', 'later_independent', 'assisted')),
  awarded_points numeric(10,4) not null check (awarded_points >= 0),
  max_points numeric(10,4) not null check (max_points > 0 and awarded_points <= max_points),
  server_received_at timestamptz not null default now(),
  unique (cycle_id, track_id, part_id, attempt_no)
);
create index if not exists workshop_attempt_events_student_time_idx
  on private.workshop_attempt_events(cycle_id, server_received_at, id);
create index if not exists workshop_attempt_events_part_time_idx
  on private.workshop_attempt_events(part_id, server_received_at, id);

create table if not exists private.workshop_reveal_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  cycle_id uuid not null references private.workshop_cycles(id) on delete restrict,
  track_id uuid not null references private.workshop_tracks(id) on delete restrict,
  question_id uuid not null references private.workshop_questions(id) on delete restrict,
  part_id uuid not null references private.workshop_question_parts(id) on delete restrict,
  key_version_id uuid not null references private.workshop_part_key_versions(id) on delete restrict,
  revealed_at timestamptz not null default now(),
  unique (cycle_id, track_id, part_id)
);

create table if not exists private.workshop_drafts (
  cycle_id uuid not null references private.workshop_cycles(id) on delete restrict,
  track_id uuid not null references private.workshop_tracks(id) on delete restrict,
  part_id uuid not null references private.workshop_question_parts(id) on delete restrict,
  answer_json jsonb not null check (jsonb_typeof(answer_json) = 'object'),
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  primary key (cycle_id, track_id, part_id)
);

create table if not exists private.workshop_submissions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  cycle_id uuid not null references private.workshop_cycles(id) on delete restrict,
  track_id uuid not null references private.workshop_tracks(id) on delete restrict,
  score numeric(12,4) not null check (score >= 0),
  max_score numeric(12,4) not null check (max_score > 0 and score <= max_score),
  submitted_at timestamptz not null default now(),
  unique (cycle_id, track_id)
);

create table if not exists private.workshop_submission_answers (
  submission_id uuid not null references private.workshop_submissions(id) on delete restrict,
  question_id uuid not null references private.workshop_questions(id) on delete restrict,
  part_id uuid not null references private.workshop_question_parts(id) on delete restrict,
  answer_json jsonb,
  normalized_answer text,
  key_version_id uuid not null references private.workshop_part_key_versions(id) on delete restrict,
  is_correct boolean not null,
  awarded_points numeric(10,4) not null check (awarded_points >= 0),
  max_points numeric(10,4) not null check (max_points > 0 and awarded_points <= max_points),
  primary key (submission_id, part_id),
  check (answer_json is null or jsonb_typeof(answer_json) = 'object')
);

create table if not exists private.workshop_grading_decisions (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references private.workshop_cycles(id) on delete restrict,
  part_id uuid not null references private.workshop_question_parts(id) on delete restrict,
  response_ref text not null check (length(btrim(response_ref)) between 1 and 300),
  answer_snapshot jsonb,
  key_version_id uuid not null references private.workshop_part_key_versions(id) on delete restrict,
  is_correct boolean not null,
  awarded_points numeric(10,4) not null check (awarded_points >= 0),
  max_points numeric(10,4) not null check (max_points > 0 and awarded_points <= max_points),
  decision_kind text not null check (decision_kind in ('automatic_attempt', 'automatic_submission', 'approved_regrade')),
  supersedes_decision_id uuid,
  reason text not null check (length(btrim(reason)) between 1 and 2000),
  created_at timestamptz not null default now(),
  created_by uuid,
  unique (part_id, response_ref, id),
  foreign key (part_id, response_ref, supersedes_decision_id)
    references private.workshop_grading_decisions(part_id, response_ref, id) on delete restrict,
  check (supersedes_decision_id is null or supersedes_decision_id <> id)
);
create unique index if not exists workshop_grading_superseded_once_uq
  on private.workshop_grading_decisions(supersedes_decision_id)
  where supersedes_decision_id is not null;

create table if not exists private.workshop_admin_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  student_user_id uuid references auth.users(id) on delete restrict,
  workshop_id uuid references private.workshop_definitions(id) on delete restrict,
  action text not null check (action in ('reopen_question', 'reopen_track', 'reopen_workshop', 'key_version_created', 'key_preview_created', 'key_approved', 'regrade_started', 'regrade_completed', 'regrade_failed')),
  scope_ref text,
  reason text not null check (length(btrim(reason)) between 8 and 2000),
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default now(),
  check (before_state is null or jsonb_typeof(before_state) = 'object'),
  check (after_state is null or jsonb_typeof(after_state) = 'object')
);

create table if not exists private.workshop_regrade_previews (
  id uuid primary key default gen_random_uuid(),
  part_id uuid not null references private.workshop_question_parts(id) on delete restrict,
  from_key_version_id uuid not null references private.workshop_part_key_versions(id) on delete restrict,
  to_key_version_id uuid not null references private.workshop_part_key_versions(id) on delete restrict,
  requested_reason text not null check (length(btrim(requested_reason)) between 8 and 2000),
  summary jsonb not null check (jsonb_typeof(summary) = 'object'),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  expires_at timestamptz not null,
  check (from_key_version_id <> to_key_version_id and expires_at > created_at)
);

create table if not exists private.workshop_regrade_preview_items (
  preview_id uuid not null references private.workshop_regrade_previews(id) on delete restrict,
  previous_decision_id uuid not null references private.workshop_grading_decisions(id) on delete restrict,
  proposed_correct boolean not null,
  proposed_points numeric(10,4) not null,
  primary key (preview_id, previous_decision_id)
);

create table if not exists private.workshop_regrade_approvals (
  id uuid primary key default gen_random_uuid(),
  preview_id uuid not null unique references private.workshop_regrade_previews(id) on delete restrict,
  approved_by uuid not null references auth.users(id) on delete restrict,
  approval_reason text not null check (length(btrim(approval_reason)) between 8 and 2000),
  expected_summary jsonb not null check (jsonb_typeof(expected_summary) = 'object'),
  approved_at timestamptz not null default now()
);

create table if not exists private.workshop_regrade_execution_events (
  id uuid primary key default gen_random_uuid(),
  approval_id uuid not null references private.workshop_regrade_approvals(id) on delete restrict,
  event_type text not null check (event_type in ('started', 'completed', 'failed')),
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  recorded_at timestamptz not null default now(),
  recorded_by uuid not null references auth.users(id) on delete restrict
);

create or replace view private.current_workshop_part_keys as
select distinct on (activation.part_id)
  activation.part_id,
  activation.key_version_id,
  version.answer_spec,
  version.display_answer,
  version.feedback_hint,
  version.explanation,
  version.version_no,
  activation.activated_at
from private.workshop_part_key_activations activation
join private.workshop_part_key_versions version on version.id = activation.key_version_id
order by activation.part_id, activation.activated_at desc, activation.id desc;

create or replace view private.current_workshop_grading_decisions as
select distinct on (decision.part_id, decision.response_ref) decision.*
from private.workshop_grading_decisions decision
order by decision.part_id, decision.response_ref, decision.created_at desc, decision.id desc;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'workshop_part_key_versions',
    'workshop_part_key_activations',
    'workshop_mutation_receipts',
    'workshop_attempt_events',
    'workshop_reveal_events',
    'workshop_submissions',
    'workshop_submission_answers',
    'workshop_grading_decisions',
    'workshop_admin_events',
    'workshop_regrade_previews',
    'workshop_regrade_preview_items',
    'workshop_regrade_approvals',
    'workshop_regrade_execution_events'
  ] loop
    execute format('drop trigger if exists %I on private.%I', 'reject_workshop_history_mutation', table_name);
    execute format(
      'create trigger %I before update or delete on private.%I for each row execute function private.reject_history_mutation()',
      'reject_workshop_history_mutation', table_name
    );
  end loop;
end
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'workshop_definitions', 'workshop_versions', 'workshop_tracks', 'workshop_skills',
    'workshop_questions', 'workshop_track_questions', 'workshop_question_parts',
    'workshop_part_key_versions', 'workshop_part_key_activations', 'workshop_cycles',
    'workshop_mutation_receipts', 'workshop_progress', 'workshop_attempt_events',
    'workshop_reveal_events', 'workshop_drafts', 'workshop_submissions',
    'workshop_submission_answers', 'workshop_grading_decisions', 'workshop_admin_events',
    'workshop_regrade_previews', 'workshop_regrade_preview_items',
    'workshop_regrade_approvals', 'workshop_regrade_execution_events'
  ] loop
    execute format('alter table private.%I enable row level security', table_name);
    execute format('revoke all on private.%I from public, anon, authenticated', table_name);
  end loop;
end
$$;

revoke all on private.current_workshop_part_keys from public, anon, authenticated;
revoke all on private.current_workshop_grading_decisions from public, anon, authenticated;

comment on table private.workshop_attempt_events is
  'Append-only original interactive attempts. A duplicate request_id cannot create another attempt.';
comment on table private.workshop_grading_decisions is
  'Append-only grading history. Approved regrades append a superseding decision.';
comment on table private.workshop_cycles is
  'Initial and administrator-authorized reopen cycles; no reset deletes previous progress.';
comment on table private.workshop_drafts is
  'Mutable final-submit drafts only; finalized submission answers are immutable.';

commit;
