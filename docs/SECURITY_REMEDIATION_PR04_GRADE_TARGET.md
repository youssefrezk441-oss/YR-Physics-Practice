# Security PR-04 — Direct browser grade-write closure (candidate only)

**Status:** Dependent TEST candidate; not deployed to production.

## Purpose

Student-owned RLS does not prevent self-tampering of `awarded_points` in `responses` or `score`/`max_score` in `attempts` while the `authenticated` PostgreSQL role has full-table `UPDATE` privileges. The production database grants both browser roles broad DML on these tables.

## Target boundary

`tools/security/candidate_attempt_response_write_lockdown.sql` removes browser `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES` and `TRIGGER` on `public.attempts` and `public.responses`; only `authenticated SELECT` is restored. Existing own-record/authorized-admin SELECT RLS remains the visibility gate. Database server-side privileged roles retain their separate grants.

**Critical dependency:** The secure `review_short_text_response` implementation in PR-03 must be deployed and verified **before** this grant change. Existing public RPC is presently `SECURITY INVOKER` and cannot continue grading after UPDATE is revoked.

## Tests in PR-04

The disposable PostgreSQL grading runner grants broad table privileges to synthetic browser roles, applies the candidate restriction, then installs the compatible secured grading RPC and exercises:
- Student cannot fabricate their own score, award points, insert an answer, or delete an answer.
- An authenticated student can still read their own attempts/responses under RLS.
- Admin with edit permission can grade short text through the secured RPC while direct client table UPDATE is denied.
- A view-only admin or student cannot call the privileged grading function successfully.
- Score totals/status match real production-equivalent trigger behavior; one audit event per actual change; concurrent identical retries are idempotent.
- None of these tests contacts Supabase production or uses real student data.

## Mandatory release gates

1. Deploy and verify PR-03 secure grader in a clean, synthetic-only Supabase-compatible test environment, including image uploads and administrative review pages.
2. Verify active production `student-practice` v13, unified workshop, chapter1/2 mistakes, class-tests and every legacy student submission path still uses privileged server-side write APIs. Some legacy sources are absent from Git.
3. Confirm admin/manual/AI grading, review flags and assessment-cycle snapshots remain correct after the grant change; test two student accounts and two admin permission levels.
4. Snapshot production grants/RLS/trigger definitions and verify a recoverable backup before a formal migration.
5. Apply restrictive grants only after backend compatibility cutover; monitor HTTP/RPC errors and a synthetic canary.
6. Do not automatically re-grant broad student DML on rollback. Use a controlled compatible endpoint or pause affected write operations while fixing the backend.

**No production GRANT or score has been altered by this candidate.**
