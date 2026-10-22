begin;

-- Additive foundation only. This migration does not backfill, regrade, update or delete
-- any existing student response. Integration must be rehearsed on staging first.
create schema if not exists private;

create table if not exists private.answer_key_scopes (
  id uuid primary key default gen_random_uuid(),
  scope_kind text not null check (scope_kind in ('workshop', 'exam', 'training')),
  scope_ref text not null check (length(btrim(scope_ref)) between 1 and 200),
  title text not null check (length(btrim(title)) between 1 and 300),
  created_at timestamptz not null default now(),
  created_by uuid not null,
  unique (scope_kind, scope_ref)
);

create table if not exists private.answer_key_versions (
  id uuid primary key default gen_random_uuid(),
  scope_id uuid not null references private.answer_key_scopes(id) on delete restrict,
  version_no integer not null check (version_no > 0),
  answer_key jsonb not null check (jsonb_typeof(answer_key) = 'object'),
  grading_contract jsonb not null default '{}'::jsonb check (jsonb_typeof(grading_contract) = 'object'),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  change_reason text not null check (length(btrim(change_reason)) between 8 and 2000),
  created_at timestamptz not null default now(),
  created_by uuid not null,
  unique (scope_id, version_no),
  unique (scope_id, content_sha256),
  unique (scope_id, id)
);

create table if not exists private.answer_key_activations (
  id uuid primary key default gen_random_uuid(),
  scope_id uuid not null references private.answer_key_scopes(id) on delete restrict,
  version_id uuid not null,
  previous_version_id uuid,
  activation_reason text not null check (length(btrim(activation_reason)) between 8 and 2000),
  activated_at timestamptz not null default now(),
  activated_by uuid not null,
  approved_by uuid not null,
  foreign key (scope_id, version_id)
    references private.answer_key_versions(scope_id, id) on delete restrict,
  foreign key (scope_id, previous_version_id)
    references private.answer_key_versions(scope_id, id) on delete restrict,
  check (activated_by <> approved_by),
  check (previous_version_id is null or previous_version_id <> version_id)
);
create index if not exists answer_key_activations_scope_time_idx
  on private.answer_key_activations(scope_id, activated_at desc, id desc);

-- One immutable row for every grading decision. A regrade appends a new row and
-- references the decision it supersedes; the previous result is never overwritten.
create table if not exists private.grading_decision_history (
  id uuid primary key default gen_random_uuid(),
  scope_id uuid not null references private.answer_key_scopes(id) on delete restrict,
  attempt_ref text not null check (length(btrim(attempt_ref)) between 1 and 300),
  response_ref text not null check (length(btrim(response_ref)) between 1 and 300),
  student_user_id uuid,
  answer_snapshot jsonb not null,
  answer_key_version_id uuid not null,
  awarded_points numeric(12,4) not null,
  max_points numeric(12,4) not null check (max_points >= 0),
  is_correct boolean,
  grading_reason text not null check (length(btrim(grading_reason)) between 1 and 2000),
  grader_kind text not null check (grader_kind in ('automatic', 'manual', 'approved_regrade')),
  supersedes_decision_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  foreign key (scope_id, answer_key_version_id)
    references private.answer_key_versions(scope_id, id) on delete restrict,
  foreign key (scope_id, response_ref, supersedes_decision_id)
    references private.grading_decision_history(scope_id, response_ref, id) on delete restrict,
  check (awarded_points >= 0 and awarded_points <= max_points),
  check (supersedes_decision_id is null or supersedes_decision_id <> id),
  unique (scope_id, response_ref, id)
);
create unique index if not exists grading_decision_supersedes_once_uq
  on private.grading_decision_history(supersedes_decision_id)
  where supersedes_decision_id is not null;
create index if not exists grading_decision_response_time_idx
  on private.grading_decision_history(scope_id, response_ref, created_at desc, id desc);
create index if not exists grading_decision_attempt_idx
  on private.grading_decision_history(scope_id, attempt_ref, created_at desc);

-- A preview is evidence only. It cannot itself authorize or execute a regrade.
create table if not exists private.regrade_impact_previews (
  id uuid primary key default gen_random_uuid(),
  scope_id uuid not null references private.answer_key_scopes(id) on delete restrict,
  from_version_id uuid not null,
  to_version_id uuid not null,
  requested_reason text not null check (length(btrim(requested_reason)) between 8 and 2000),
  affected_attempts integer not null default 0 check (affected_attempts >= 0),
  affected_students integer not null default 0 check (affected_students >= 0),
  total_score_delta numeric(14,4) not null default 0,
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  created_at timestamptz not null default now(),
  created_by uuid not null,
  expires_at timestamptz not null,
  foreign key (scope_id, from_version_id)
    references private.answer_key_versions(scope_id, id) on delete restrict,
  foreign key (scope_id, to_version_id)
    references private.answer_key_versions(scope_id, id) on delete restrict,
  check (from_version_id <> to_version_id),
  check (expires_at > created_at),
  unique (scope_id, id)
);

