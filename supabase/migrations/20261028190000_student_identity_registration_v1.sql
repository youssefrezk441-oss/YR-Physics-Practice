begin;
create schema if not exists private;

create table if not exists private.student_identity_settings(
  singleton boolean primary key default true check(singleton),
  registration_enabled boolean not null default false,
  phone_login_enabled boolean not null default false,
  profile_update_enabled boolean not null default false,
  profile_enforcement_enabled boolean not null default false,
  enforcement_coverage_approved_at timestamptz,
  enforcement_coverage_approved_by uuid references auth.users(id) on delete restrict,
  national_id_collection_enabled boolean not null default false,
  required_profile_schema_version integer not null default 1 check(required_profile_schema_version>0),
  sms_provider_ready boolean not null default false,
  privacy_notice_version text not null default 'draft-v1',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete restrict,
  notes text not null default 'All identity features remain fail-closed until separately approved.' check(length(notes) between 8 and 1000),
  check(not profile_enforcement_enabled or (enforcement_coverage_approved_at is not null and enforcement_coverage_approved_by is not null))
);
insert into private.student_identity_settings(singleton) values(true) on conflict(singleton) do nothing;

create table if not exists private.student_registration_requests(
  id uuid primary key default gen_random_uuid(), public_ref uuid not null unique default gen_random_uuid(),
  status text not null default 'pending' check(status in('pending','needs_information','approved','rejected','cancelled')),
  provisioning_status text not null default 'not_started' check(provisioning_status in('not_started','auth_creating','auth_created','profile_created','activation_issued','activated','failed')),
  provisioning_lock_token uuid, provisioning_locked_at timestamptz,
  full_name text not null check(length(btrim(full_name)) between 8 and 160),
  national_id_ciphertext text, national_id_iv text, national_id_hmac text, national_id_last4 text,
  national_id_exception_requested boolean not null default false,
  national_id_exception_reason text,
  birth_date date,
  grade_level text not null check(grade_level in('الصف الثاني الثانوي','الصف الثالث الثانوي')),
  education_system text not null check(education_system in('عام','أزهري','بكالوريا')),
  attendance_location text not null check(attendance_location in('ناهيا','كفر حكيم','خصوصي','غير ذلك')),
  attendance_location_other text, residence_area text not null check(length(btrim(residence_area)) between 2 and 160),
  student_phone_e164 text not null check(student_phone_e164~'^\+201[0125][0-9]{8}$'),
  guardian_phone_e164 text check(guardian_phone_e164~'^\+201[0125][0-9]{8}$'),
  guardian_phone_exception_requested boolean not null default false,
  privacy_notice_version text not null, privacy_accepted_at timestamptz not null,
  status_token_hash text not null, status_token_expires_at timestamptz not null,
  duplicate_review jsonb not null default '{}'::jsonb check(jsonb_typeof(duplicate_review)='object'),
  duplicate_review_resolved_at timestamptz, duplicate_review_resolved_by uuid references auth.users(id) on delete restrict,
  duplicate_review_resolution text,
  requested_group_code text references public.student_groups(group_code) on update cascade on delete restrict,
  assigned_group_code text references public.student_groups(group_code) on update cascade on delete restrict,
  auth_user_id uuid references auth.users(id) on delete restrict,
  assigned_student_code text,
  decision_reason text, decided_at timestamptz, decided_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check((national_id_exception_requested and national_id_hmac is null and birth_date is not null) or (not national_id_exception_requested and national_id_hmac is not null and birth_date is not null)),
  check(guardian_phone_e164 is not null or guardian_phone_exception_requested),
  check((duplicate_review_resolved_at is null and duplicate_review_resolved_by is null) or (duplicate_review_resolved_at is not null and duplicate_review_resolved_by is not null and length(btrim(duplicate_review_resolution))>=8)),
  check((status in('approved','rejected') and decided_at is not null and decided_by is not null) or status in('pending','needs_information','cancelled'))
);
create index if not exists student_registration_national_hmac_idx on private.student_registration_requests(national_id_hmac) where national_id_hmac is not null and status<>'cancelled';
create index if not exists student_registration_status_time_idx on private.student_registration_requests(status,created_at desc);
create index if not exists student_registration_phone_idx on private.student_registration_requests(student_phone_e164);
create table if not exists private.student_privacy_consents(
  id uuid primary key default gen_random_uuid(), request_id uuid not null references private.student_registration_requests(id) on delete restrict,
  notice_version text not null, consent_kind text not null check(consent_kind in('registration_and_identity_processing')),
  accepted_at timestamptz not null, recorded_at timestamptz not null default now(), unique(request_id,consent_kind)
);
create table if not exists private.student_profile_privacy_consents(
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete restrict,
  notice_version text not null, consent_kind text not null check(consent_kind in('existing_profile_identity_processing')),
  accepted_at timestamptz not null, recorded_at timestamptz not null default now(),
  unique(user_id,notice_version,consent_kind)
);

