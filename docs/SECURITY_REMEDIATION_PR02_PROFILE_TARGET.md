# PR-02 — Student profile write lockdown (candidate only)

**Status:** Draft, NOT deployed to Supabase. This PR does not itself change production role grants.

## Intended SQL

`tools/security/candidate_profile_write_lockdown.sql` removes all table privileges on `public.student_profiles` for `anon` and `authenticated` and restores only SELECT to `authenticated`, preserving existing own-row / permitted-admin RLS SELECT policies. Existing privileged service-role connections retain access. Legacy self-UPDATE RLS remains defined but is no longer reachable by the browser role; remove it in a follow-up migration after acceptance.

Why this is important: the current student own-row UPDATE policy does not stop changing `is_active`, `student_code`, `group_code`, `grade_level`, etc., because the table ACL grants broad UPDATE.

## Existing supported paths (inspected)

- `student-identity` (server) `complete_profile_v2`, `admin_profile_change_decide`, `admin_decide`, registration and activation use privileged server SQL.
- `admin-student` (server) `update_student`, `set_active`, create and registration workflows use its server's privileged DB connection.
- `student-profile-completion.js` calls `student-identity`; student and administrative HTML pages inspected do not directly use `supabase.from('student_profiles').update()` in the checked routes.
- The list above is **not** a blanket approval of all older scripts or installed browser clients. Complete the UI/Edge inventory and clean TEST acceptance matrix before production.

## Tests

`tools/security/run_profile_lockdown_synthetic.sh` creates a local PostgreSQL database and two synthetic student profiles. It applies the candidate SQL **locally** and verifies:

1. Student A reads only their profile under RLS, not Student B's.
2. An authenticated student cannot update `is_active` or `group_code`, or delete profile rows.
3. The normal privileged backend role can still edit the profile.
4. `anon` cannot write profiles.

The test is deliberately separate from real accounts. On the existing Supabase `YR Physics Restore Test` project the `public.student_profiles` table currently contains **280 records**, so **do not use it as a synthetic-only sandbox** until that data is securely segregated and ownership/backup status has been reviewed. No rows in that project were modified while preparing this PR.

## Release gates (mandatory before promoting candidate)

1. Establish a clean, disposable staging DB with **synthetic-only** student/admin accounts, or a transactionally isolated copy with no student data in the test namespace. Securely verify backup/restore and no production references.
2. Verify code paths for: legacy/approved/pending/suspended student; `complete_profile_v2`; student contact edits; profile change request/approval; create student; admin `set_active`; move student between groups; login and re-login after approval.
3. Verify admin view-only cannot edit profile, admin edit can, student cannot self-activate or edit identifiers from direct REST.
4. Check the source of every deployed function that writes `public.student_profiles` and any direct REST client not yet tracked in Git.
5. Create the proper timestamped Supabase migration using the CLI (`supabase migration new ...`); reconcile with current production state. Store and validate the reverse migration, applying it only in controlled rollback.
6. Validate production read-only access contracts and current role GRANT/RLS snapshots just before deploying. Run canary and monitor `student-identity` and `admin-student` errors.
7. Never return all DML to browser roles as an automatic rollback. Prefer reverting a compatible backend path or a narrowly scoped emergency RPC.

**State of this PR:** Candidate SQL + synthetic privilege tests only. No trigger, Edge Function or student record is altered by this PR.
