-- Add a private review queue for sensitive changes requested by existing students.
-- No student code is editable; no public Data API grants.
create table if not exists private.student_profile_change_requests (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.student_profiles(user_id) on delete cascade,
 requested_profile jsonb not null,
 previous_profile jsonb not null,
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 requested_at timestamptz not null default now(),
 decided_at timestamptz,
 decided_by uuid references auth.users(id) on delete restrict,
 decision_reason text,
 constraint requested_profile_object check(jsonb_typeof(requested_profile)='object')
);
create unique index if not exists student_profile_change_pending_one_per_user
on private.student_profile_change_requests(user_id) where status='pending';
create index if not exists student_profile_change_requests_created
on private.student_profile_change_requests(status,requested_at desc);
revoke all on private.student_profile_change_requests from public,anon,authenticated;
comment on table private.student_profile_change_requests is 'Student self-service requests for reviewed name/grade/group/system changes; service-role access only.';
