import test from'node:test';import assert from'node:assert/strict';import{readFile}from'node:fs/promises';
const root=new URL('../../',import.meta.url),fn=await readFile(new URL('supabase/functions/student-identity/index.ts',root),'utf8'),oldMigration=await readFile(new URL('supabase/migrations/20261028190000_student_identity_registration_v1.sql',root),'utf8'),reviewMigration=await readFile(new URL('supabase/migrations/20261028230000_immediate_registration_review.sql',root),'utf8'),migration=oldMigration+reviewMigration,shell=await readFile(new URL('student-account-shell.js',root),'utf8'),studentBase=await readFile(new URL('student-base.html',root),'utf8'),staging=await readFile(new URL('tools/tests/student-identity-staging.integration.mjs',root),'utf8'),cleanup=await readFile(new URL('tools/fixtures/student_identity_staging_cleanup.sql',root),'utf8'),workflow=await readFile(new URL('.github/workflows/student-identity-pr.yml',root),'utf8');
test('immediate registration is independently fail-closed',()=>{for(const marker of['immediate_registration_enabled boolean not null default false',"registration_rollout_scope text not null default 'disabled'",'registration_unavailable'])assert.match(migration+fn,new RegExp(marker));assert.match(fn,/registration_enabled[\s\S]*immediate_registration_enabled[\s\S]*registration_rollout_scope/)});
test('code, identity and Auth provisioning are durable and request-idempotent',()=>{for(const marker of['student_code_reservations','request_id uuid not null unique','pg_advisory_xact_lock','reserve_student_identity_claim','claim_student_registration_provisioning','registration_request_id','client_request_hmac','student_phone_hmac'])assert.match(migration+fn,new RegExp(marker));assert.doesNotMatch(fn,/reserve_next_student_code/)});
test('password goes directly to Auth and is never inserted in registration tables',()=>{assert.match(fn,/createUser\(\{[\s\S]*email,[\s\S]*password,/);assert.doesNotMatch(migration,/password\s+(?:text|varchar|bytea)/i);assert.doesNotMatch(fn,/console\.(?:log|error)\([^\n]*(?:body|password|national_id|activation_token|reset_token)/)});
test('review state has exact 48-hour server deadline and request-time plus cron enforcement',()=>{for(const marker of['student_account_reviews','pending_review','suspended_pending_approval',"review_deadline_at = review_started_at \\+ interval '48 hours'",'student_account_access','suspend_expired_student_reviews'])assert.match(migration,new RegExp(marker));assert.match(fn,/student_account_access/);assert.match(shell,/studentReviewGate/)});
test('legacy students are excluded from review deadlines',()=>{assert.match(migration,/if not found then[\s\S]*legacy_account/i);assert.match(staging,/legacy account has no deadline/)});
test('admin review requires real students edit permission and is audited',()=>{assert.match(fn,/adminUser\(req, action !== "admin_list"\)/);for(const marker of['student_identity_audit_events','suspended_by_admin','reactivate'])assert.match(fn,new RegExp(marker))});
test('pending student page checks review before legacy ping and preserves the Auth session',()=>{assert.match(studentBase,/reviewStateBeforeLegacyInit/);assert.match(studentBase,/state==='review_only'/);assert.match(studentBase,/registration_request_id/);assert.match(staging,/real student\.html keeps the GoTrue pending session/)});
test('limited production rollout requires invitations and staging scope is forbidden on production',()=>{for(const marker of['student_registration_invites','student_registration_invite_redemptions','registration_invite_invalid','IS_PRODUCTION'])assert.match(migration+fn,new RegExp(marker));assert.match(fn,/registration_rollout_scope === "staging" && !IS_PRODUCTION/)});
test('public registration requires CAPTCHA and rate limits use the trusted proxy edge',()=>{assert.match(migration,/captcha_required_for_public_registration boolean not null default true/);assert.match(fn,/STUDENT_REGISTRATION_TURNSTILE_SECRET/);assert.match(fn,/challenges\.cloudflare\.com\/turnstile/);assert.match(fn,/split\(","\)\.at\(-1\)/);assert.doesNotMatch(fn,/split\(","\)\[0\]/)});
test('activation and reset compatibility remains atomic',()=>{for(const marker of['claim_student_activation_token','claim_student_password_reset_token','payload_hmac',"state='applied'","state='failed'"])assert.match(fn+oldMigration,new RegExp(marker))});
test('phone login and identity collection remain independently gated',()=>{assert.match(shell,/phone_login_enabled/);assert.match(shell,/normalizeEgyptianPhone/);assert.match(migration,/phone_login_enabled boolean not null default false/);assert.match(migration,/national_id_collection_enabled boolean not null default false/);assert.match(fn,/identity_collection_unavailable/)});
test('cloud staging is allow-listed, synthetic, cleanup-owned and has no cloud failpoints',()=>{assert.match(staging,/E2E_ALLOWED_PROJECT_REFS/);assert.match(staging,/Production is forbidden/);assert.match(staging,/registration_request_id/);assert.match(cleanup,/__RUN_ID__/);assert.match(cleanup,/student_account_reviews/);assert.match(staging,/Cloud fault injection is forbidden/);for(const forbidden of['synthetic_admin_permissions','synthetic_student_attempts','synthetic_student_grades'])assert.doesNotMatch(staging+cleanup,new RegExp(forbidden))});
test('flags restore and real student page with local GoTrue run in CI',()=>{assert.match(staging,/t\.after\(/);assert.match(staging,/immediate_registration_enabled:\s*original\.immediate_registration_enabled/);assert.match(workflow,/local-gotrue-e2e/);assert.match(workflow,/E2E_BROWSER/);assert.match(workflow,/run_student_identity_local_e2e\.sh/)});

test('server-generated invitations require admin edit and never persist plaintext tokens',()=>{
  assert.match(fn,/if \(action\.startsWith\("admin_"\)\)/);
  assert.match(fn,/adminUser\(req, action !== "admin_list"\)/);
  assert.match(fn,/if \(action === "admin_create_invite"\)/);
  assert.match(fn,/crypto\.getRandomValues\(new Uint8Array\(24\)\)/);
  assert.match(fn,/await hmac\(`registration-invite:\$\{token\}`\)/);
  assert.match(fn,/insert into private\.student_registration_invites\(token_hmac,label,allowed_group_code,max_uses,expires_at\)/);
  assert.match(fn,/event_type,metadata/);
  assert.match(staging,/admin_create_invite/);
  assert.match(staging,/JWT admin metadata alone cannot approve without DB permission/);
});
test('live config is fail-closed when critical identity secrets are missing or invalid',()=>{
  assert.match(fn,/function cryptoReady\(\): boolean/);
  assert.match(fn,/service_ready: cryptoReady\(\)/);
  assert.match(fn,/registration_enabled: cryptoReady\(\) && cfg\.registration_enabled/);
  assert.match(fn,/!cryptoReady\(\) \|\| !cfg\.registration_enabled/);
});

test('public registration is blocked without real Turnstile configuration and validates host + action',()=>{
  assert.match(fn,/function publicCaptchaReady\(\)/);
  assert.match(fn,/CAPTCHA_SITEKEY/);
  assert.match(fn,/captcha_sitekey: cfg\.registration_rollout_scope === "all"/);
  assert.match(fn,/registration_enabled: cryptoReady\(\) && cfg\.registration_enabled/);
  assert.match(fn,/cfg\.registration_rollout_scope === "all" && !publicCaptchaReady\(\)/);
  assert.match(fn,/result\?\.hostname === "youssefrezk441-oss\.github\.io"/);
  assert.match(fn,/result\?\.action === "student_registration"/);
  assert.match(fn,/!await verifyCaptcha\(txt\(body\.captcha_token, 2048\), requestIp\)/);
});
test('public frontend renders real challenge and resets a used token after a failed request',async()=>{
  const page=await readFile(new URL('student-register.html',root),'utf8');
  const wizard=await readFile(new URL('student-register-wizard.js',root),'utf8');
  assert.match(page,/src="student-register-wizard\.js"/);
  assert.match(page,/id="turnstileWidget"/);
  assert.match(wizard,/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?render=explicit/);
  assert.match(wizard,/action: "student_registration"/);
  assert.match(wizard,/config\.captcha_required/);
  assert.match(wizard,/payload\.captcha_token = captchaToken/);
  assert.match(wizard,/window\.turnstile\.reset\(captchaId\)/);
  assert.match(wizard,/submitting = true/);
  assert.match(wizard,/request_idempotency_key: requestKey/);
  assert.doesNotMatch(page,/name="national_id"/);
  assert.doesNotMatch(wizard,/national_id\s*:/);
});
