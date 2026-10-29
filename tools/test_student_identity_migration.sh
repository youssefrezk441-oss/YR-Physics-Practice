#!/usr/bin/env bash
set -euo pipefail
repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
container="yr-identity-test-$RANDOM-$$"
cleanup(){ docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run -d --name "$container" -e POSTGRES_PASSWORD=test -e POSTGRES_DB=identity_test postgres:17-alpine >/dev/null
database_ready=false
for _ in $(seq 1 60); do
  if docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d identity_test -Atc 'select 1' 2>/dev/null | grep -qx '1'; then database_ready=true; break; fi
  sleep 1
done
if [[ "$database_ready" != true ]]; then echo 'identity_test database did not become queryable' >&2; exit 1; fi
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
insert into auth.users(id,email) values
('00000000-0000-0000-0000-000000000001','admin@example.invalid'),
('00000000-0000-0000-0000-000000000002','student@example.invalid'),
('00000000-0000-0000-0000-000000000003','legacy1@example.invalid'),
('00000000-0000-0000-0000-000000000004','legacy2@example.invalid'),
('00000000-0000-0000-0000-000000000005','legacy3@example.invalid'),
('00000000-0000-0000-0000-000000000006','legacy4@example.invalid');
insert into public.student_groups(id,group_code,is_active,grade_level,center_name) values('10000000-0000-0000-0000-000000000001','N2-A',true,'الصف الثاني الثانوي','Test Center');
insert into public.student_profiles(user_id,student_code,full_name,grade_level,is_active,center_name,group_code) values
('00000000-0000-0000-0000-000000000003','N2-090','طالب قديم تجريبي أول','الصف الثاني الثانوي',true,'Test Center','N2-A'),
('00000000-0000-0000-0000-000000000004','N2-091','طالب قديم تجريبي ثاني','الصف الثاني الثانوي',true,'Test Center','N2-A'),
('00000000-0000-0000-0000-000000000005','N2-092','طالب قديم تجريبي ثالث','الصف الثاني الثانوي',false,'Test Center','N2-A'),
('00000000-0000-0000-0000-000000000006','LEGACY-CODE','طالب قديم تجريبي رابع','الصف الثاني الثانوي',false,'Test Center','N2-A');
SQL
"${psql_cmd[@]}" < "$repo_dir/supabase/migrations/20261028190000_student_identity_registration_v1.sql"
"${psql_cmd[@]}" < "$repo_dir/supabase/migrations/20261028230000_immediate_registration_review.sql"
legacy_missing_memberships="$("${psql_cmd[@]}" -Atc "select count(*) from public.student_profiles p where p.user_id in('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000006') and not exists(select 1 from public.student_group_memberships m where m.user_id=p.user_id and m.left_on is null)" | tr -d '[:space:]')"
test "$legacy_missing_memberships" = "4"
legacy_nonnumeric="$("${psql_cmd[@]}" -Atc "select count(*) from public.student_profiles where student_code='LEGACY-CODE'" | tr -d '[:space:]')"
test "$legacy_nonnumeric" = "1"
legacy_review_rows="$("${psql_cmd[@]}" -Atc "select count(*) from private.student_account_reviews" | tr -d '[:space:]')"
test "$legacy_review_rows" = "0"
"${psql_cmd[@]}" <<'SQL'
insert into private.student_registration_requests(id,full_name,national_id_hmac,national_id_last4,birth_date,grade_level,education_system,attendance_location,residence_area,student_phone_e164,guardian_phone_exception_requested,privacy_notice_version,privacy_accepted_at,status_token_hash,status_token_expires_at)
values
('20000000-0000-0000-0000-000000000001','طالب تجريبي أول كامل','hash-1','0001','2008-01-01','الصف الثاني الثانوي','عام','ناهيا','اختبار','+201012345671',true,'draft-v1',now(),'status-1',now()+interval '1 day'),
('20000000-0000-0000-0000-000000000002','طالب تجريبي ثاني كامل','hash-2','0002','2008-01-01','الصف الثاني الثانوي','عام','ناهيا','اختبار','+201012345672',true,'draft-v1',now(),'status-2',now()+interval '1 day'),
('20000000-0000-0000-0000-000000000003','طالب تجريبي مكرر كامل','hash-2','0002','2008-01-01','الصف الثاني الثانوي','عام','ناهيا','اختبار','+201012345673',true,'draft-v1',now(),'status-3',now()+interval '1 day');
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
("${psql_cmd[@]}" -Atc "select private.reserve_student_identity_claim('20000000-0000-0000-0000-000000000002','hash-2')" >"$tmp_dir/identity1") & p1=$!
("${psql_cmd[@]}" -Atc "select private.reserve_student_identity_claim('20000000-0000-0000-0000-000000000003','hash-2')" >"$tmp_dir/identity2") & p2=$!
wait "$p1"; wait "$p2"
identity_claims="$(cat "$tmp_dir/identity1" "$tmp_dir/identity2" | sort | tr '\n' ' ')"
test "$identity_claims" = "f t "
identity_winner="$("${psql_cmd[@]}" -Atc "select request_id from private.student_identity_claims where national_id_hmac='hash-2'" | tr -d '[:space:]')"
identity_retry="$("${psql_cmd[@]}" -Atc "select private.reserve_student_identity_claim('$identity_winner','hash-2')" | tr -d '[:space:]')"
test "$identity_retry" = "t"
("${psql_cmd[@]}" -Atc "select private.claim_student_registration_provisioning('20000000-0000-0000-0000-000000000002','60000000-0000-0000-0000-000000000001')" >"$tmp_dir/provision1") & p1=$!
("${psql_cmd[@]}" -Atc "select private.claim_student_registration_provisioning('20000000-0000-0000-0000-000000000002','60000000-0000-0000-0000-000000000002')" >"$tmp_dir/provision2") & p2=$!
wait "$p1"; wait "$p2"
provision_claims="$(cat "$tmp_dir/provision1" "$tmp_dir/provision2" | sort | tr '\n' ' ')"
test "$provision_claims" = "f t "
"${psql_cmd[@]}" -c "update private.student_registration_requests set provisioning_status='failed',provisioning_lock_token=null,provisioning_locked_at=null where id='20000000-0000-0000-0000-000000000002'" >/dev/null
retry_after_auth_failure="$("${psql_cmd[@]}" -Atc "select private.claim_student_registration_provisioning('20000000-0000-0000-0000-000000000002','60000000-0000-0000-0000-000000000003')" | tr -d '[:space:]')"
test "$retry_after_auth_failure" = "t"
"${psql_cmd[@]}" -c "update private.student_registration_requests set auth_user_id='00000000-0000-0000-0000-000000000006',provisioning_status='failed',provisioning_lock_token=null,provisioning_locked_at=null where id='20000000-0000-0000-0000-000000000002'" >/dev/null
retry_after_link_failure="$("${psql_cmd[@]}" -Atc "select private.claim_student_registration_provisioning('20000000-0000-0000-0000-000000000002','60000000-0000-0000-0000-000000000004')" | tr -d '[:space:]')"
test "$retry_after_link_failure" = "t"
retry_state="$("${psql_cmd[@]}" -Atc "select provisioning_status from private.student_registration_requests where id='20000000-0000-0000-0000-000000000002'" | tr -d '[:space:]')"
test "$retry_state" = "auth_created"
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
"${psql_cmd[@]}" <<'SQL'
insert into private.student_account_reviews(user_id,request_id,status,access_scope,review_started_at,review_deadline_at)
values('00000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','pending_review','review_only','2030-01-01 00:00:00+00','2030-01-03 00:00:00+00');
SQL
before_boundary="$("${psql_cmd[@]}" -Atc "select status from private.student_account_access('00000000-0000-0000-0000-000000000002','2030-01-02 23:59:59.999+00')" | cut -d'|' -f1)"
test "$before_boundary" = "pending_review"
at_boundary="$("${psql_cmd[@]}" -Atc "select status from private.student_account_access('00000000-0000-0000-0000-000000000002','2030-01-03 00:00:00+00')" | cut -d'|' -f1)"
test "$at_boundary" = "suspended_pending_approval"
legacy_access="$("${psql_cmd[@]}" -Atc "select status||'|'||legacy_account from private.student_account_access('00000000-0000-0000-0000-000000000003','2040-01-01')")"
test "$legacy_access" = "approved|true"
echo "student identity migration, legacy compatibility and concurrency: ok ($code1, $code2)"
