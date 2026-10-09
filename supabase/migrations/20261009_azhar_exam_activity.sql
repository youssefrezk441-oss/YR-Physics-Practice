create table if not exists private.azhar_exam_activity (
  exam_id text not null,
  name_key text not null,
  event_id uuid not null,
  event_type text not null check (event_type in ('hidden','visible')),
  client_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  primary key (exam_id, name_key, event_id),
  foreign key (exam_id, name_key) references private.azhar_exam_name_attempts(exam_id, name_key) on delete cascade
);
create index if not exists azhar_exam_activity_exam_name_time_idx
  on private.azhar_exam_activity (exam_id, name_key, client_at);
revoke all on private.azhar_exam_activity from public, anon, authenticated;
