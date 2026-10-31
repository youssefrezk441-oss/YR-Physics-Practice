-- PRODUCTION RELEASE STEP B: student_profiles browser write lockdown.
-- Executable only after clean synthetic GoTrue E2E has passed.
-- DDL ONLY: no student data or grading rows are touched.
BEGIN;
DO $verify$
BEGIN
  IF to_regclass('public.student_profiles') IS NULL THEN
    RAISE EXCEPTION 'Missing student_profiles table';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='student_profiles'
      AND c.relkind='r' AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'student_profiles RLS unexpectedly disabled';
  END IF;
  IF NOT has_table_privilege('service_role','public.student_profiles','UPDATE') OR
     NOT has_table_privilege('service_role','public.student_profiles','INSERT') THEN
    RAISE EXCEPTION 'Privileged student identity/admin writer not available';
  END IF;
  IF NOT has_table_privilege('authenticated','public.student_profiles','SELECT') THEN
    RAISE EXCEPTION 'Authenticated profile reading must remain available';
  END IF;
END
$verify$;

-- RLS still governs student and approved-admin SELECT rows. The existing
-- owner UPDATE policy is unreachable through REST once grants are removed.
REVOKE ALL PRIVILEGES ON TABLE public.student_profiles FROM anon, authenticated;
GRANT SELECT ON TABLE public.student_profiles TO authenticated;

DO $assert$
BEGIN
  IF has_table_privilege('authenticated','public.student_profiles','INSERT')
     OR has_table_privilege('authenticated','public.student_profiles','UPDATE')
     OR has_table_privilege('authenticated','public.student_profiles','DELETE')
     OR has_table_privilege('anon','public.student_profiles','INSERT')
     OR has_table_privilege('anon','public.student_profiles','UPDATE')
     OR has_table_privilege('anon','public.student_profiles','DELETE') THEN
    RAISE EXCEPTION 'Student browser profile write privileges remain';
  END IF;
  IF NOT has_table_privilege('authenticated','public.student_profiles','SELECT')
    OR NOT has_table_privilege('service_role','public.student_profiles','UPDATE')
    OR has_table_privilege('anon','public.student_profiles','SELECT') THEN
    RAISE EXCEPTION 'Unexpected client read / backend write grants after release';
  END IF;
END
$assert$;
COMMIT;
