# Profile-enforcement readiness

`profile_enforcement_enabled` remains false. The migration also prevents enabling it unless an explicit coverage approval timestamp and approver are recorded.

Before approval, every student route must be inventoried: login/bootstrap, unified workshops, chapter mistake workshops, homework submission and reports, exams, image upload, essay grading, and any function whose deployed source is absent from this repository. Each route needs tests for legacy and new accounts, inactive accounts, group membership, incomplete profile, normal completion, and safe recovery from identity-service failure.

The current browser bootstrap test proves only page behavior with mocks. It does not prove Supabase Auth, database relationships, RLS, or deployed Edge Functions. Those require the separate staging integration workflow and synthetic accounts. Until that suite passes against a non-production project, server enforcement is a production blocker.

`node tools/audit_student_profile_enforcement.mjs` inventories relevant checked-in pages and functions and fails if the database default or approval guard is removed. It is intentionally not a claim of full route coverage; the PR workflow labels the remaining Staging/deployed-source gap explicitly.
