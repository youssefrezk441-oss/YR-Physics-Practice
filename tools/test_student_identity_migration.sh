#!/usr/bin/env bash
set -euo pipefail
repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
container="yr-identity-test-$RANDOM-$$"
cleanup(){ docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run -d --name "$container" -e POSTGRES_PASSWORD=test -e POSTGRES_DB=identity_test postgres:17-alpine >/dev/null
for _ in $(seq 1 60); do docker exec "$container" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
psql_cmd=(docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d identity_test)
"${psql_cmd[@]}" <<'SQL'
create extension if not exists pgcrypto;
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb default '{}'::jsonb);
create table public.student_groups(id uuid primary key default gen_random_uuid(),group_code text not null unique,is_active boolean not null default true,grade_level text,center_name text);
create table public.student_profiles(user_id uuid primary key references auth.users(id),student_code text unique,full_name text,grade_level text,is_active boolean default false,center_name text,group_code text,student_phone text,guardian_phone text,updated_at timestamptz default now());
create table public.student_group_memberships(id uuid primary key default gen_random_uuid(),group_id uuid references public.student_groups(id),user_id uuid references public.student_profiles(user_id),joined_on date,left_on date,created_at timestamptz default now(),updated_at timestamptz default now());
create function public.admin_access_level(text,uuid) returns text language sql immutable as $$select 'edit'::text$$;
insert into auth.users(id,email) values('00000000-0000-0000-0000-000000000001','admin@example.invalid'),('00000000-0000-0000-0000-000000000002','student@example.invalid');
insert into public.student_groups(id,group_code,is_active,grade_level,center_name) values('10000000-0000-0000-0000-000000000001','N2-A',true,'الصف الثاني الثانوي','Test Center');
SQL
"${psql_cmd[@]}" < "$repo_dir/supabase/migrations/20261028190000_student_identity_registration_v1.sql"
"${psql_cmd[@]}" <<'SQL'
insert into private.student_registration_requests(id,full_name,national_id_hmac,national_id_last4,birth_date,grade_level,education_system,attendance_location,residence_area,student_phone_e164,guardian_phone_exception_requested,privacy_notice_version,privacy_accepted_at,status_token_hash,status_token_expires_at)
values
('20000000-0000-0000-0000-000000000001','طالب تجريبي أول كامل','hash-1','0001','2008-01-01','الصف الثاني الثانوي','عام','ناهيا','اختبار','+201012345671',true,'draft-v1',now(),'status-1',now()+interval '1 day'),
('20000000-0000-0000-0000-000000000002','طالب تجريبي ثاني كامل','hash-2','0002','2008-01-01','الصف الثاني الثانوي','عام','ناهيا','اختبار','+201012345672',true,'draft-v1',now(),'status-2',now()+interval '1 day');
insert into private.student_account_recovery_requests(id,identifier_hmac,status_token_hash,status_token_expires_at,subject_user_id,status)
values('30000000-0000-0000-0000-000000000001','identifier','status-reset',now()+interval '1 day','00000000-0000-0000-0000-000000000002','approved');
insert into private.student_password_reset_tokens(id,recovery_request_id,user_id,token_hash,expires_at,issued_by)
values('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','reset-token',now()+interval '1 day','00000000-0000-0000-0000-000000000001');
update private.student_registration_requests set auth_user_id='00000000-0000-0000-0000-000000000002' where id='20000000-0000-0000-0000-000000000001';
insert into private.student_activation_tokens(id,request_id,user_id,token_hash,expires_at,issued_by)
values('50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','activation-token',now()+interval '1 day','00000000-0000-0000-0000-000000000001');
SQL
tmp_dir="$(mktemp -d)"
("${psql_cmd[@]}" -Atc "select private.reserve_student_code('20000000-0000-0000-0000-000000000001','N2-A','الصف الثاني الثانوي')" >"$tmp_dir/code1") & p1=$!
("${psql_cmd[@]}" -Atc "select private.reserve_student_code('20000000-0000-0000-0000-000000000002','N2-A','الصف الثاني الثانوي')" >"$tmp_dir/code2") & p2=$!
wait "$p1"; wait "$p2"
code1="$(tr -d '[:space:]' <"$tmp_dir/code1")"; code2="$(tr -d '[:space:]' <"$tmp_dir/code2")"
test -n "$code1" && test -n "$code2" && test "$code1" != "$code2"
retry="$("${psql_cmd[@]}" -Atc "select private.reserve_student_code('20000000-0000-0000-0000-000000000001','N2-A','الصف الثاني الثانوي')" | tr -d '[:space:]')"
test "$retry" = "$code1"
("${psql_cmd[@]}" -Atc "select resume from private.claim_student_password_reset_token('reset-token','same-payload')" >"$tmp_dir/claim1") & p1=$!
("${psql_cmd[@]}" -Atc "select resume from private.claim_student_password_reset_token('reset-token','same-payload')" >"$tmp_dir/claim2") & p2=$!
wait "$p1"; wait "$p2"
claims="$(cat "$tmp_dir/claim1" "$tmp_dir/claim2" | sort | tr '\n' ' ')"
test "$claims" = "f t "
blocked="$("${psql_cmd[@]}" -Atc "select count(*) from private.claim_student_password_reset_token('reset-token','different-payload')" | tr -d '[:space:]')"
test "$blocked" = "0"
("${psql_cmd[@]}" -Atc "select resume from private.claim_student_activation_token('activation-token','activation-payload')" >"$tmp_dir/activation1") & p1=$!
("${psql_cmd[@]}" -Atc "select resume from private.claim_student_activation_token('activation-token','activation-payload')" >"$tmp_dir/activation2") & p2=$!
wait "$p1"; wait "$p2"
activation_claims="$(cat "$tmp_dir/activation1" "$tmp_dir/activation2" | sort | tr '\n' ' ')"
test "$activation_claims" = "f t "
activation_blocked="$("${psql_cmd[@]}" -Atc "select count(*) from private.claim_student_activation_token('activation-token','different-payload')" | tr -d '[:space:]')"
test "$activation_blocked" = "0"
echo "student identity migration concurrency: ok ($code1, $code2)"
