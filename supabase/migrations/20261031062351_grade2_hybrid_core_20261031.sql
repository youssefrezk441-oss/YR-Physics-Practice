begin;
create schema if not exists private;
create table if not exists private.g2_activities(
 slug text primary key check(slug ~ '^g2-azhar-(ch0[123]-(learn|mastery|exam)|chapters-1-3-exam)$'),
 title text not null,chapter smallint not null check(chapter between 1 and 3),
 mode text not null check(mode in ('learn','mastery','exam')),
 status text not null default 'draft' check(status in ('draft','validated','published','paused','archived')),
 eligible_group_codes text[] not null default '{}',
 content_verified boolean not null default false,images_verified boolean not null default false,
 keys_verified boolean not null default false,rubrics_verified boolean not null default false,
 staging_verified boolean not null default false,created_at timestamptz not null default now(),
 published_at timestamptz,
 constraint g2_ready_only_publication check(status <> 'published' or (
   cardinality(eligible_group_codes)>0 and content_verified and images_verified
   and keys_verified and rubrics_verified and staging_verified and published_at is not null))
);
create table if not exists private.g2_questions(
 activity_slug text not null references private.g2_activities(slug) on delete restrict,
 bank_id text not null check(bank_id ~ '^F[1-5]-(H|E)-[0-9][0-9]$'),
 prompt text,parts_public jsonb not null check(jsonb_typeof(parts_public)='array'),
 image_path text not null,image_sha256 text not null check(image_sha256 ~ '^[a-f0-9]{64}$'),
 skill_ref text not null,sort_order integer not null check(sort_order>0),
 primary key(activity_slug,bank_id),unique(activity_slug,sort_order)
);
create table if not exists private.g2_keys(
 id uuid primary key default gen_random_uuid(),
 activity_slug text not null,bank_id text not null,part_key text not null,
 version_no integer not null check(version_no>0),
 key_status text not null default 'draft' check(key_status in ('draft','approved','retired')),
 answer_spec jsonb not null default '{}'::jsonb,rubric jsonb,
 max_points numeric(8,2) not null check(max_points>0),
 approved_by uuid,approved_at timestamptz,
 foreign key(activity_slug,bank_id) references private.g2_questions(activity_slug,bank_id) on delete restrict,
 unique(activity_slug,bank_id,part_key,version_no),
 check(key_status<>'approved' or (approved_by is not null and approved_at is not null))
);
create table if not exists private.g2_attempts(
 id uuid primary key default gen_random_uuid(),
 activity_slug text not null references private.g2_activities(slug) on delete restrict,
 user_id uuid not null references auth.users(id) on delete restrict,
 state text not null default 'open' check(state in ('open','submitted')),
 started_at timestamptz not null default now(),submitted_at timestamptz,
 unique(activity_slug,user_id),
 check((state='open' and submitted_at is null) or(state='submitted' and submitted_at is not null))
);
create table if not exists private.g2_answer_events(
 id uuid primary key default gen_random_uuid(),
 attempt_id uuid not null references private.g2_attempts(id) on delete restrict,
 bank_id text not null,part_key text not null,revision integer not null check(revision>0),
 answer_payload jsonb not null check(jsonb_typeof(answer_payload)='object'),
 client_request_id uuid not null,
 submitted_at timestamptz not null default now(),
 unique(attempt_id,bank_id,part_key,revision),unique(attempt_id,client_request_id)
);
create table if not exists private.g2_answer_images(
 id uuid primary key default gen_random_uuid(),
 answer_event_id uuid not null references private.g2_answer_events(id) on delete restrict,
 slot smallint not null check(slot between 1 and 2),storage_path text not null unique,
 mime_type text not null check(mime_type in ('image/png','image/jpeg')),
 bytes_count integer not null check(bytes_count>0 and bytes_count<=4000000),
 sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 unique(answer_event_id,slot),created_at timestamptz not null default now()
);
create table if not exists private.g2_grading_decisions(
 id uuid primary key default gen_random_uuid(),
 answer_event_id uuid not null references private.g2_answer_events(id) on delete restrict,
 key_id uuid references private.g2_keys(id) on delete restrict,
 awarded_points numeric(8,2) not null check(awarded_points>=0),
 max_points numeric(8,2) not null check(max_points>0 and awarded_points<=max_points),
 criteria_points jsonb not null default '{}'::jsonb,
 method text not null check(method in ('verified_mcq','teacher_manual')),
 reviewer_id uuid references auth.users(id) on delete restrict,
 reason text not null,supersedes uuid references private.g2_grading_decisions(id) on delete restrict,
 created_at timestamptz not null default now(),
 check(method<>'teacher_manual' or reviewer_id is not null)
);
create table if not exists private.g2_admin_events(
 id bigint generated always as identity primary key,actor_id uuid references auth.users(id) on delete restrict,
 action text not null,payload jsonb not null default '{}'::jsonb,created_at timestamptz not null default now()
);
create or replace function private.g2_prevent_event_mutation() returns trigger language plpgsql as $$
begin raise exception 'Immutable grade2 event: use append-only corrections';end $$;
do $$declare tab text;begin
 foreach tab in array array['g2_answer_events','g2_answer_images','g2_grading_decisions','g2_admin_events'] loop
  execute format('create trigger g2_immutable before update or delete on private.%I for each row execute function private.g2_prevent_event_mutation()',tab);
 end loop;
end $$;
do $$declare tab text;begin
 foreach tab in array array['g2_activities','g2_questions','g2_keys','g2_attempts','g2_answer_events','g2_answer_images','g2_grading_decisions','g2_admin_events'] loop
  execute format('alter table private.%I enable row level security',tab);
  execute format('revoke all on private.%I from anon,authenticated,public',tab);
 end loop;
end $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('g2-question-images','g2-question-images',false,4000000,array['image/png','image/jpeg']),
       ('g2-solution-images','g2-solution-images',false,4000000,array['image/png','image/jpeg'])
on conflict(id) do nothing;
commit;