create table if not exists private.regrade_impact_items (
  scope_id uuid not null,
  preview_id uuid not null,
  attempt_ref text not null,
  response_ref text not null,
  student_user_id uuid,
  previous_decision_id uuid not null,
  previous_points numeric(12,4) not null,
  proposed_points numeric(12,4) not null,
  max_points numeric(12,4) not null check (max_points >= 0),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  primary key (preview_id, response_ref),
  foreign key (scope_id, preview_id)
    references private.regrade_impact_previews(scope_id, id) on delete restrict,
  foreign key (scope_id, response_ref, previous_decision_id)
    references private.grading_decision_history(scope_id, response_ref, id) on delete restrict,
  check (previous_points between 0 and max_points),
  check (proposed_points between 0 and max_points)
);

create table if not exists private.regrade_approvals (
  id uuid primary key default gen_random_uuid(),
  preview_id uuid not null unique references private.regrade_impact_previews(id) on delete restrict,
  approval_reason text not null check (length(btrim(approval_reason)) between 8 and 2000),
  approved_at timestamptz not null default now(),
  approved_by uuid not null,
  expected_affected_attempts integer not null check (expected_affected_attempts >= 0),
  expected_total_score_delta numeric(14,4) not null
);

-- Execution is represented by append-only events so failures and retries remain auditable.
create table if not exists private.regrade_execution_events (
  id uuid primary key default gen_random_uuid(),
  approval_id uuid not null references private.regrade_approvals(id) on delete restrict,
  event_type text not null check (event_type in ('started', 'completed', 'failed', 'rolled_back')),
  event_detail jsonb not null default '{}'::jsonb check (jsonb_typeof(event_detail) = 'object'),
  recorded_at timestamptz not null default now(),
  recorded_by uuid not null
);
create index if not exists regrade_execution_events_approval_time_idx
  on private.regrade_execution_events(approval_id, recorded_at, id);

create or replace view private.current_answer_key_versions as
select distinct on (a.scope_id)
  a.scope_id, a.version_id, a.previous_version_id, a.activated_at,
  a.activated_by, a.approved_by
from private.answer_key_activations a
order by a.scope_id, a.activated_at desc, a.id desc;

create or replace view private.current_grading_decisions as
select distinct on (d.scope_id, d.response_ref) d.*
from private.grading_decision_history d
order by d.scope_id, d.response_ref, d.created_at desc, d.id desc;

create or replace function private.reject_history_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'immutable audit history: append a superseding record instead'
    using errcode = '55000';
end
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'answer_key_versions',
    'answer_key_activations',
    'grading_decision_history',
    'regrade_impact_previews',
    'regrade_impact_items',
    'regrade_approvals',
    'regrade_execution_events'
  ] loop
    execute format('drop trigger if exists %I on private.%I', 'reject_history_mutation', table_name);
    execute format(
      'create trigger %I before update or delete on private.%I for each row execute function private.reject_history_mutation()',
      'reject_history_mutation', table_name
    );
  end loop;
end
$$;

alter table private.answer_key_scopes enable row level security;
alter table private.answer_key_versions enable row level security;
alter table private.answer_key_activations enable row level security;
alter table private.grading_decision_history enable row level security;
alter table private.regrade_impact_previews enable row level security;
alter table private.regrade_impact_items enable row level security;
alter table private.regrade_approvals enable row level security;
alter table private.regrade_execution_events enable row level security;

revoke all on private.answer_key_scopes from public, anon, authenticated;
revoke all on private.answer_key_versions from public, anon, authenticated;
revoke all on private.answer_key_activations from public, anon, authenticated;
revoke all on private.grading_decision_history from public, anon, authenticated;
revoke all on private.regrade_impact_previews from public, anon, authenticated;
revoke all on private.regrade_impact_items from public, anon, authenticated;
revoke all on private.regrade_approvals from public, anon, authenticated;
revoke all on private.regrade_execution_events from public, anon, authenticated;
revoke all on private.current_answer_key_versions from public, anon, authenticated;
revoke all on private.current_grading_decisions from public, anon, authenticated;
revoke all on function private.reject_history_mutation() from public, anon, authenticated;

comment on table private.answer_key_versions is
  'Immutable answer-key versions; no historical student work is regraded by this table alone.';
comment on table private.regrade_impact_previews is
  'Read-only impact evidence generated before a separately approved regrade.';
comment on table private.grading_decision_history is
  'Append-only grading decisions preserving the answer and key version used at grading time.';

commit;
