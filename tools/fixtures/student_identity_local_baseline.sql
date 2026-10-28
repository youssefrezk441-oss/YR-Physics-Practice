create extension if not exists pgcrypto;
do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if; end $$;
do $$ begin if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; end $$;
do $$ begin if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if; end $$;

create table if not exists public.student_groups(
  id uuid primary key default gen_random_uuid(), group_code text not null unique,
  is_active boolean not null default true, grade_level text, center_name text
);
create table if not exists public.student_profiles(
  user_id uuid primary key references auth.users(id) on delete restrict,
  student_code text not null unique, full_name text not null, grade_level text not null,
  is_active boolean not null default false, center_name text, group_code text,
  student_phone text, guardian_phone text, updated_at timestamptz not null default now()
);
create table if not exists public.student_group_memberships(
  id uuid primary key default gen_random_uuid(), group_id uuid not null references public.student_groups(id) on delete restrict,
  user_id uuid not null references public.student_profiles(user_id) on delete restrict,
  joined_on date, left_on date, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.synthetic_admin_permissions(
  user_id uuid primary key references auth.users(id) on delete cascade, scope text not null, access_level text not null
);
create or replace function public.admin_access_level(p_scope text,p_user_id uuid)
returns text language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce((select access_level from public.synthetic_admin_permissions where user_id=p_user_id and scope=p_scope),'none')
$$;

create table if not exists public.synthetic_student_attempts(
  id uuid primary key default gen_random_uuid(), user_id uuid not null, score integer not null, payload jsonb not null
);
create table if not exists public.synthetic_student_grades(
  id uuid primary key default gen_random_uuid(), user_id uuid not null, grade numeric not null
);

grant usage on schema public to anon,authenticated,service_role;
grant select on public.student_groups to anon,authenticated;
grant all on public.student_groups,public.student_profiles,public.student_group_memberships,public.synthetic_admin_permissions,public.synthetic_student_attempts,public.synthetic_student_grades to service_role;
grant execute on function public.admin_access_level(text,uuid) to authenticated,service_role;
