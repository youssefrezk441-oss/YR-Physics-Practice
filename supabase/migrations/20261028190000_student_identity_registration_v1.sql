begin;
create schema if not exists private;

create table if not exists private.student_identity_settings(
  singleton boolean primary key default true check(singleton),
  registration_enabled boolean not null default false,
  phone_login_enabled boolean not null default false,
  profile_update_enabled boolean not null default false,
  profile_enforcement_enabled boolean not null default false,
  required_profile_schema_version integer not null default 1 check(required_profile_schema_version>0),
  sms_provider_ready boolean not null default false,
  privacy_notice_version text not null default 'draft-v1',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete restrict,
  notes text not null default 'All identity features remain fail-closed until separately approved.' check(length(notes) between 8 and 1000)
);
insert into private.student_identity_settings(singleton) values(true) on conflict(singleton) do nothing;

create table if not exists private.student_registration_requests(
  id uuid primary key default gen_random_uuid(), public_ref uuid not null unique default gen_random_uuid(),
  status text not null default 'pending' check(status in('pending','needs_information','approved','rejected','cancelled')),
  provisioning_status text not null default 'not_started' check(provisioning_status in('not_started','auth_created','profile_created','activation_issued','activated','failed')),
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
  requested_group_code text references public.student_groups(group_code) on update cascade on delete restrict,
  assigned_group_code text references public.student_groups(group_code) on update cascade on delete restrict,
  auth_user_id uuid references auth.users(id) on delete restrict,
  assigned_student_code text,
  decision_reason text, decided_at timestamptz, decided_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check((national_id_exception_requested and national_id_hmac is null and birth_date is not null) or (not national_id_exception_requested and national_id_hmac is not null and birth_date is not null)),
  check(guardian_phone_e164 is not null or guardian_phone_exception_requested),
  check((status in('approved','rejected') and decided_at is not null and decided_by is not null) or status in('pending','needs_information','cancelled'))
);
create unique index if not exists student_registration_national_hmac_uq on private.student_registration_requests(national_id_hmac) where national_id_hmac is not null and status<>'cancelled';
create index if not exists student_registration_status_time_idx on private.student_registration_requests(status,created_at desc);
create index if not exists student_registration_phone_idx on private.student_registration_requests(student_phone_e164);

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

create or replace function private.reserve_next_student_code(p_group_code text)
returns text language plpgsql security definer set search_path=private,public,pg_temp as $$
declare prefix text; next_no integer; result text;
begin
  if not exists(select 1 from public.student_groups where group_code=p_group_code and is_active) then raise exception 'active group required'; end if;
  prefix=regexp_replace(upper(p_group_code),'-[^-]+$','-');
  perform pg_advisory_xact_lock(hashtextextended('student-code:'||prefix,0));
  select coalesce(max((regexp_match(student_code,'([0-9]+)$'))[1]::integer),0)+1 into next_no from public.student_profiles where student_code like prefix||'%';
  result=prefix||lpad(next_no::text,3,'0');
  if exists(select 1 from public.student_profiles where student_code=result) then raise exception 'student code collision'; end if;
  return result;
end $$;
revoke all on function private.reserve_next_student_code(text) from public,anon,authenticated;

do $$ declare t text; begin foreach t in array array['student_identity_settings','student_registration_requests','student_sensitive_identities','student_identity_exceptions','student_login_identifiers','student_profile_status','student_profile_details','student_sensitive_change_requests','student_activation_tokens','student_account_recovery_requests','student_password_reset_tokens','student_identity_audit_events','student_identity_rate_limits'] loop execute format('alter table private.%I enable row level security',t);execute format('revoke all on private.%I from public,anon,authenticated',t);end loop;end $$;
comment on table private.student_sensitive_identities is 'Encrypted Egyptian national IDs. Decryption is server-only, separately authorized and audited.';
comment on table private.student_identity_settings is 'Fail-closed feature controls; production activation requires a separate reviewed operation.';
commit;
