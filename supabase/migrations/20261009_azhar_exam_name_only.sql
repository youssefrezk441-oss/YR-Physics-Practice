create table if not exists private.azhar_exam_name_attempts (
  exam_id text not null,
  name_key text not null,
  student_name text not null,
  token_hash text not null,
  started_at timestamptz not null default now(),
  deadline_at timestamptz not null,
  answers jsonb not null default '{}'::jsonb,
  submitted_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (exam_id, name_key),
  unique (exam_id, token_hash),
  constraint azhar_exam_name_answers_object check (jsonb_typeof(answers) = 'object'),
  constraint azhar_exam_name_deadline_check check (deadline_at = started_at + interval '150 minutes')
);
create index if not exists azhar_exam_name_attempts_exam_time_idx
  on private.azhar_exam_name_attempts (exam_id, started_at desc);
revoke all on private.azhar_exam_name_attempts from public, anon, authenticated;
