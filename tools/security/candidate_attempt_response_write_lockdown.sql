-- PR-04 CANDIDATE: DO NOT EXECUTE IN PRODUCTION UNTIL PR-03 RPC IS ACTIVE
-- AND ALL STUDENT SUBMISSION/ADMIN GRADING TESTS PASS.
BEGIN;
REVOKE ALL PRIVILEGES ON TABLE public.attempts, public.responses
  FROM anon, authenticated;
-- Authenticated users retain read-only access; RLS further limits their rows.
GRANT SELECT ON TABLE public.attempts, public.responses TO authenticated;
-- Privileged server-side connections (postgres/service_role) retain their
-- existing grants to calculate scores, submit answers and grade essays.
COMMIT;
