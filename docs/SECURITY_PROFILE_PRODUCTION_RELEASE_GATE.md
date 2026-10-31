# Production Security Release B — student profile ACL

**Implementation:** `tools/security/releases/release_profile_acl_production.sql`. This release changes only database **GRANT/REVOKE permissions** on `public.student_profiles`; it never updates, deletes or regrades a student.

## Baseline captured 2026-10-31

- `public.student_profiles` has RLS enabled; SELECT RLS policies restrict access to the student themselves or authorized student admins.
- The existing table ACL grants all permissions to `anon`, `authenticated`, and `service_role`, and postgres owns the table. No explicit per-column ACL was found.
- Backend `student-identity` (active v9) and `admin-student` (active v13) perform authorized profile mutations over privileged SQL. Local GoTrue/Edge/PG registration and profile-completion tests passed using the previous equivalent SQL candidate.
- `YR Physics Restore Test` contains 280 student rows, so it is NOT suitable for synthetic-only destructive tests.
- Original `anon` RLS SELECT has no matching policy, meaning it cannot read student profiles even though it has a broad table grant.

## Executable release steps

1. Confirm the exact protected script passes **both** the profile SQL fixture and two-pass local GoTrue registration / profile completion E2E, with no failing CI checks.
2. Independently confirm that a **recoverable latest production backup** exists (Supabase Database > Backups or a verified logical export). This is not currently observable through the available connector and MUST NOT be assumed. If no backup is confirmed, STOP before production.
3. Freeze concurrent profile-schema changes and inspect the active `student-identity` and `admin-student` Edge versions. Validate owner and edit admin can still call the identity/admin endpoints. Verify private backend SQL has sufficient grants.
4. Apply the exact prepared atomic DDL with Supabase `apply_migration`, giving it a unique descriptive snake_case name. Capture the returned migration version and mirror it in `supabase/migrations` through the project's documented migration procedure.
5. Immediately verify `has_table_privilege` shows only `authenticated SELECT`, no `anon` profile access and unchanged `service_role` writes. Check RLS still enabled, all profile row counts unchanged, and no unexpected Auth/Edge failures.
6. Check existing login, completion and admin decisions with existing user-supplied sessions ONLY for read-only probes; production mutation tests require owner authorization and dedicated approved canary, never real student data.

## Stop and rollback

- Stop the rollout on any 42501 errors in valid profile workflows, elevated 5xx rates or changed read policies.
- Reconcile compatible backend paths first. Never automatically grant unrestricted client writes as rollback.
- `tools/security/releases/EMERGENCY_ONLY_revert_profile_acl.sql` records the **original broad grant** only for a documented emergency. It is not an automatic action and reopens the original security gap.
- Rollback of this DDL changes permissions only; no student data restoration should be needed unless a separate unrelated write occurred.
- Full database backups are still required before other potentially state-changing migrations.

**Safety:** Production activation MUST remain separate from merging this code to main. A GitHub commit does not automatically apply Supabase DDL.
