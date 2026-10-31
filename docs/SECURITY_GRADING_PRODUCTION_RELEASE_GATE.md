# Security release C — authenticated manual essay grading

**Current status: preparation only.** Production RPC remains SECURITY INVOKER until explicitly migrated.

This release adds `private.short_text_grade_audit` and replaces
`public.review_short_text_response(uuid,numeric,text)` with the exact
`SECURITY DEFINER` candidate already proven in synthetic PostgreSQL with
production-equivalent grading triggers and concurrent identical requests.

## Production preflight (read-only)

- Confirm the active function is still a three-argument `SECURITY INVOKER` with
  the existing JSON result used by `reviews-admin.html` and `reviews-quick.html`.
- Confirm `public.admin_has_access('essay_reviews','edit')` enforces live
  database-admin permissions based on the caller's `auth.uid()`.
- Review score-sync triggers `private.recompute_attempt_from_responses` and
  `private.sync_attempt_after_response_review` for drift since the test.
- Inspect grants on `public.questions`, `public.responses`, and
  `public.attempts`, and on the `private` schema.
- Confirm fresh, recoverable production backup and approved release window.
- Re-check first-run code against production schema before any live migration.

## Rollout

1. Deploy **only** `tools/security/releases/release_secure_manual_grading.sql`
   using a tracked, uniquely named Supabase migration.
2. Read-only verify function `prosecdef=true`, `search_path=pg_catalog`,
   `anon` has no EXECUTE, and authenticated retains EXECUTE.
3. Verify the private audit table has no client grants (and RLS/private schema
   is appropriately isolated).
4. Exercise authorized edit, student and view-only rejection with clean test
   principals. Do not grade or regrade real student responses as a canary.
5. Record exact migration version, verify live grading page remains compatible.
6. Only after this is live and healthy may Release D revoke browser DML on
   `attempts` and `responses`.

## Rollback

A function-body rollback alone is unsafe **after Release D** because the old
invoker function cannot update rows when browser grants are revoked. Rollback
must use a known compatible server-side grading implementation, not unrestricted
client writes. Keep the audit table intact for forensic traceability; do not
blindly drop it.

## Caveat

The selected function is a public SECURITY DEFINER RPC. It is intentionally
callable only by authenticated clients *and* has a server-side admin-edit gate.
This needs review under the Supabase advisor before production. If possible,
future architecture should move the privileged core into the `private` schema
with a minimal public adapter. No anonymous executable path is granted.
