# YR Physics Practice — Security remediation PR-01: evidence and safe test gate

**Date:** 2026-10-31 (Africa/Cairo)  
**Production project:** `ltjdhconuiqblxfjzpzj`  
**Work policy:** Discovery and synthetic tests only. This PR does **not** change any production data, permissions, schema, grades, Auth settings, Storage policies, or deployed functions.

## Verified evidence from production metadata (read-only)

Postgres catalogs showed the following for the `authenticated` role:

| Public table | RLS | Direct DML at table scope | Student own-row UPDATE policy | Protected columns exposed to UPDATE |
|---|---|---|---|---|
| `student_profiles` | enabled | SELECT, INSERT, UPDATE, DELETE | yes | `is_active`, `group_code`, `grade_level`, `student_code`, etc. |
| `attempts` | enabled | SELECT, INSERT, UPDATE, DELETE | yes | `score`, `max_score`, `percentage`, `status`, `submitted_at` |
| `responses` | enabled | SELECT, INSERT, UPDATE, DELETE | yes | `awarded_points`, `grading_status`, `reviewed_at` |

- Per-column UPDATE restrictions currently absent for those tables: ACLs grant UPDATE on entire tables, with zero explicit column ACLs.
- Owner-bound RLS is useful for isolating one student's rows from another but **does not** constrain which columns an owner edits.
- `private.recompute_attempt_from_responses()` derives a score from `responses.awarded_points`. `private.sync_attempt_after_response_review()` also re-sums awarded points.
- `student_profiles` has **no applicable UPDATE trigger** in the inspected production trigger list.
- Other triggers protect some portions of the grading flow, but do not provide a general prohibition on client-supplied scores.
- Production had 289 student profiles, 1,516 attempts, and 8,020 response rows when inspected. These are counts, not extracted student data.
- A read-only anomaly count found zero attempts whose score exceeds max_score, and zero percentages over 100. This does **not** rule out tampering within plausible ranges.

**Classification:** Confirmed excessive permissions; credible self-tampering pathway. No active exploit or modifications to real student records were attempted. Whether past records were manipulated is not established.

## Existing interfaces and server dependencies

1. **`student-practice` Edge Function (live v13; source not tracked in Git):** handles `start` and `submit_attempt`; creates attempts and responses and calculates scores using privileged server SQL. It is expected to continue working after removing browser DML, subject to TEST verification.
2. **`review_short_text_response` public RPC:** existing admin review pages `reviews-admin.html` and `reviews-quick.html` call this function. It is presently `SECURITY INVOKER` and updates both `responses` and `attempts`. Merely revoking table UPDATE from `authenticated` will break this workflow unless a secure review path is shipped and tested **before** revocation.
3. **`student-identity` Edge Function (live v8) and `admin-student` Edge Function (live v13):** current supported student/admin profile-update workflows. Enforce group/profile/status changes here, not via raw browser updates.
4. **Student registration/review state:** `private.student_account_access` determines legacy versus review-managed access; `is_active` alone is insufficient for some accounts. Server guard work must respect review deadlines and approved exceptions.
5. **`unified-workshop` and other workshop endpoints:** currently check authentication, grade/group and/or active flag, but do not universally enforce `profile_schema_version`. Add server enforcement after identity and grade-write surfaces have regression tests.
6. **RLS for `class_test_scores`:** its own policy appears admin-only for writes, but it still has broadly granted DML at table scope and depends on RLS. Keep on audit checklist, do not infer a proven unauthorized edit.

## Regression harness added now

- `tools/security/legacy-authz-synthetic.sql` sets up **two made-up students** in disposable PostgreSQL.
- It replicates the production own-row RLS + table-wide DML privilege structure in a **minimal synthetic schema** (not actual student records).
- It proves an owner can change their own `is_active`, `group_code`, `score`, and `awarded_points`, and cannot mutate a different student's attempt.
- It then removes all client writes **in that disposable database only**, and verifies each sensitive update is rejected.
- `tools/security/run_legacy_authz_synthetic.sh` starts and destroys a local Postgres Docker container.
- CI runs the test in the identity PR checks. No secrets, live bearer tokens or real student identities are needed.

