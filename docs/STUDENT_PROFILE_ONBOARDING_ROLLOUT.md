# Existing student profile onboarding — controlled rollout

## Implemented
- Branded student-complete-profile.html: prefilled four-step form, immutable student code, optional current-password-verified password change.
- New action complete_profile_v2 (student JWT validated server-side): updates contact/residence, records completion and queues name, educational system, grade, center or group changes.
- Admin actions admin_profile_changes and admin_profile_change_decide require authorized student administration.
- Public group and grade assignment only change after administrator approval; student historical results remain associated with user_id.
- Existing signup/registration/Turnstile flow unchanged. National ID not requested.
- Login and student.html redirect only if server returns enforcement=true and profile_schema_version below required.

## Production state after backend v7
- Additive migration applied; student-identity Edge Function version 7 deployed.
- Profile update and compulsory enforcement settings were both OFF as of deployment.
- Unauthorized me and complete_profile_v2 returned 401; unauthorized admin profile listing returned 403; config returned HTTP 200.
- No real student data was written during verification. Requires authenticated synthetic student E2E before compulsory enforcement.

## Safe rollout order
1. Run branch tests and verify existing GitHub Pages pipeline is green.
2. Publish frontend while profile_enforcement_enabled remains false.
3. Enable profile_update_enabled=true only for the voluntary pilot; verify login/profile prefill, save/reload, optional password change, pending group-change request, admin approval/rejection with an authorized test account and no real student data.
4. Check old approved accounts, incomplete profiles and backend outage/fallback behaviour.
5. Only after independent E2E approval and rollback readiness, enable profile_enforcement_enabled=true. This affects ALL active students whose profile version is below required.
6. Monitor live error rates, verify students continue to access workshops, and update notice as appropriate.

## Rollback
- **Emergency stop**: set private.student_identity_settings.profile_enforcement_enabled=false; profile_update_enabled=false if necessary.
- Restore backend v6 source from supabase/rollbacks/student-identity-v6-pre-profile-20261030.ts along with identical shared files if backend v7 introduces runtime regressions.
- Revert frontend PR via GitHub and publish Pages.
- Do NOT delete the new review queue: preserve submitted profile change requests and audit trail.

## Security
- Student code is NEVER accepted for updates, always derived from authenticated user ID.
- Do not store passwords, JWTs, or private student records in frontend or repository.
- Admin approval uses server-side ACL, validates target group, and preserves existing grades/attempts under the student user ID.
