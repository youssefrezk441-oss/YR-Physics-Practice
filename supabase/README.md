# Supabase safety and deployment notes

This directory is a partial, reviewable export. It is not proof of the complete production schema.

## Verified from this repository

- Student workshop writes for lectures 3, 4 and 6 go through Edge Functions and derive `user_id` from a verified bearer token.
- Those functions serialize each student's question-part transaction with a PostgreSQL advisory lock and keep append-only attempt events.
- Workshop answer keys are read from the `private` schema, not returned by list endpoints.
- The Azhar submissions tables are in `private` and revoke access from `public`, `anon` and `authenticated`.
- Migration-created L6 `public` tables enable RLS. No browser policies for them are checked in; the Edge Function uses the database connection directly.
- The checked-in migrations do not define the full platform tables, RPCs, storage policies or the main `student-practice` backend.

## Not verified in production

The current environment has no Supabase CLI login, project link, database URL or service credential. The public PostgREST schema endpoint also requires a secret API key and returned `401`, so production policies and deployed function hashes could not be compared safely.

Do not infer production RLS from frontend behavior. Before a database or Edge deployment, export and review at least:

1. all schemas, tables, constraints, functions and grants;
2. `pg_policies` and RLS enable/force state;
3. storage buckets and `storage.objects` policies;
4. deployed Edge Function names, versions, JWT settings and secrets names;
5. migration history and a restorable backup identifier.

## Staging order

1. Restore a recent anonymized production schema to a separate Supabase project.
2. Confirm no real email, phone, answer image or access token is present.
3. Apply only pending migrations in timestamp order. Never replay the 2026-09 repair migrations against an unknown migration history.
4. Deploy the changed Edge Functions to staging.
5. Run synthetic student/admin authorization, concurrency and grading tests.
6. Record schema and function diffs, backup ID and rollback commands.
7. Request explicit production approval. Database migrations and Edge deployments are separate approvals from GitHub Pages.

## Answer-key versioning foundation

`20261022090000_answer_key_versioning_foundation.sql` is additive and does not backfill or regrade existing responses. It provides immutable key versions, two-person activation, grading-decision history, impact previews, approvals and append-only execution events.

It intentionally does not guess how missing production attempt tables map to `attempt_ref` and `response_ref`. That adapter must be implemented after the production schema export is available and tested on staging. No historical attempt may be attached to a key version by assumption.

## Unified second-term workshop engine

`20261024100000_unified_workshop_system.sql` is a separate additive model for new workshops. It creates only `private.workshop_*` objects, does not refer to L3/L4/L5/L6 data, and contains no data deletion or backfill. `unified-workshop` is the authenticated student API; `admin-unified-workshop` is the permission-checked analytics and administration API.

The L1 seed is deliberately not checked in because it contains teacher keys. Generate it from the validated package into `/tmp` or `.workshop-private`, and apply it to anonymized staging only. It imports the workshop as `draft` with a `validated` version; publishing remains a separate reviewed operation.

Answer-key correction on the new engine is implemented end-to-end in source: create an immutable candidate, preview impact, approve with a distinct administrator, then explicitly execute. Execution rechecks the complete population, activates the key and appends superseding grading decisions in one transaction. Original attempts, submissions, scores and decisions remain stored.

## Azhar pause

The student page is excluded from GitHub Pages. The checked-in Edge Function now also defaults all non-admin actions to HTTP `410` unless `AZHAR_EXAM_PUBLIC_ENABLED=true` is deliberately configured. This source guard is not live until that function is separately tested and deployed. Administrative historical reads remain supported.
