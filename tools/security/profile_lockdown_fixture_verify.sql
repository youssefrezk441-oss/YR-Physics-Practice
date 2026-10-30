\set ON_ERROR_STOP on
DO $$
BEGIN
 IF has_table_privilege('authenticated','public.student_profiles','UPDATE')
 OR has_table_privilege('authenticated','public.student_profiles','INSERT')
 OR has_table_privilege('authenticated','public.student_profiles','DELETE')
 OR has_table_privilege('authenticated','public.student_profiles','TRUNCATE')
 OR has_table_privilege('anon','public.student_profiles','UPDATE')
 OR has_table_privilege('anon','public.student_profiles','TRUNCATE') THEN
   RAISE EXCEPTION 'Direct student browser write privileges still exposed';
 END IF;
 IF NOT has_table_privilege('authenticated','public.student_profiles','SELECT') THEN
   RAISE EXCEPTION 'Student profile read unexpectedly revoked';
 END IF;
 IF NOT has_table_privilege('service_role','public.student_profiles','UPDATE') THEN
   RAISE EXCEPTION 'Privileged server profile edit unexpectedly removed';
 END IF;
END $$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
DO $$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM public.student_profiles;
 IF n<>1 THEN RAISE EXCEPTION 'RLS failed own-row read: %',n; END IF;
END $$;
DO $$
DECLARE rejected integer:=0;
BEGIN
 BEGIN EXECUTE 'UPDATE public.student_profiles SET is_active=false WHERE user_id=auth.uid()';
 EXCEPTION WHEN insufficient_privilege THEN rejected:=rejected+1; END;
 BEGIN EXECUTE 'UPDATE public.student_profiles SET group_code=''G2'' WHERE user_id=auth.uid()';
 EXCEPTION WHEN insufficient_privilege THEN rejected:=rejected+1; END;
 BEGIN EXECUTE 'DELETE FROM public.student_profiles WHERE user_id=auth.uid()';
 EXCEPTION WHEN insufficient_privilege THEN rejected:=rejected+1; END;
 IF rejected<>3 THEN RAISE EXCEPTION 'Client wrote student profile despite lockdown: % of 3 attempts were rejected',rejected; END IF;
END $$;
RESET ROLE;

-- Privileged backend retains legitimate profile update ability.
SET ROLE service_role;
UPDATE public.student_profiles SET group_code='ADMIN-APPROVED' WHERE user_id='00000000-0000-4000-8000-000000000001';
RESET ROLE;
DO $$
BEGIN
 IF NOT EXISTS(
   SELECT 1 FROM public.student_profiles
   WHERE user_id='00000000-0000-4000-8000-000000000001'
   AND group_code='ADMIN-APPROVED'
 ) THEN RAISE EXCEPTION 'Privileged server-side update blocked'; END IF;
END $$;
SELECT 'PASS: browser direct profile writes denied; student own-read and privileged server updates preserved' AS verified;