create table if not exists private.student_sensitive_identities(
  user_id uuid primary key references auth.users(id) on delete restrict,
  national_id_ciphertext text not null, national_id_iv text not null, national_id_hmac text not null unique,
  national_id_last4 text not null check(national_id_last4~'^[0-9]{4}$'), birth_date date not null,
  verification_status text not null default 'self_reported' check(verification_status in('self_reported','admin_reviewed','verified','disputed')),
  verified_at timestamptz, verified_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists private.student_login_identifiers(
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete restrict,
  kind text not null check(kind in('student_code','phone')), normalized_value text not null,
  verified boolean not null default false, verified_at timestamptz, disabled_at timestamptz,
  verification_source text not null check(verification_source in('legacy_code','sms','admin_verified_import')),
  created_at timestamptz not null default now(), unique(user_id,kind,normalized_value)
);
create unique index if not exists student_login_active_value_uq on private.student_login_identifiers(kind,normalized_value) where verified and disabled_at is null;
insert into private.student_login_identifiers(user_id,kind,normalized_value,verified,verified_at,verification_source)
select user_id,'student_code',upper(regexp_replace(student_code,'\s','','g')),true,now(),'legacy_code'
from public.student_profiles where student_code is not null
on conflict do nothing;

create table if not exists private.student_identity_exceptions(
  user_id uuid primary key references auth.users(id) on delete restrict,
  birth_date date not null, reason text not null check(length(btrim(reason)) between 8 and 1000),
  approved_at timestamptz not null default now(), approved_by uuid not null references auth.users(id) on delete restrict
);
create table if not exists private.student_code_reservations(
  student_code text primary key, request_id uuid not null unique references private.student_registration_requests(id) on delete restrict,
  group_id uuid not null references public.student_groups(id) on delete restrict,
  status text not null default 'reserved' check(status in('reserved','assigned','released')),
  reserved_at timestamptz not null default now(), assigned_at timestamptz, released_at timestamptz,
  check((status='assigned' and assigned_at is not null) or status<>'assigned'),
  check((status='released' and released_at is not null) or status<>'released')
);
create table if not exists private.student_identity_claims(
  national_id_hmac text primary key, request_id uuid not null unique references private.student_registration_requests(id) on delete restrict,
  status text not null default 'reserved' check(status in('reserved','assigned')),
  user_id uuid references auth.users(id) on delete restrict, reserved_at timestamptz not null default now(), assigned_at timestamptz,
  check((status='assigned' and user_id is not null and assigned_at is not null) or status='reserved')
);

create table if not exists private.student_profile_status(
  user_id uuid primary key references auth.users(id) on delete restrict,
  profile_schema_version integer not null default 0 check(profile_schema_version>=0), completed_at timestamptz,
  last_prompted_at timestamptz, enforcement_exempt_until timestamptz, exemption_reason text,
  updated_at timestamptz not null default now(), updated_by uuid references auth.users(id) on delete restrict
);
create table if not exists private.student_profile_details(
  user_id uuid primary key references auth.users(id) on delete restrict,
  education_system text check(education_system in('عام','أزهري','بكالوريا')),
  attendance_location text check(attendance_location in('ناهيا','كفر حكيم','خصوصي','غير ذلك')),
  attendance_location_other text, residence_area text,
  updated_at timestamptz not null default now()
);
create table if not exists private.student_sensitive_change_requests(
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete restrict,
  change_kind text not null check(change_kind in('full_name','national_id','grade_level','group_code','login_phone')),
  proposed_ciphertext text, proposed_iv text, proposed_hmac text, proposed_summary jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check(status in('pending','approved','rejected','cancelled')),
  reason text, decided_at timestamptz, decided_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists student_sensitive_changes_user_time_idx on private.student_sensitive_change_requests(user_id,created_at desc);

create table if not exists private.student_activation_tokens(
  id uuid primary key default gen_random_uuid(), request_id uuid not null references private.student_registration_requests(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict, token_hash text not null unique,
  expires_at timestamptz not null, used_at timestamptz, issued_at timestamptz not null default now(),
  state text not null default 'issued' check(state in('issued','claimed','applied','failed','expired')),
  payload_hmac text, claimed_at timestamptz, applied_at timestamptz, last_error text,
  issued_by uuid not null references auth.users(id) on delete restrict,
  check(expires_at>issued_at)
);
create table if not exists private.student_account_recovery_requests(
  id uuid primary key default gen_random_uuid(), public_ref uuid not null unique default gen_random_uuid(),
  identifier_hmac text not null, contact_phone_e164 text,
  status text not null default 'pending' check(status in('pending','approved','rejected','cancelled','completed')),
  status_token_hash text not null, status_token_expires_at timestamptz not null,
  subject_user_id uuid references auth.users(id) on delete restrict,
  decision_reason text, decided_at timestamptz, decided_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists student_recovery_status_time_idx on private.student_account_recovery_requests(status,created_at desc);
create table if not exists private.student_password_reset_tokens(
  id uuid primary key default gen_random_uuid(), recovery_request_id uuid not null references private.student_account_recovery_requests(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict, token_hash text not null unique,
  expires_at timestamptz not null, used_at timestamptz, issued_at timestamptz not null default now(), issued_by uuid not null references auth.users(id) on delete restrict,
  state text not null default 'issued' check(state in('issued','claimed','applied','failed','expired')),
  payload_hmac text, claimed_at timestamptz, applied_at timestamptz, last_error text,
  check(expires_at>issued_at)
);
create table if not exists private.student_identity_audit_events(
  id bigint generated always as identity primary key, request_id uuid, actor_user_id uuid references auth.users(id) on delete restrict,
  subject_user_id uuid references auth.users(id) on delete restrict,
  event_type text not null, reason text, metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now()
);
create index if not exists student_identity_audit_subject_time_idx on private.student_identity_audit_events(subject_user_id,created_at desc);
create table if not exists private.student_identity_rate_limits(
  scope text not null, subject_hmac text not null, window_started_at timestamptz not null,
  attempts integer not null default 1 check(attempts>0), primary key(scope,subject_hmac,window_started_at)
);

create unique index if not exists student_group_memberships_one_active_uq on public.student_group_memberships(user_id) where left_on is null;

create or replace function private.reserve_student_code(p_request_id uuid,p_group_code text,p_grade_level text)
returns text language plpgsql security definer set search_path=private,public,pg_temp as $$
declare prefix text; next_no integer; result text; selected_group public.student_groups%rowtype; existing text;
begin
  select * into selected_group from public.student_groups where group_code=p_group_code and is_active for share;
  if not found then raise exception 'active group required'; end if;
  if not ((p_grade_level='الصف الثاني الثانوي' and (coalesce(selected_group.grade_level,'') like '%الثاني%' or coalesce(selected_group.grade_level,'') like '2%')) or (p_grade_level='الصف الثالث الثانوي' and (coalesce(selected_group.grade_level,'') like '%الثالث%' or coalesce(selected_group.grade_level,'') like '3%'))) then raise exception 'group grade mismatch'; end if;
  select student_code into existing from private.student_code_reservations where request_id=p_request_id and status in('reserved','assigned');
  if existing is not null then return existing; end if;
  prefix=regexp_replace(upper(p_group_code),'-[^-]+$','-');
  perform pg_advisory_xact_lock(hashtextextended('student-code:'||prefix,0));
  select coalesce(max(n),0)+1 into next_no from (select (regexp_match(student_code,'([0-9]+)$'))[1]::integer n from public.student_profiles where student_code like prefix||'%' union all select (regexp_match(student_code,'([0-9]+)$'))[1]::integer from private.student_code_reservations where student_code like prefix||'%' and status<>'released') numbers;
  loop result=prefix||lpad(next_no::text,3,'0');begin insert into private.student_code_reservations(student_code,request_id,group_id) values(result,p_request_id,selected_group.id);return result;exception when unique_violation then select student_code into existing from private.student_code_reservations where request_id=p_request_id and status in('reserved','assigned');if existing is not null then return existing;end if;next_no=next_no+1;end;end loop;
  return result;
end $$;
revoke all on function private.reserve_student_code(uuid,text,text) from public,anon,authenticated;

create or replace function private.reserve_student_identity_claim(p_request_id uuid,p_national_id_hmac text)
returns boolean language plpgsql security definer set search_path=private,public,pg_temp as $$
declare existing_request uuid;
begin
  insert into private.student_identity_claims(national_id_hmac,request_id)
  select p_national_id_hmac,r.id from private.student_registration_requests r
  where r.id=p_request_id and not r.national_id_exception_requested and r.national_id_hmac=p_national_id_hmac
  on conflict do nothing;
  select request_id into existing_request from private.student_identity_claims where national_id_hmac=p_national_id_hmac;
  return existing_request=p_request_id;
end $$;
revoke all on function private.reserve_student_identity_claim(uuid,text) from public,anon,authenticated;

create or replace function private.claim_student_registration_provisioning(p_request_id uuid,p_attempt_id uuid)
returns boolean language sql security definer set search_path=private,public,pg_temp as $$
  with claimed as (
    update private.student_registration_requests
    set provisioning_status=case when auth_user_id is null then 'auth_creating' else 'auth_created' end,
        provisioning_lock_token=p_attempt_id,provisioning_locked_at=now(),updated_at=now()
    where id=p_request_id and (provisioning_status not in('auth_creating','auth_created') or provisioning_locked_at is null or provisioning_locked_at<=now()-interval '5 minutes')
    returning id
  ) select exists(select 1 from claimed)
$$;
revoke all on function private.claim_student_registration_provisioning(uuid,uuid) from public,anon,authenticated;

create or replace function private.claim_student_activation_token(p_token_hash text,p_payload_hmac text)
returns table(id uuid,user_id uuid,request_id uuid,resume boolean)
language plpgsql security definer set search_path=private,public,pg_temp as $$
begin
  return query
  with claimed as (
    update private.student_activation_tokens t set state='claimed',payload_hmac=p_payload_hmac,claimed_at=now(),last_error=null
    where t.token_hash=p_token_hash and t.state='issued' and t.used_at is null and t.expires_at>now()
    returning t.id,t.user_id,t.request_id
  ) select c.id,c.user_id,c.request_id,false from claimed c;
  if found then return; end if;
  return query select t.id,t.user_id,t.request_id,true from private.student_activation_tokens t
    where t.token_hash=p_token_hash and t.state in('claimed','failed') and t.payload_hmac=p_payload_hmac and t.used_at is null and t.expires_at>now();
end $$;

create or replace function private.claim_student_password_reset_token(p_token_hash text,p_payload_hmac text)
returns table(id uuid,user_id uuid,recovery_request_id uuid,resume boolean)
language plpgsql security definer set search_path=private,public,pg_temp as $$
begin
  return query
  with claimed as (
    update private.student_password_reset_tokens t set state='claimed',payload_hmac=p_payload_hmac,claimed_at=now(),last_error=null
    where t.token_hash=p_token_hash and t.state='issued' and t.used_at is null and t.expires_at>now()
    returning t.id,t.user_id,t.recovery_request_id
  ) select c.id,c.user_id,c.recovery_request_id,false from claimed c;
  if found then return; end if;
  return query select t.id,t.user_id,t.recovery_request_id,true from private.student_password_reset_tokens t
    where t.token_hash=p_token_hash and t.state in('claimed','failed') and t.payload_hmac=p_payload_hmac and t.used_at is null and t.expires_at>now();
end $$;
revoke all on function private.claim_student_activation_token(text,text) from public,anon,authenticated;
revoke all on function private.claim_student_password_reset_token(text,text) from public,anon,authenticated;

do $$ declare t text; begin foreach t in array array['student_identity_settings','student_registration_requests','student_privacy_consents','student_profile_privacy_consents','student_sensitive_identities','student_identity_exceptions','student_code_reservations','student_identity_claims','student_login_identifiers','student_profile_status','student_profile_details','student_sensitive_change_requests','student_activation_tokens','student_account_recovery_requests','student_password_reset_tokens','student_identity_audit_events','student_identity_rate_limits'] loop execute format('alter table private.%I enable row level security',t);execute format('revoke all on private.%I from public,anon,authenticated',t);end loop;end $$;
comment on table private.student_sensitive_identities is 'Encrypted Egyptian national IDs. Decryption is server-only, separately authorized and audited.';
comment on table private.student_identity_settings is 'Fail-closed feature controls; production activation requires a separate reviewed operation.';
commit;
