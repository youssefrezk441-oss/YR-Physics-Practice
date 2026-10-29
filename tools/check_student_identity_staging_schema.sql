do $$
declare missing text[] := array[]::text[]; academic_count integer := 0;
begin
  if to_regclass('public.student_profiles') is null then missing:=array_append(missing,'public.student_profiles'); end if;
  if to_regclass('public.student_groups') is null then missing:=array_append(missing,'public.student_groups'); end if;
  if to_regclass('public.student_group_memberships') is null then missing:=array_append(missing,'public.student_group_memberships'); end if;
  if to_regclass('private.student_registration_requests') is null then missing:=array_append(missing,'private.student_registration_requests'); end if;
  if to_regclass('private.student_account_reviews') is null then missing:=array_append(missing,'private.student_account_reviews'); end if;
  if to_regclass('private.student_registration_invites') is null then missing:=array_append(missing,'private.student_registration_invites'); end if;
  if to_regprocedure('public.admin_access_level(text,uuid)') is null then missing:=array_append(missing,'public.admin_access_level(text,uuid)'); end if;
  if to_regclass('private.workshop_attempt_events') is not null then academic_count:=academic_count+1; end if;
  if to_regclass('private.workshop_grading_decisions') is not null then academic_count:=academic_count+1; end if;
  if to_regclass('private.homework_attempts') is not null then academic_count:=academic_count+1; end if;
  if cardinality(missing)>0 then raise exception 'staging schema is incomplete: %',array_to_string(missing,', '); end if;
  if academic_count<2 then raise exception 'staging must contain at least two real attempt/grading tables'; end if;
  if to_regclass('public.synthetic_admin_permissions') is not null
     or to_regclass('public.synthetic_student_attempts') is not null
     or to_regclass('public.synthetic_student_grades') is not null then
    raise exception 'legacy synthetic fixture tables must not exist in cloud staging';
  end if;
end $$;

do $$ begin
  if exists(select 1 from private.student_identity_settings where singleton and
    (registration_enabled or immediate_registration_enabled or registration_rollout_scope<>'disabled'
     or phone_login_enabled or profile_update_enabled
     or profile_enforcement_enabled or national_id_collection_enabled or sms_provider_ready)) then
    raise exception 'all student identity feature flags must be closed before staging E2E';
  end if;
end $$;
