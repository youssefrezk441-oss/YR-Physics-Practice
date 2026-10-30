-- CANDIDATE FOR PR-02, NOT YET APPROVED FOR PRODUCTION.
-- Applying to any environment removes direct browser writes to public.student_profiles.
-- Confirm all registration, profile completion and admin edit paths run through
-- authorized server-side connections BEFORE using this in a production migration.
BEGIN;
REVOKE ALL PRIVILEGES ON TABLE public.student_profiles FROM anon, authenticated;
GRANT SELECT ON TABLE public.student_profiles TO authenticated;
-- Retain the existing row-level SELECT policies. No browser role receives INSERT,
-- UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER privileges.
-- Existing service_role/postgres owners retain their separate grants.
COMMIT;
