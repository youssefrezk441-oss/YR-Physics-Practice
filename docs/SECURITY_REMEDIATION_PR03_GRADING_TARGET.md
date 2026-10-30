# Security PR-03: Protected manual essay grading candidate

**Status: TEST CANDIDATE. NOT PRODUCTION DEPLOYED.**

## Problem and dependency

The live `public.review_short_text_response(uuid,numeric,text)` RPC is called by
`reviews-admin.html` and `reviews-quick.html`, and directly updates the
`public.responses` and `public.attempts` tables while executing as
`SECURITY INVOKER`. Revoking broad `UPDATE` from the `authenticated`
role will therefore break the instructor's grading workflow unless a secure
compatible replacement is deployed first.

## What is prepared

- `tools/security/candidate_secure_manual_review.sql`: a candidate replacement preserving the **exact existing request argument names** and JSON response keys. Requires a real authenticated actor and `public.admin_has_access('essay_reviews','edit')`, using the existing DB-backed admin permission system. Set to `SECURITY DEFINER` with `search_path=pg_catalog`; all application tables/functions are explicitly schema-qualified.
- Verifies the target is a **submitted** attempt and a short-text question; checks grade bounds and rejects non-finite numerics; locks attempt before response to avoid competing review deadlocks.
- Performs score recomputation on the server. Writes a private `short_text_grade_audit` event containing actor, before and after, whenever the score, status, or feedback changes. Identical retries do not duplicate audit events.
- `REVOKE EXECUTE` for `anon` and `PUBLIC`, `GRANT EXECUTE` only for `authenticated`. Internal authorization still requires admin edit privileges.
- `tools/security/manual_grading_fixture_setup.sql`, `...verify.sql`, and `run_manual_grading_synthetic.sh` run on **local disposable PostgreSQL** with simulated student, view-only admin, edit admin and submitted/in-progress attempts.
- `tools/security/manual_grading_fixture_production_triggers.sql` replicates the active `recompute_attempt_from_responses` and `sync_attempt_after_response_review` trigger logic in local fixtures. The runner issues two concurrent identical grading requests and asserts a single audit event for the pair plus a consistent final attempt score.

## Deployment requirements and guardrails

1. **Do not run the candidate against production yet.** It is not a timestamped Supabase migration. Generate a migration using the installed CLI when TEST gates pass.
2. Test against a clean synthetic-only Supabase-compatible environment with the actual production RLS, admin permissions, grading triggers, and answer-image triggers. The isolated fixture does not clone these advanced triggers.
3. Verify concurrent instructor edits on the same attempt, normal grading, partial points, correction of already graded responses, repeated requests, and browser compatibility.
4. Confirm the new audit table has no browser grants or public exposure, and is protected by strict permissions. Any future admin audit reader needs explicit authorization.
5. Deploy the secured RPC **before** PR-04 removes direct `UPDATE/INSERT/DELETE` on `attempts` and `responses`; verify the RPC remains callable by an authorized instructor after those grants are revoked.
6. Rollback: keep the prior function body/ACL snapshot and the client-compatible API, but avoid reverting to unrestricted browser grade writes. Pause manual grading rather than silently bypassing authorization if an emergency arises.
7. Inspect and validate whether another grading route modifies `responses` or `attempts` outside this RPC; no grade-history mutation or bulk remediation is included in PR-03.

**No production students, grades, permissions, Edge Function, or data have been modified.**
