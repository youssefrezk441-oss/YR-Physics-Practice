# Student Identity — Production release gate (2026-10-29)

This is a **readiness record, not an approval to deploy**. All production identity flags must remain disabled unless a separately checked release proceeds.

## Verified production snapshot

- Supabase project: `ltjdhconuiqblxfjzpzj` (YR Physics Practice), Free plan, PostgreSQL 17, ACTIVE_HEALTHY.
- Edge Functions: **97 / 100** deployed. `student-identity` is not deployed. Three function slots are available; no existing function needs deletion for this release.
- Current Supabase migration history: **104** migrations, last recorded `20261028150000_paper_homework_system`. Neither student identity migration is applied.
- Student profiles: **280**; Auth users: **288**; normalized student codes unique: **280**.
- Public attempts baseline: **1,515**; L3 event baseline: **6,033**. These are historical counts, not permanent expected values; record fresh baselines immediately before deployment.
- All eight checks in `tools/student_identity_production_preflight.sql` passed against production without writes.
- The branch PR #16 was in draft; the latest already-tested identity implementation and its local GoTrue CI are present. Before any release, check CI against the then-current head.

## Owner-reported local backups and offline verification (2026-10-29)

**Do not confuse archive integrity and row presence with a successful database restore.** The production data remains on a Free-plan project, and this is a non-sensitive progress record only.

- Local PostgreSQL custom-format archive created by owner at `2026-10-29_23-31-29`; `pg_restore --list` was readable.
- Owner ran offline restore verification: original SHA-256 checksum **MATCH**, complete archive stream could be decoded, but full plain-PostgreSQL restore **did not complete** (Supabase-managed schemas/extensions may be involved). Cause not yet proven, and full restoration remains **UNVERIFIED**.
- Offline archive-row checker v2 completed with `pg_restore=0` and `row-counter=0`; `public.student_profiles=280` MATCH, `auth.users=288` MATCH, `public.attempts=1515` MATCH, `storage.objects=138` MATCH; `public.l3_workshop_events=6033` FOUND (no original reference in the local snapshot, separately corroborated against production). No record-level private data shared.
- Owner's separate Storage backup reported `138/138` objects downloaded, `0` failures: 118 `answer-images` and 20 `question-assets`. Local-only source files and all exported objects must be kept private and encrypted. File-byte restore checks remain to be tested in an isolated destination.
- Owner reported provisioning the two production Edge Function secrets. **Secrets' actual presence and correctness not independently verifiable** via available MCP actions; never reveal their values.
- Latest production read-only snapshot during verification: 95 Edge Functions, 280 student profiles, 288 Auth users, 1,515 attempts, 138 Storage metadata objects; `student-identity` not yet deployed and feature migrations not applied.
- No new production identity migrations, Edge Functions, registration flags, Cron or student data were changed by these checks.

**Next gate:** demonstrate a restore to a truly isolated destination with Supabase-compatible extensions/managed schemas, reconcile Auth/Storage/grades, and document the outcome. A new test project may have cost; check and obtain the owner's cost approval before creating one. Do not use this production-data restore destination as the shared synthetic registration-test environment. Save evidence consisting of counts, status and sanitized error classes, not backup contents or credentials.

## Blocking prerequisites (must be completed first)

### 1. Restorable, current, off-site database backup — NOT VERIFIED

Supabase Free does not provide the Pro-plan daily scheduled backups. Use the official Supabase CLI / backup procedure with secure DB connection credentials, store the output **outside the public repository**, and conduct a restore verification on an isolated destination.

**Important:** the standard `supabase db dump` command excludes Supabase-managed `auth` and `storage` schemas by default. A standard roles/schema/data export alone **does not prove full recovery** of the 288 Auth users, sessions or Storage metadata. Verify an appropriate recovery approach for those managed schemas separately, and back up the actual Storage objects separately (Storage is not included in a database backup). The production project previously had 138 Storage objects in two buckets, but recheck these counts when backing up.

Official references:
- https://supabase.com/docs/guides/platform/backups
- https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
- https://supabase.com/docs/reference/cli/supabase-db-dump
- https://supabase.com/docs/guides/self-hosting/restore-from-platform

Do not reset the production database password without reviewing existing consumers. Never commit database dumps, connection strings or credentials.

### 2. Production secrets — NOT VERIFIED

The new `student-identity` Edge Function reads:
- `STUDENT_IDENTITY_ENCRYPTION_KEY_B64` (independent random 32-byte key, Base64)
- `STUDENT_IDENTITY_HMAC_KEY_B64` (independent random 32-byte key, Base64)

The available ChatGPT Supabase connector has no operation to read or set Edge Function secrets. Provision via the secure Supabase Dashboard/CLI secrets flow, **never in Git, conversation text, or public UI**. Do not copy local synthetic test keys to production. Verify the secrets are configured without returning their plaintext.

Reference: https://supabase.com/docs/guides/functions/secrets

### 3. Controlled release prerequisites

- Compare both migrations against the live schema and check all relevant RLS/policies.
- Confirm the new Edge Function bundle includes required relative `_shared` modules, and plan a secured deployment with endpoint-level auth checks. This endpoint has public registration actions, but admin actions must validate Auth JWT and server-side permissions.
- Ensure flags remain **off** immediately after the additive migrations.
- Use server-verified, single-use invitations with a limited rollout; never open general registration during synthetic canary testing.
- The local GoTrue / Chromium tests do **not** substitute for cloud verification.
- Keep national ID collection, SMS/phone login, profile enforcement, and general public registration disabled pending their separate approvals.
- The 48-hour account is intentionally `review_only` until the admin approves. Do not enable educational access until legacy Edge Function and RLS coverage is proven.
- Validate an immediate kill switch and rollback of front-end/function without destroying newly-created records or changing legacy student IDs, codes, attempts or grades.

## Steps once prerequisites are met

1. Re-run `tools/student_identity_production_preflight.sql` and capture private dated baseline.
2. Verify backup + isolated restore proof and secure secret readiness.
3. Apply `20261028190000_student_identity_registration_v1.sql`, then `20261028230000_immediate_registration_review.sql`. Check migration history and closed flags.
4. Deploy `student-identity`, smoke test public `config` while registration is off, test admin RBAC and unauthorized access.
5. Set up the periodic review-expiry schedule only after isolated validation.
6. Deploy frontend only when backend is healthy; preserve legacy student entry.
7. Enable `limited` rollout only for synthetic invite holders. Verify registration, code display, immediate Auth login, pending status, approval, suspension and reactivation.
8. Reconcile before/after student/account/grade/attempt snapshots. Keep public registration disabled until privacy, CAPTCHA and the remaining controls are approved.

## Current decision

**HOLD — no production identity migrations, Edge Function deployment, Cron change, frontend merge or registration flag changes until the backup and secrets gates are verified.**