**Interpretation:** This confirms the dangerous permission structure and defines the target access boundary. It is *not* a full live API exploitation test and cannot independently prove all production triggers behave like the fixture.

## Ordered release plan (subsequent PRs; do not merge together)

### PR-02 — Student profile column protection

- Identify EVERY browser and Edge Function writer for `student_profiles`.
- Ensure `complete_profile_v2`, student change requests, registration activation, admin decisions, and any legacy administrative edits work through privileged, audited server paths.
- Revoke direct client UPDATE on status/code/group/grade/ownership (potentially all student profile DML), without breaking the student profile SELECT RLS.
- In TEST, use two synthetic students (old/new), admin-view, admin-edit, pending-review, suspended, and expired accounts.
- Release only when neither student can self-activate or switch groups and all normal profile updates still work.

### PR-03 — Harden manual grading before removing DML

- Move `review_short_text_response` to a verified privileged route or tightly scoped `SECURITY DEFINER` function with fail-closed checks, locked-down `search_path`, strict EXECUTE grants, grade bounds, owner audits and idempotency/concurrency handling.
- Preserve UI contract, review history, and score recomputation. Validate admin edit succeeds, admin view and students fail.
- Do not rely on a frontend-only permission check.

### PR-04 — Remove direct student grade/response/attempt write access

- Once PR-03 is live and verified, remove browser UPDATE/INSERT/DELETE on `attempts` and `responses`; retain student own-record read RLS as required.
- `student-practice` / appropriate service-authorized functions perform all mutations.
- Run local/TEST submission matrix for MCQ/numeric/essay, retry, partial grading, answer-image, cancelled/graded attempts, race/replay and both grades.
- Verify legacy class score workflows, chapter boards and historical results stay unchanged.

### PR-05 — Enforce account completion across servers

- Central server guard for `student_account_access`, `is_active`, `profile_schema_version`, chapter/grade/group, and exceptions.
- Test direct API access independently of JavaScript navigation. Include older existing student accounts and pending review cases.

### PR-06 — Historical, read-only integrity audit and observability

- Compare attempts against valid scored responses, review/audit history, timestamps and assessment cycle snapshots.
- Generate suspect-event report only; **no automatic grade changes**.
- Add deploy gates to detect regressions in grants/RLS and service/Edge source drift.

## Release and rollback safety gates

1. Before each deployment save schema/GRANT/RLS/trigger definitions, active Edge source + version, static artifact hash, and a verified recoverable backup.
2. TEST/staging is **not production** and must contain synthetic student records only. Do not run the permission-write test against real Supabase.
3. Deploy compatible backend components first where needed, test on TEST, then apply restrictive grants; UI last as dictated by route compatibility.
4. Rollback must restore a **compatible** code/schema pair. Avoid blindly re-granting wide access (would re-open the vulnerability).
5. Every phase must get read-only post-deploy checks and owner signoff before proceeding.

## Follow-up read-only inventory SQL

```sql
SELECT c.relname AS table_name, c.relrowsecurity AS rls,
       has_table_privilege('authenticated',c.oid,'INSERT') AS can_insert,
       has_table_privilege('authenticated',c.oid,'UPDATE') AS can_update,
       has_table_privilege('authenticated',c.oid,'DELETE') AS can_delete
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public'
  AND c.relname IN ('student_profiles','attempts','responses','class_test_scores')
  AND c.relkind='r' ORDER BY c.relname;
SELECT tablename,policyname,cmd,qual,with_check FROM pg_policies
WHERE schemaname='public'
  AND tablename IN ('student_profiles','attempts','responses')
ORDER BY tablename,cmd,policyname;
```

**Stop point of PR-01:** Accept evidence and reproducible local tests. This PR by itself does not fix the vulnerability; subsequent PRs will make the failing secure boundary the production default.
