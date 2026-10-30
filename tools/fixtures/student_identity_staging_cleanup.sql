-- Only the E2E runner substitutes __RUN_ID__. The run id is restricted to [A-Za-z0-9-].
begin;
delete from private.student_registration_invite_redemptions where invite_id in(select id from private.student_registration_invites where label='e2e:__RUN_ID__');
-- Remove only invitation audit records proven to belong to this synthetic run.
delete from private.student_identity_audit_events where event_type='registration_invite_created'
  and metadata->>'invite_id' in (
    select id::text from private.student_registration_invites where label='e2e:__RUN_ID__'
  );
delete from private.student_registration_invites where label='e2e:__RUN_ID__';
create temporary table e2e_requests on commit drop as
  select id from private.student_registration_requests
  where residence_area = 'e2e:__RUN_ID__';
create temporary table e2e_users on commit drop as
  select id from auth.users where raw_app_meta_data->>'synthetic_run'='__RUN_ID__'
  union select r.auth_user_id from private.student_registration_requests r
    join e2e_requests er on er.id=r.id where r.auth_user_id is not null
  union select u.id from auth.users u join private.student_registration_requests r
    on u.raw_app_meta_data->>'registration_request_id'=r.public_ref::text
    join e2e_requests er on er.id=r.id;

delete from private.student_identity_audit_events
 where request_id in(select id from e2e_requests)
    or actor_user_id in(select id from e2e_users)
    or subject_user_id in(select id from e2e_users);
delete from private.student_account_reviews where request_id in(select id from e2e_requests) or user_id in(select id from e2e_users);
delete from private.student_password_reset_tokens
 where user_id in(select id from e2e_users)
    or recovery_request_id in(
      select id from private.student_account_recovery_requests
       where subject_user_id in(select id from e2e_users)
          or decided_by in(select id from e2e_users)
    );
delete from private.student_account_recovery_requests
 where subject_user_id in(select id from e2e_users)
    or decided_by in(select id from e2e_users);
delete from private.student_activation_tokens where request_id in(select id from e2e_requests) or user_id in(select id from e2e_users);
delete from private.student_privacy_consents where request_id in(select id from e2e_requests);
delete from private.student_code_reservations where request_id in(select id from e2e_requests);
delete from private.student_identity_claims where request_id in(select id from e2e_requests) or user_id in(select id from e2e_users);
delete from private.student_registration_requests where id in(select id from e2e_requests);

delete from private.student_profile_privacy_consents where user_id in(select id from e2e_users);
delete from private.student_sensitive_change_requests where user_id in(select id from e2e_users);
delete from private.student_sensitive_identities where user_id in(select id from e2e_users);
delete from private.student_identity_exceptions where user_id in(select id from e2e_users);
delete from private.student_login_identifiers where user_id in(select id from e2e_users);
delete from private.student_profile_change_requests where user_id in(select id from e2e_users);
delete from private.student_profile_status where user_id in(select id from e2e_users);
delete from private.student_profile_details where user_id in(select id from e2e_users);
do $$ begin
  if to_regclass('private.local_e2e_academic_sentinel') is not null then
    execute 'delete from private.local_e2e_academic_sentinel where user_id in(select id from e2e_users)';
  end if;
  if to_regclass('public.local_e2e_admin_permissions') is not null then
    execute 'delete from public.local_e2e_admin_permissions where user_id in(select id from e2e_users)';
  end if;
end $$;
delete from public.student_group_memberships where user_id in(select id from e2e_users);
delete from public.student_profiles where user_id in(select id from e2e_users);
delete from public.student_groups where group_code='__GROUP_CODE__'
  and not exists(select 1 from public.student_group_memberships m where m.group_id=student_groups.id);
delete from public.student_groups where group_code='__SECOND_GROUP_CODE__'
 and not exists(select 1 from public.student_group_memberships m where m.group_id=student_groups.id);
commit;
