begin;

alter table private.student_identity_settings
  add column if not exists immediate_registration_enabled boolean not null default false,
  add column if not exists registration_rollout_scope text not null default 'disabled'
    check (registration_rollout_scope in ('disabled','staging','limited','all')),
  add column if not exists registration_rollout_group_codes text[] not null default '{}'::text[];

alter table private.student_registration_requests
  add column if not exists client_request_hmac text,
  add column if not exists student_phone_hmac text,
  add column if not exists registration_subject_hmac text,
  add column if not exists identity_review_required boolean not null default false;
create unique index if not exists student_registration_client_request_uq
  on private.student_registration_requests(client_request_hmac) where client_request_hmac is not null;
create unique index if not exists student_registration_phone_claim_uq
  on private.student_registration_requests(student_phone_hmac)
  where student_phone_hmac is not null and status not in ('rejected','cancelled');
create unique index if not exists student_registration_subject_claim_uq
  on private.student_registration_requests(registration_subject_hmac)
  where registration_subject_hmac is not null and status not in ('rejected','cancelled');

alter table private.student_registration_requests drop constraint if exists student_registration_requests_check;
alter table private.student_registration_requests add constraint student_registration_identity_path_check check (
  (not national_id_exception_requested and national_id_hmac is not null and birth_date is not null and not identity_review_required)
  or (national_id_exception_requested and national_id_hmac is null and birth_date is not null and not identity_review_required)
  or (identity_review_required and national_id_hmac is null)
);
alter table private.student_registration_requests drop constraint if exists student_registration_requests_provisioning_status_check;
alter table private.student_registration_requests add constraint student_registration_provisioning_status_check check (
  provisioning_status in ('not_started','auth_creating','auth_created','profile_created','activation_issued','activated','review_pending','failed')
);
alter table private.student_privacy_consents drop constraint if exists student_privacy_consents_consent_kind_check;
alter table private.student_privacy_consents add constraint student_privacy_consent_kind_check check (
  consent_kind in ('registration_and_identity_processing','registration_profile_processing')
);

create table if not exists private.student_account_reviews (
  user_id uuid primary key references auth.users(id) on delete restrict,
  request_id uuid not null unique references private.student_registration_requests(id) on delete restrict,
  status text not null default 'pending_review' check (status in (
    'pending_review','approved','suspended_pending_approval','rejected','suspended_by_admin'
  )),
  access_scope text not null default 'review_only' check (access_scope in ('review_only','full','none')),
  review_started_at timestamptz not null,
  review_deadline_at timestamptz not null,
  decided_at timestamptz,
  decided_by uuid references auth.users(id) on delete restrict,
  decision_reason text,
  previous_status text,
  updated_at timestamptz not null default now(),
  check (review_deadline_at = review_started_at + interval '48 hours')
);
create index if not exists student_account_reviews_status_deadline_idx
  on private.student_account_reviews(status,review_deadline_at);

create or replace function private.student_account_access(p_user_id uuid,p_now timestamptz default now())
returns table(status text,access_scope text,review_deadline_at timestamptz,allowed boolean,legacy_account boolean)
language plpgsql security definer set search_path=private,public,pg_temp as $$
declare r private.student_account_reviews%rowtype; active boolean;
begin
  select is_active into active from public.student_profiles where user_id=p_user_id;
  select * into r from private.student_account_reviews where user_id=p_user_id for update;
  if not found then
    return query select case when active then 'approved' else 'suspended_by_admin' end,
      case when active then 'full' else 'none' end,null::timestamptz,coalesce(active,false),true;
    return;
  end if;
  if r.status='pending_review' and p_now>=r.review_deadline_at then
    update private.student_account_reviews set status='suspended_pending_approval',access_scope='none',
      previous_status='pending_review',updated_at=p_now where user_id=p_user_id;
    update public.student_profiles set is_active=false,updated_at=p_now where user_id=p_user_id;
    r.status='suspended_pending_approval';r.access_scope='none';
  end if;
  return query select r.status,r.access_scope,r.review_deadline_at,
    r.status='approved' and r.access_scope='full',false;
end $$;
revoke all on function private.student_account_access(uuid,timestamptz) from public,anon,authenticated;

create or replace function private.suspend_expired_student_reviews(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path=private,public,pg_temp as $$
declare affected integer;
begin
  with expired as (
    update private.student_account_reviews set status='suspended_pending_approval',access_scope='none',
      previous_status='pending_review',updated_at=p_now
    where status='pending_review' and review_deadline_at<=p_now returning user_id
  ), profiles as (
    update public.student_profiles p set is_active=false,updated_at=p_now
    where p.user_id in(select user_id from expired)
  ) select count(*) into affected from expired;
  return affected;
end $$;
revoke all on function private.suspend_expired_student_reviews(timestamptz) from public,anon,authenticated;

alter table private.student_account_reviews enable row level security;
revoke all on private.student_account_reviews from public,anon,authenticated;
comment on table private.student_account_reviews is
  'Review state for accounts created by immediate registration. Absence means a legacy account; legacy students never receive the 48-hour deadline.';
commit;
