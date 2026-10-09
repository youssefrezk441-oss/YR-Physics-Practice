create schema if not exists private;

create table if not exists private.azhar_exam_attempts (
  exam_id text not null,
  student_user_id uuid not null,
  student_code text not null,
  student_name text not null,
  group_code text not null,
  token_hash text not null,
  started_at timestamptz not null default now(),
  deadline_at timestamptz not null,
  answers jsonb not null default '{}'::jsonb,
  submitted_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (exam_id, student_user_id),
  constraint azhar_exam_answers_object check (jsonb_typeof(answers) = 'object'),
  constraint azhar_exam_deadline_check check (deadline_at = started_at + interval '150 minutes')
);

create index if not exists azhar_exam_attempts_exam_time_idx
  on private.azhar_exam_attempts (exam_id, started_at desc);

revoke all on private.azhar_exam_attempts from public, anon, authenticated;

create table if not exists private.azhar_exam_rate (
  ip_hash text not null,
  minute_bucket timestamptz not null,
  hits integer not null default 1,
  primary key (ip_hash, minute_bucket)
);
revoke all on private.azhar_exam_rate from public, anon, authenticated;
