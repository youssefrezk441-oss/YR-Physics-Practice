-- EMERGENCY-ONLY rollback for student_profiles ACL, NOT automatic.
-- This reopens the original excessive browser privileges. Execute only
-- with explicit incident authorization if all safer routes fail.
-- No student data is changed. See docs before use.
BEGIN;
GRANT ALL PRIVILEGES ON TABLE public.student_profiles TO anon, authenticated;
DO $$
BEGIN
  IF NOT has_table_privilege('authenticated','public.student_profiles','UPDATE') OR
     NOT has_table_privilege('anon','public.student_profiles','UPDATE') THEN
     RAISE EXCEPTION 'Original grants not fully restored';
  END IF;
END $$;
COMMIT;
