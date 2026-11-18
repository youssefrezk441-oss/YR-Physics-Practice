-- Disposable CI-only GoTrue/Postgres baseline. NEVER apply to cloud projects.
create extension if not exists pgcrypto;
do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if; end$$;
do $$begin if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; end$$;
do $$begin if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if; end$$;
create schema if not exists private;
create or replace function private.reject_history_mutation() returns trigger language plpgsql set search_path=pg_catalog as $$
begin raise exception 'immutable history cannot be changed' using errcode='55000'; end $$;
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text not null, public boolean not null default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table if not exists public.student_groups(
 id uuid primary key default gen_random_uuid(), group_code text unique not null,
 grade_level text, center_name text,is_active boolean default true);
create table if not exists public.student_profiles(
 user_id uuid primary key references auth.users(id),student_code text unique not null,
 full_name text not null, grade_level text not null,group_code text,
 center_name text,is_active boolean not null default true);
create or replace function public.admin_access_level(p_scope text,p_user_id uuid)
returns text language sql stable as $$select 'none'::text$$;
