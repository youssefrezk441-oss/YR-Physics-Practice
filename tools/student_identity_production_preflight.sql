-- READ ONLY. Run before either student identity migration.
-- This is not a backup. A separately VERIFIED restorable backup is required.
-- No personal records, passwords, access tokens, or student codes are returned.
with checks as (
  select 'required_student_tables'::text as check_name,
    to_regclass('public.student_profiles') is not null
      and to_regclass('public.student_groups') is not null
      and to_regclass('public.student_group_memberships') is not null as passed,
    'profiles/groups/memberships exist'::text as observation
  union all
  select 'no_existing_identity_schema',
    to_regclass('private.student_identity_settings') is null
      and to_regclass('private.student_account_reviews') is null,
    'new migrations have not already been applied'
  union all
  select 'student_code_present_and_unique',
    (select count(*) = count(distinct upper(regexp_replace(student_code,'[[:space:]]','','g')))
       and count(*) = count(student_code) and count(*) = count(nullif(trim(student_code),''))
     from public.student_profiles),
    'normalized student codes must be unique and nonblank'
  union all
  select 'no_multiple_active_memberships',
    not exists (
      select 1 from public.student_group_memberships
      where left_on is null group by user_id having count(*) > 1
    ),
    'one active membership maximum per user'
  union all
  select 'profiles_linked_to_auth',
    not exists(
      select 1 from public.student_profiles p
      left join auth.users u on u.id=p.user_id
      where u.id is null
    ),
    'all student profiles have an Auth user'
  union all
  select 'memberships_linked_to_auth',
    not exists(
      select 1 from public.student_group_memberships m
      left join auth.users u on u.id=m.user_id
      where u.id is null
    ),
    'all memberships have an Auth user'
  union all
  select 'groups_exist_for_profiles',
    not exists(
      select 1 from public.student_profiles p
      left join public.student_groups g on g.group_code=p.group_code
      where p.group_code is not null and g.group_code is null
    ),
    'all referenced groups exist'
  union all
  select 'admin_access_helper_exists',
    to_regprocedure('public.admin_access_level(text,uuid)') is not null,
    'administrative approval helper exists'
)
select check_name,case when passed then 'PASS' else 'FAIL' end result,observation
from checks order by check_name;