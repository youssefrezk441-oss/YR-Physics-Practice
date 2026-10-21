# YR Physics Practice — Agent Guide

## System status

This is a production educational system containing real student profiles, attendance, grades, attempts and answer images. Treat all records as sensitive data.

## Mandatory safety rules

- Do not write to production Supabase during inspection or automated tests.
- Do not delete, migrate or regrade student data without a verified backup, staging rehearsal and rollback plan.
- Do not use real student accounts in tests.
- Never expose service-role keys, database URLs, passwords, resume tokens or signed student-image URLs.
- Do not deploy or push changes without explicit user approval.
- Preserve unrelated user changes and keep the working tree understandable.
- The browser UI is not a security boundary; enforce permissions in Edge Functions, RPCs and RLS.

## Architecture

- GitHub Pages serves the static student and admin interfaces.
- Supabase provides Auth, Database, Storage and Edge Functions.
- `student.html` and `student-base.html` compose the student interface.
- `*-admin.html` files are administrative interfaces.
- `supabase/functions/` contains only the server functions checked into this repository; do not assume it is a complete export of production.
- `supabase/migrations/` contains reviewed database changes. Creating a migration file does not authorize deploying it.
- `whatsapp-bridge/` is a separate local operational tool.

## Data invariants

- Preserve original submissions and attempt events.
- A regrade must keep the prior result, identify the answer-key version and record who authorized the change and why.
- Assisted or revealed work must never be counted as direct mastery.
- A manager with view-only access must have no server-side write path.
- Do not delete answer images before the retention period and grading requirements are satisfied.
- Never silently recompute historical scores when question content or an answer key changes.

## Change workflow

1. Identify affected data, roles and published routes.
2. Add a regression check that fails before the fix when practical.
3. Make the smallest scoped change.
4. Run local read-only checks and use anonymized staging for integration tests.
5. Review RLS, authorization, concurrency and rollback behavior.
6. Verify the Pages artifact, not only the source files.
7. Deploy gradually only after explicit approval and monitor errors.

## Required checks

```bash
node tools/check_l4_workshop_contract.mjs
node tools/check_inline_scripts.mjs
node tools/check_workshop_input_guards.mjs
node tools/check_public_answer_keys.mjs
```

Also run syntax or type checks for every changed JavaScript or TypeScript file. Database and browser tests must use staging or mocks, never production student records.

## Publishing rules

- The published artifact must be built from reviewed tracked files.
- Student-paused pages must be excluded by `tools/build_pages_artifact.mjs` while their administrative history remains accessible.
- Do not add client-visible answer keys or secrets to any public artifact.
- Prefer pull requests over workflows that commit directly to `main`.
