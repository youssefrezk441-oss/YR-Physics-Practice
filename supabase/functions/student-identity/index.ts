import { createClient } from "npm:@supabase/supabase-js@2.105.0";
import postgres from "npm:postgres@3.4.7";
import {
  assertExistingProfileIdentityConsent,
  constantStatusMessage,
  IdentityInputError,
  isPhoneIdentifier,
  normalizeEgyptianPhone,
  normalizeStudentCode,
  parseEgyptianNationalId,
  validateFullName,
  validatePassword,
} from "../_shared/student-identity-core.ts";
import {
  readWorkshopJson,
  WorkshopRequestError,
} from "../_shared/workshop-security.ts";

const URL = Deno.env.get("SUPABASE_URL") ?? "",
  ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "",
  SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  DB = Deno.env.get("SUPABASE_DB_URL") ?? "";
const ENC = Deno.env.get("STUDENT_IDENTITY_ENCRYPTION_KEY_B64") ?? "",
  HMAC = Deno.env.get("STUDENT_IDENTITY_HMAC_KEY_B64") ?? "",
  CAPTCHA_SECRET = Deno.env.get("STUDENT_REGISTRATION_TURNSTILE_SECRET") ?? "";
const PROJECT_HOST = (() => {
    try {
      return new globalThis.URL(URL).hostname;
    } catch {
      return "";
    }
  })(),
  IS_PRODUCTION = PROJECT_HOST === "ltjdhconuiqblxfjzpzj.supabase.co";
const SYNTHETIC_FAILPOINTS =
  Deno.env.get("STUDENT_IDENTITY_TEST_FAILPOINTS") === "synthetic-e2e-only" &&
  ["127.0.0.1", "localhost"].includes((() => {
    try {
      return new globalThis.URL(URL).hostname;
    } catch {
      return "";
    }
  })());
const auth = createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  }),
  admin = createClient(URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  }),
  sql = postgres(DB, { prepare: false, max: 4, idle_timeout: 20 });
const origins = new Set([
    "https://youssefrezk441-oss.github.io",
    "http://127.0.0.1:8000",
    "http://127.0.0.1:58001",
    "http://localhost:8000",
  ]),
  enc = new TextEncoder();
const txt = (v: unknown, n = 300) =>
  String(v ?? "").normalize("NFKC").trim().slice(0, n);
function headers(req: Request) {
  const o = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": origins.has(o)
      ? o
      : "https://youssefrezk441-oss.github.io",
    "Access-Control-Allow-Headers":
      "authorization,apikey,content-type,x-client-info",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin",
  };
}
const out = (req: Request, v: unknown, s = 200) =>
  new Response(JSON.stringify(v), { status: s, headers: headers(req) });
const b64 = (b: ArrayBuffer | Uint8Array) => {
    let s = "";
    for (const x of new Uint8Array(b instanceof ArrayBuffer ? b : b.buffer)) {
      s += String.fromCharCode(x);
    }
    return btoa(s);
  },
  unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function hmac(value: string) {
  if (!HMAC) throw new Error("identity_keys_unavailable");
  const k = await crypto.subtle.importKey(
    "raw",
    unb64(HMAC),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return b64(await crypto.subtle.sign("HMAC", k, enc.encode(value)));
}
async function encrypt(value: string) {
  if (!ENC) throw new Error("identity_keys_unavailable");
  const iv = crypto.getRandomValues(new Uint8Array(12)),
    k = await crypto.subtle.importKey("raw", unb64(ENC), "AES-GCM", false, [
      "encrypt",
    ]),
    cipher = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      k,
      enc.encode(value),
    );
  return { ciphertext: b64(cipher), iv: b64(iv) };
}
async function hashToken(value: string) {
  return hmac(`token:${value}`);
}
async function hashCredentialPayload(
  kind: string,
  tokenHash: string,
  password: string,
) {
  return hmac(`credential:${kind}:${tokenHash}:${password}`);
}
async function settings() {
  const [r] =
    await sql`select * from private.student_identity_settings where singleton`;
  return r;
}
async function user(req: Request) {
  const h = req.headers.get("authorization") ?? "";
  if (!h.startsWith("Bearer ")) return null;
  const { data, error } = await auth.auth.getUser(h.slice(7));
  return error ? null : data.user;
}
async function adminUser(req: Request, edit = false) {
  const u = await user(req);
  if (!u || u.app_metadata?.role !== "admin") return null;
  const [p] =
    await sql`select public.admin_access_level('students',${u.id}::uuid) level`;
  const ok = edit ? p?.level === "edit" : p?.level && p.level !== "none";
  return ok ? { user: u, level: p.level } : null;
}
async function limit(
  scope: string,
  subject: string,
  max: number,
  minutes: number,
) {
  const key = await hmac(`rate:${scope}:${subject}`),
    window = new Date(
      Math.floor(Date.now() / (minutes * 60000)) * minutes * 60000,
    );
  const [r] =
    await sql`insert into private.student_identity_rate_limits(scope,subject_hmac,window_started_at) values(${scope},${key},${window}) on conflict(scope,subject_hmac,window_started_at) do update set attempts=private.student_identity_rate_limits.attempts+1 returning attempts`;
  if (Number(r.attempts) > max) {
    throw new IdentityInputError("rate_limited", "حاول مرة أخرى لاحقًا.");
  }
}
function clientIp(req: Request) {
  const candidates = [
    req.headers.get("cf-connecting-ip"),
    req.headers.get("x-real-ip"),
    req.headers.get("x-forwarded-for")?.split(",").at(-1),
  ];
  const value = candidates.map((v) => String(v ?? "").trim()).find((v) =>
    /^[0-9a-f:.]{3,64}$/i.test(v)
  );
  return value || "unknown";
}
async function verifyCaptcha(token: string, ip: string) {
  if (!CAPTCHA_SECRET || !token) return false;
  const form = new URLSearchParams({ secret: CAPTCHA_SECRET, response: token });
  if (ip !== "unknown") form.set("remoteip", ip);
  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    { method: "POST", body: form },
  );
  const result = await response.json().catch(() => ({}));
  return response.ok && result?.success === true;
}
const publicRequest = (r: any) => ({
  reference: r.public_ref,
  status: r.status,
  student_code: r.student_code ?? null,
  review_deadline_at: r.review_deadline_at ?? null,
  created_at: r.created_at,
  updated_at: r.updated_at,
  message: r.status === "needs_information"
    ? "يحتاج الطلب إلى استكمال من الإدارة."
    : r.status === "approved"
    ? "تمت الموافقة. استخدم رمز التفعيل الذي استلمته."
    : r.status === "rejected"
    ? "تعذر قبول الطلب. تواصل مع الإدارة."
    : "الطلب قيد المراجعة.",
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: headers(req) });
  }
  if (req.method !== "POST") {
    return out(req, { error: "method_not_allowed" }, 405);
  }
  let body: Record<string, unknown>;
  try {
    body = await readWorkshopJson(req, 48 * 1024);
  } catch (e) {
    if (e instanceof WorkshopRequestError) {
      return out(req, { error: e.code, message: e.message }, e.status);
    }
    return out(req, { error: "invalid_json" }, 400);
  }
  const action = txt(body.action, 50);
  try {
    const cfg = await settings();
    if (action === "config") {
      const scopeAllowed = cfg.registration_rollout_scope === "limited" ||
        cfg.registration_rollout_scope === "all" ||
        (cfg.registration_rollout_scope === "staging" && !IS_PRODUCTION);
      const groups =
        cfg.registration_enabled && cfg.immediate_registration_enabled &&
          scopeAllowed
          ? await sql`select group_code,grade_level,center_name from public.student_groups where is_active order by grade_level,group_code limit 200`
          : [];
      return out(req, {
        ok: true,
        registration_enabled: cfg.registration_enabled &&
          cfg.immediate_registration_enabled &&
          scopeAllowed &&
          (cfg.registration_rollout_scope !== "all" ||
            !cfg.captcha_required_for_public_registration || !!CAPTCHA_SECRET),
        registration_rollout_scope: cfg.registration_rollout_scope,
        registration_invite_required:
          cfg.registration_rollout_scope === "limited",
        captcha_required: cfg.registration_rollout_scope === "all" &&
          cfg.captcha_required_for_public_registration,
        phone_login_enabled: cfg.phone_login_enabled && cfg.sms_provider_ready,
        profile_update_enabled: cfg.profile_update_enabled,
        profile_enforcement_enabled: cfg.profile_enforcement_enabled,
        national_id_collection_enabled: cfg.national_id_collection_enabled,
        required_profile_schema_version: cfg.required_profile_schema_version,
        privacy_notice_version: cfg.privacy_notice_version,
        groups,
      });
    }
    if (action === "submit_registration") {
      const scopeAllowed = cfg.registration_rollout_scope === "limited" ||
        cfg.registration_rollout_scope === "all" ||
        (cfg.registration_rollout_scope === "staging" && !IS_PRODUCTION);
      if (
        !cfg.registration_enabled || !cfg.immediate_registration_enabled ||
        !scopeAllowed
      ) {
        return out(req, {
          error: "registration_unavailable",
          message: "التسجيل الجديد غير متاح حاليًا.",
        }, 503);
      }
      const requestIp = clientIp(req);
      await limit("registration", requestIp, 5, 60);
      if (
        cfg.registration_rollout_scope === "all" &&
        cfg.captcha_required_for_public_registration &&
        !await verifyCaptcha(txt(body.captcha_token, 2048), requestIp)
      ) {
        throw new IdentityInputError(
          "captcha_required",
          "تعذر التحقق من اختبار الحماية. أعد المحاولة.",
        );
      }
      const password = validatePassword(body.password);
      if (password !== String(body.password_confirm ?? "")) {
        throw new IdentityInputError(
          "password_mismatch",
          "كلمتا المرور غير متطابقتين.",
        );
      }
      const requestKey = txt(body.request_idempotency_key, 80);
      if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(requestKey)) {
        throw new IdentityInputError(
          "invalid_request_key",
          "أعد تحميل الصفحة وحاول مرة أخرى.",
        );
      }
      const fullName = validateFullName(body.full_name),
        studentPhone = normalizeEgyptianPhone(body.student_phone),
        guardian = body.guardian_phone
          ? normalizeEgyptianPhone(body.guardian_phone)
          : null;
      const submittedNationalId = txt(body.national_id, 20);
      if (submittedNationalId && !cfg.national_id_collection_enabled) {
        throw new IdentityInputError(
          "identity_collection_unavailable",
          "جمع الرقم القومي غير متاح حاليًا.",
        );
      }
      let national: any = null,
        birth: string | null = null,
        encrypted: any = null,
        nationalHash: string | null = null;
      if (submittedNationalId) {
        national = parseEgyptianNationalId(submittedNationalId);
        birth = national.birthDate;
        encrypted = await encrypt(national.id);
        nationalHash = await hmac(`nid:${national.id}`);
      }
      const grade = txt(body.grade_level, 60),
        system = txt(body.education_system, 30),
        location = txt(body.attendance_location, 40),
        residence = txt(body.residence_area, 160),
        privacy = txt(body.privacy_notice_version, 80),
        group = txt(body.group_code, 80);
      if (
        body.privacy_accepted !== true || privacy !== cfg.privacy_notice_version
      ) {
        throw new IdentityInputError(
          "privacy_consent_required",
          "يجب قراءة إشعار الخصوصية المعتمد والموافقة عليه.",
        );
      }
      const requestHmac = await hmac(`registration-request:${requestKey}`),
        phoneHmac = await hmac(`registration-phone:${studentPhone}`),
        subjectHmac = await hmac(
          `registration-subject:${fullName.toLowerCase()}:${
            guardian ?? studentPhone
          }`,
        ),
        inviteHmac = cfg.registration_rollout_scope === "limited"
          ? await hmac(
            `registration-invite:${txt(body.registration_invite, 200)}`,
          )
          : null,
        statusToken = b64(crypto.getRandomValues(new Uint8Array(32))),
        tokenHash = await hashToken(statusToken),
        attemptId = crypto.randomUUID();
      await limit("registration_phone", phoneHmac, 3, 24 * 60);
      const [existingIdentity] = nationalHash
        ? await sql`select 1 from private.student_sensitive_identities where national_id_hmac=${nationalHash} limit 1`
        : [];
      const phoneDigits = studentPhone.replace(/\D/g, "").slice(-10),
        guardianDigits = guardian?.replace(/\D/g, "").slice(-10) ?? null;
      const [existingProfiles] =
        await sql`select count(*) filter(where right(regexp_replace(coalesce(student_phone,''),'\D','','g'),10)=${phoneDigits})::int student_phone_matches,count(*) filter(where ${guardianDigits}::text is not null and (right(regexp_replace(coalesce(student_phone,''),'\D','','g'),10)=${guardianDigits} or right(regexp_replace(coalesce(guardian_phone,''),'\D','','g'),10)=${guardianDigits}))::int family_phone_matches from public.student_profiles`;
      const r: any = await sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended(${phoneHmac},0))`;
        await tx`select pg_advisory_xact_lock(hashtextextended(${subjectHmac},0))`;
        const [existingPhone] =
          await tx`select public_ref from private.student_registration_requests where student_phone_hmac=${phoneHmac} and client_request_hmac<>${requestHmac} and status<>'cancelled' limit 1`;
        if (existingPhone) {
          throw new IdentityInputError(
            "duplicate_registration",
            "يوجد حساب أو طلب قائم لهذا الرقم. استخدم الاستعادة أو تواصل مع الإدارة.",
          );
        }
        const [existingSubject] =
          await tx`select public_ref from private.student_registration_requests where registration_subject_hmac=${subjectHmac} and client_request_hmac<>${requestHmac} and status<>'cancelled' limit 1`;
        if (existingSubject) {
          throw new IdentityInputError(
            "duplicate_registration",
            "توجد بيانات تسجيل مطابقة بالفعل. استخدم الحساب القائم أو تواصل مع الإدارة.",
          );
        }
        const [g] =
          await tx`select id,group_code,center_name,grade_level from public.student_groups where group_code=${group} and is_active for share`;
        if (!g) {
          throw new IdentityInputError(
            "invalid_group",
            "المجموعة غير موجودة أو غير متاحة.",
          );
        }
        const compatible = grade === "الصف الثاني الثانوي"
          ? String(g.grade_level ?? "").includes("الثاني") ||
            String(g.grade_level ?? "").startsWith("2")
          : grade === "الصف الثالث الثانوي" &&
            (String(g.grade_level ?? "").includes("الثالث") ||
              String(g.grade_level ?? "").startsWith("3"));
        if (!compatible) {
          throw new IdentityInputError(
            "group_grade_mismatch",
            "المجموعة لا تطابق الصف الدراسي.",
          );
        }
        let [x] =
          await tx`select * from private.student_registration_requests where client_request_hmac=${requestHmac} for update`;
        if (!x) {
          if (cfg.registration_rollout_scope === "limited") {
            const [invite] =
              await tx`select id,allowed_group_code,max_uses,used_count from private.student_registration_invites where token_hmac=${inviteHmac} and enabled and expires_at>now() for update`;
            if (
              !invite ||
              (invite.allowed_group_code && invite.allowed_group_code !== group)
            ) {
              throw new IdentityInputError(
                "registration_invite_invalid",
                "تعذر إكمال التسجيل بهذه الدعوة.",
              );
            }
            const [redemption] =
              await tx`insert into private.student_registration_invite_redemptions(invite_id,request_hmac) select ${invite.id}::uuid,${requestHmac} where ${invite.used_count}<${invite.max_uses} on conflict(request_hmac) do nothing returning invite_id`;
            if (!redemption) {
              throw new IdentityInputError(
                "registration_invite_invalid",
                "تعذر إكمال التسجيل بهذه الدعوة.",
              );
            }
            await tx`update private.student_registration_invites set used_count=used_count+1 where id=${invite.id}::uuid`;
          }
          [x] =
            await tx`insert into private.student_registration_requests(client_request_hmac,student_phone_hmac,registration_subject_hmac,identity_review_required,full_name,national_id_ciphertext,national_id_iv,national_id_hmac,national_id_last4,national_id_exception_requested,birth_date,grade_level,education_system,attendance_location,attendance_location_other,residence_area,student_phone_e164,guardian_phone_e164,guardian_phone_exception_requested,privacy_notice_version,privacy_accepted_at,status_token_hash,status_token_expires_at,duplicate_review,requested_group_code)
          values(${requestHmac},${phoneHmac},${subjectHmac},${!nationalHash},${fullName},${
              encrypted?.ciphertext ?? null
            },${encrypted?.iv ?? null},${nationalHash},${
              national?.last4 ?? null
            },false,${birth}::date,${grade},${system},${location},${
              location === "غير ذلك"
                ? txt(body.attendance_location_other, 120)
                : null
            },${residence},${studentPhone},${guardian},${!guardian},${privacy},now(),${tokenHash},now()+interval '30 days',${
              tx.json({
                national_id_already_registered: !!existingIdentity,
                existing_student_phone_matches: Number(
                  existingProfiles?.student_phone_matches ?? 0,
                ),
                existing_family_phone_matches: Number(
                  existingProfiles?.family_phone_matches ?? 0,
                ),
              })
            },${group}) returning *`;
          await tx`insert into private.student_privacy_consents(request_id,notice_version,consent_kind,accepted_at) values(${x.id}::uuid,${privacy},${
            nationalHash
              ? "registration_and_identity_processing"
              : "registration_profile_processing"
          },now())`;
          await tx`insert into private.student_identity_audit_events(request_id,event_type,metadata) values(${x.id}::uuid,'immediate_registration_started',${
            tx.json({ grade_level: grade, education_system: system })
          })`;
        }
        if (x.auth_user_id && x.provisioning_status === "review_pending") {
          return { ...x, code: x.assigned_student_code, complete: true };
        }
        if (x.national_id_hmac) {
          const [{ claimed: identityClaimed }] =
            await tx`select private.reserve_student_identity_claim(${x.id}::uuid,${x.national_id_hmac}) claimed`;
          if (!identityClaimed) {
            throw new IdentityInputError(
              "duplicate_identity_request",
              "يوجد حساب أو طلب قائم لهذه الهوية.",
            );
          }
        }
        const [{ code }] =
          await tx`select private.reserve_student_code(${x.id}::uuid,${group},${grade}) code`;
        await tx`update private.student_registration_requests set assigned_student_code=${code},assigned_group_code=${group},updated_at=now() where id=${x.id}::uuid`;
        const [{ claimed }] =
          await tx`select private.claim_student_registration_provisioning(${x.id}::uuid,${attemptId}::uuid) claimed`;
        if (!claimed) {
          throw new IdentityInputError(
            "provisioning_in_progress",
            "إنشاء الحساب قيد التنفيذ. أعد المحاولة بنفس الصفحة.",
          );
        }
        return {
          ...x,
          code,
          group_id: g.id,
          center_name: g.center_name,
          complete: false,
        };
      });
      if (r.complete) {
        const [review] =
          await sql`select status,review_deadline_at from private.student_account_reviews where request_id=${r.id}::uuid`;
        return out(req, {
          ok: true,
          student_code: r.code,
          status: review.status,
          review_deadline_at: review.review_deadline_at,
        }, 200);
      }
      let authId = r.auth_user_id;
      const email = `${r.code.toLowerCase()}@students.yrphysicspractice.com`;
      if (!authId) {
        const [recoverable] =
          await sql`select id from auth.users where raw_app_meta_data->>'registration_request_id'=${r.public_ref} limit 1`;
        if (recoverable) authId = recoverable.id;
        else {
          if (
            SYNTHETIC_FAILPOINTS && body.test_failpoint === "auth_create_error"
          ) {
            await sql`update private.student_registration_requests set provisioning_status='failed',provisioning_lock_token=null,provisioning_locked_at=null where id=${r.id}::uuid`;
            throw new Error("synthetic_auth_create_failed");
          }
          const { data, error } = await admin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            app_metadata: {
              role: "student",
              registration_request_id: r.public_ref,
              ...(SYNTHETIC_FAILPOINTS
                ? { synthetic_run: txt(body.synthetic_run, 80) }
                : {}),
            },
          });
          if (error || !data.user) {
            await sql`update private.student_registration_requests set provisioning_status='failed',provisioning_lock_token=null,provisioning_locked_at=null where id=${r.id}::uuid`;
            throw new Error("auth_create_failed");
          }
          authId = data.user.id;
          if (
            SYNTHETIC_FAILPOINTS && body.test_failpoint === "after_auth_create"
          ) throw new Error("synthetic_after_auth_create");
        }
      }
      const [finished] = await sql.begin(async (tx) => {
        const [locked] =
          await tx`select * from private.student_registration_requests where id=${r.id}::uuid and provisioning_lock_token=${attemptId}::uuid for update`;
        if (!locked) throw new Error("registration_finalize_conflict");
        await tx`insert into public.student_profiles(user_id,student_code,full_name,grade_level,is_active,center_name,group_code,student_phone,guardian_phone) values(${authId}::uuid,${r.code},${r.full_name},${r.grade_level},false,${r.center_name},${group},${r.student_phone_e164},${r.guardian_phone_e164}) on conflict(user_id) do nothing`;
        await tx`insert into public.student_group_memberships(group_id,user_id,joined_on) values(${r.group_id}::uuid,${authId}::uuid,current_date) on conflict do nothing`;
        await tx`insert into private.student_login_identifiers(user_id,kind,normalized_value,verified,verified_at,verification_source) values(${authId}::uuid,'student_code',${r.code},true,now(),'legacy_code') on conflict do nothing`;
        await tx`insert into private.student_profile_details(user_id,education_system,attendance_location,attendance_location_other,residence_area) values(${authId}::uuid,${r.education_system},${r.attendance_location},${r.attendance_location_other},${r.residence_area}) on conflict(user_id) do nothing`;
        await tx`insert into private.student_profile_status(user_id) values(${authId}::uuid) on conflict do nothing`;
        if (r.national_id_hmac) {
          await tx`insert into private.student_sensitive_identities(user_id,national_id_ciphertext,national_id_iv,national_id_hmac,national_id_last4,birth_date) values(${authId}::uuid,${r.national_id_ciphertext},${r.national_id_iv},${r.national_id_hmac},${r.national_id_last4},${r.birth_date}) on conflict(user_id) do nothing`;
        }
        if (r.national_id_hmac) {
          await tx`update private.student_identity_claims set status='assigned',assigned_user_id=${authId}::uuid,assigned_at=now(),updated_at=now() where request_id=${r.id}::uuid and status='reserved'`;
        }
        const [review] =
          await tx`insert into private.student_account_reviews(user_id,request_id,review_started_at,review_deadline_at) values(${authId}::uuid,${r.id}::uuid,now(),now()+interval '48 hours') returning status,review_deadline_at`;
        await tx`update private.student_code_reservations set status='assigned',assigned_at=now() where request_id=${r.id}::uuid and status='reserved'`;
        const [done] =
          await tx`update private.student_registration_requests set auth_user_id=${authId}::uuid,provisioning_status='review_pending',provisioning_lock_token=null,provisioning_locked_at=null,updated_at=now() where id=${r.id}::uuid returning id`;
        await tx`insert into private.student_identity_audit_events(request_id,subject_user_id,event_type,metadata) values(${r.id}::uuid,${authId}::uuid,'immediate_registration_completed',${
          tx.json({
            student_code: r.code,
            group_code: group,
            review_deadline_at: review.review_deadline_at,
          })
        })`;
        return [{ ...done, ...review }];
      });
      return out(req, {
        ok: true,
        student_code: r.code,
        status: finished.status,
        review_deadline_at: finished.review_deadline_at,
        message: "تم إنشاء حسابك بنجاح.",
      }, 201);
    }
    if (action === "registration_status") {
      await limit(
        "registration_status",
        clientIp(req),
        20,
        15,
      );
      const ref = txt(body.reference, 40),
        token = txt(body.status_token, 200),
        th = await hashToken(token);
      const [r] =
        await sql`select rr.public_ref,coalesce(ar.status,rr.status) status,ar.review_deadline_at,rr.assigned_student_code student_code,rr.created_at,rr.updated_at from private.student_registration_requests rr left join private.student_account_reviews ar on ar.request_id=rr.id where rr.public_ref=${ref}::uuid and rr.status_token_hash=${th} and rr.status_token_expires_at>now()`;
      return out(req, {
        ok: true,
        message: constantStatusMessage,
        ...(r ? publicRequest(r) : {}),
      });
    }
    if (action === "request_recovery") {
      await limit(
        "recovery",
        clientIp(req),
        5,
        60,
      );
      const identifier = txt(body.identifier, 160),
        phone = isPhoneIdentifier(identifier),
        normalized = phone
          ? normalizeEgyptianPhone(identifier)
          : normalizeStudentCode(identifier),
        identifierHash = await hmac(`recovery:${normalized}`),
        contact = body.contact_phone
          ? normalizeEgyptianPhone(body.contact_phone)
          : null,
        token = b64(crypto.getRandomValues(new Uint8Array(32))),
        th = await hashToken(token);
      const [linked] =
        await sql`select user_id from private.student_login_identifiers where kind=${
          phone ? "phone" : "student_code"
        } and normalized_value=${normalized} and verified and disabled_at is null limit 1`;
      const [r] =
        await sql`insert into private.student_account_recovery_requests(identifier_hmac,contact_phone_e164,status_token_hash,status_token_expires_at,subject_user_id) values(${identifierHash},${contact},${th},now()+interval '14 days',${
          linked?.user_id ?? null
        }::uuid) returning public_ref,created_at`;
      return out(req, {
        ok: true,
        reference: r.public_ref,
        status_token: token,
        message: constantStatusMessage,
      }, 201);
    }
    if (action === "reset_password") {
      await limit(
        "password_reset",
        clientIp(req),
        10,
        15,
      );
      const token = txt(body.reset_token, 300),
        th = await hashToken(token),
        password = validatePassword(body.password),
        payload = await hashCredentialPayload("reset", th, password);
      const [t] =
        await sql`select * from private.claim_student_password_reset_token(${th},${payload})`;
      if (!t) {
        return out(req, {
          error: "invalid_reset",
          message: "رمز الاستعادة غير صالح أو مستخدم أو انتهت صلاحيته.",
        }, 400);
      }
      const { error } = await admin.auth.admin.updateUserById(t.user_id, {
        password,
      });
      if (error) {
        await sql`update private.student_password_reset_tokens set state='failed',last_error='auth_update_failed' where id=${t.id}::uuid and state='claimed'`;
        throw new Error("password_reset_failed");
      }
      await sql.begin(async (tx) => {
        const [x] =
          await tx`update private.student_password_reset_tokens set state='applied',used_at=now(),applied_at=now(),last_error=null where id=${t.id}::uuid and state in('claimed','failed') and payload_hmac=${payload} returning id`;
        if (!x) throw new Error("reset_finalize_failed");
        await tx`update private.student_account_recovery_requests set status='completed',updated_at=now() where id=${t.recovery_request_id}::uuid`;
        await tx`insert into private.student_identity_audit_events(subject_user_id,event_type,metadata) values(${t.user_id}::uuid,'password_recovered',${
          tx.json({ resumed: !!t.resume })
        })`;
      });
      return out(req, { ok: true, message: "تم تعيين كلمة المرور الجديدة." });
    }
    if (action === "activate") {
      await limit(
        "activation",
        clientIp(req),
        10,
        15,
      );
      const token = txt(body.activation_token, 300),
        th = await hashToken(token),
        password = validatePassword(body.password),
        payload = await hashCredentialPayload("activation", th, password);
      const [t] =
        await sql`select * from private.claim_student_activation_token(${th},${payload})`;
      if (!t) {
        return out(req, {
          error: "invalid_activation",
          message: "رمز التفعيل غير صالح أو مستخدم أو انتهت صلاحيته.",
        }, 400);
      }
      const { error } = await admin.auth.admin.updateUserById(t.user_id, {
        password,
      });
      if (error) {
        await sql`update private.student_activation_tokens set state='failed',last_error='auth_update_failed' where id=${t.id}::uuid and state='claimed'`;
        throw new Error("activation_auth_failed");
      }
      await sql.begin(async (tx) => {
        const [p] =
          await tx`select sp.user_id from public.student_profiles sp join public.student_group_memberships gm on gm.user_id=sp.user_id and gm.left_on is null join private.student_registration_requests r on r.id=${t.request_id}::uuid where sp.user_id=${t.user_id}::uuid and sp.group_code=r.assigned_group_code and gm.group_id=(select id from public.student_groups where group_code=r.assigned_group_code) for update of sp`;
        if (!p) throw new Error("activation_relationships_incomplete");
        const [x] =
          await tx`update private.student_activation_tokens set state='applied',used_at=now(),applied_at=now(),last_error=null where id=${t.id}::uuid and state in('claimed','failed') and payload_hmac=${payload} returning id`;
        if (!x) throw new Error("activation_finalize_failed");
        await tx`update public.student_profiles set is_active=true,updated_at=now() where user_id=${t.user_id}::uuid`;
        await tx`update private.student_registration_requests set provisioning_status='activated',updated_at=now() where id=${t.request_id}::uuid`;
        await tx`insert into private.student_identity_audit_events(request_id,subject_user_id,event_type,metadata) values(${t.request_id}::uuid,${t.user_id}::uuid,'account_activated',${
          tx.json({ resumed: !!t.resume })
        })`;
      });
      return out(req, {
        ok: true,
        message: "تم تفعيل الحساب. يمكنك تسجيل الدخول بكود الطالب.",
      });
    }
    const u = await user(req);
    if (action === "me") {
      if (!u || u.app_metadata?.role !== "student") {
        return out(req, { error: "unauthorized" }, 401);
      }
      const [p] =
        await sql`select sp.student_code,sp.full_name,sp.grade_level,sp.center_name,sp.group_code,sp.student_phone,sp.guardian_phone,sp.is_active,coalesce(ps.profile_schema_version,0)::int profile_schema_version,ps.completed_at,coalesce(si.birth_date,ie.birth_date) birth_date,si.national_id_last4 from public.student_profiles sp left join private.student_profile_status ps on ps.user_id=sp.user_id left join private.student_sensitive_identities si on si.user_id=sp.user_id left join private.student_identity_exceptions ie on ie.user_id=sp.user_id where sp.user_id=${u.id}::uuid`;
      if (!p) {
        return out(req, {
          error: "inactive_account",
          message: "الحساب غير نشط. راجع الإدارة.",
        }, 403);
      }
      const testNow = SYNTHETIC_FAILPOINTS && body.test_now
        ? new Date(txt(body.test_now, 40))
        : new Date();
      const [access] =
        await sql`select * from private.student_account_access(${u.id}::uuid,${testNow})`;
      if (access?.legacy_account && !access.allowed) {
        return out(req, {
          error: "inactive_account",
          message: "الحساب غير نشط. راجع الإدارة.",
        }, 403);
      }
      return out(req, {
        ok: true,
        profile: p,
        review: {
          status: access?.status ?? "approved",
          access_scope: access?.access_scope ?? "full",
          review_deadline_at: access?.review_deadline_at ?? null,
          educational_access: Boolean(access?.allowed),
          legacy_account: Boolean(access?.legacy_account),
        },
        required_profile_schema_version: cfg.required_profile_schema_version,
        enforcement: cfg.profile_enforcement_enabled,
        national_id_collection_enabled: cfg.national_id_collection_enabled,
        privacy_notice_version: cfg.privacy_notice_version,
      });
    }
    if (action === "complete_profile") {
      if (!u || u.app_metadata?.role !== "student") {
        return out(req, { error: "unauthorized" }, 401);
      }
      if (!cfg.profile_update_enabled) {
        return out(req, {
          error: "profile_update_unavailable",
          message: "تحديث البيانات غير متاح حاليًا.",
        }, 503);
      }
      const phone = normalizeEgyptianPhone(body.student_phone),
        guardian = body.guardian_phone
          ? normalizeEgyptianPhone(body.guardian_phone)
          : null,
        residence = txt(body.residence_area, 160),
        location = txt(body.attendance_location, 40),
        submittedNationalId = txt(body.national_id, 20),
        noticeVersion = txt(body.privacy_notice_version, 80);
      const collectIdentity = assertExistingProfileIdentityConsent({
        hasNationalId: !!submittedNationalId,
        collectionEnabled: cfg.national_id_collection_enabled,
        accepted: body.privacy_accepted === true,
        noticeVersion,
        currentNoticeVersion: cfg.privacy_notice_version,
      });
      let identity: any = null;
      if (collectIdentity) {
        const n = parseEgyptianNationalId(submittedNationalId),
          e = await encrypt(n.id);
        identity = { ...n, ...e, hmac: await hmac(`nid:${n.id}`) };
      }
      await sql.begin(async (tx) => {
        const [profile] =
          await tx`select user_id from public.student_profiles where user_id=${u.id}::uuid and is_active for update`;
        if (!profile) {
          throw new IdentityInputError("inactive_account", "الحساب غير نشط.");
        }
        await tx`update public.student_profiles set student_phone=${phone},guardian_phone=${guardian},updated_at=now() where user_id=${u.id}::uuid`;
        if (identity) {
          await tx`insert into private.student_profile_privacy_consents(user_id,notice_version,consent_kind,accepted_at) values(${u.id}::uuid,${noticeVersion},'existing_profile_identity_processing',now()) on conflict(user_id,notice_version,consent_kind) do nothing`;
          await tx`insert into private.student_sensitive_identities(user_id,national_id_ciphertext,national_id_iv,national_id_hmac,national_id_last4,birth_date) values(${u.id}::uuid,${identity.ciphertext},${identity.iv},${identity.hmac},${identity.last4},${identity.birthDate}::date) on conflict(user_id) do nothing`;
          const [stored] =
            await tx`select 1 from private.student_sensitive_identities where user_id=${u.id}::uuid and national_id_hmac=${identity.hmac}`;
          if (!stored) {
            throw new IdentityInputError(
              "identity_conflict",
              "توجد هوية مختلفة مرتبطة بالحساب. راجع الإدارة.",
            );
          }
        }
        await tx`insert into private.student_profile_details(user_id,attendance_location,residence_area,updated_at) values(${u.id}::uuid,${location},${residence},now()) on conflict(user_id) do update set attendance_location=excluded.attendance_location,residence_area=excluded.residence_area,updated_at=now()`;
        await tx`insert into private.student_profile_status(user_id,profile_schema_version,completed_at,updated_at) values(${u.id}::uuid,${cfg.required_profile_schema_version},now(),now()) on conflict(user_id) do update set profile_schema_version=excluded.profile_schema_version,completed_at=excluded.completed_at,updated_at=now()`;
        await tx`insert into private.student_identity_audit_events(actor_user_id,subject_user_id,event_type,metadata) values(${u.id}::uuid,${u.id}::uuid,${
          identity
            ? "profile_completed_with_identity_consent"
            : "profile_contact_updated"
        },${
          tx.json({
            attendance_location: location,
            residence_provided: !!residence,
            identity_submitted: !!identity,
            privacy_notice_version: identity ? noticeVersion : null,
          })
        })`;
      });
      return out(req, {
        ok: true,
        message: identity
          ? "تم حفظ البيانات والموافقة بنجاح."
          : "تم تحديث بيانات التواصل دون جمع رقم قومي.",
      });
    }
    if (action === "change_password") {
      if (!u || u.app_metadata?.role !== "student") {
        return out(req, { error: "unauthorized" }, 401);
      }
      const current = txt(body.current_password, 128),
        next = validatePassword(body.new_password);
      const { error: reauth } = await auth.auth.signInWithPassword({
        email: u.email ?? "",
        password: current,
      });
      if (reauth) {
        return out(req, {
          error: "reauth_failed",
          message: "كلمة المرور الحالية غير صحيحة.",
        }, 401);
      }
      const { error } = await admin.auth.admin.updateUserById(u.id, {
        password: next,
      });
      if (error) throw new Error("password_update_failed");
      await sql`insert into private.student_identity_audit_events(actor_user_id,subject_user_id,event_type) values(${u.id}::uuid,${u.id}::uuid,'password_changed')`;
      return out(req, { ok: true, message: "تم تغيير كلمة المرور." });
    }
    if (action.startsWith("admin_")) {
      const a = await adminUser(req, action !== "admin_list");
      if (!a) return out(req, { error: "forbidden" }, 403);
      if (action === "admin_list") {
        const rows =
          await sql`select r.public_ref,r.status request_status,r.provisioning_status,r.full_name,r.national_id_last4,r.identity_review_required,r.grade_level,r.education_system,r.attendance_location,r.residence_area,r.student_phone_e164,r.guardian_phone_e164,r.requested_group_code,r.assigned_group_code,r.assigned_student_code,r.duplicate_review,r.created_at,r.updated_at,r.decision_reason,ar.status account_status,ar.access_scope,ar.review_started_at,ar.review_deadline_at,ar.decided_at,ar.decision_reason account_decision_reason from private.student_registration_requests r left join private.student_account_reviews ar on ar.request_id=r.id order by (ar.status='pending_review') desc,ar.review_deadline_at nulls last,r.created_at desc limit 500`;
        const recovery =
          await sql`select public_ref,status,contact_phone_e164,(subject_user_id is not null) account_matched,created_at,updated_at,decision_reason from private.student_account_recovery_requests order by (status='pending') desc,created_at desc limit 500`;
        return out(req, {
          ok: true,
          requests: rows,
          recovery_requests: recovery,
          level: a.level,
        });
      }
      if (action === "admin_recovery_decide") {
        const ref = txt(body.reference, 40),
          decision = txt(body.decision, 20),
          reason = txt(body.reason, 1000);
        const [r] =
          await sql`select * from private.student_account_recovery_requests where public_ref=${ref}::uuid and status='pending'`;
        if (!r || !new Set(["approved", "rejected"]).has(decision)) {
          throw new IdentityInputError(
            "invalid_recovery_decision",
            "قرار الاستعادة غير صالح.",
          );
        }
        if (decision === "rejected" || !r.subject_user_id) {
          await sql`update private.student_account_recovery_requests set status='rejected',decision_reason=${reason},decided_at=now(),decided_by=${a.user.id}::uuid,updated_at=now() where id=${r.id}::uuid`;
          return out(req, { ok: true });
        }
        const token = b64(crypto.getRandomValues(new Uint8Array(32))),
          th = await hashToken(token);
        await sql.begin(async (tx) => {
          await tx`update private.student_password_reset_tokens set expires_at=least(expires_at,now()) where recovery_request_id=${r.id}::uuid and used_at is null`;
          await tx`insert into private.student_password_reset_tokens(recovery_request_id,user_id,token_hash,expires_at,issued_by) values(${r.id}::uuid,${r.subject_user_id}::uuid,${th},now()+interval '2 hours',${a.user.id}::uuid)`;
          await tx`update private.student_account_recovery_requests set status='approved',decision_reason=${reason},decided_at=now(),decided_by=${a.user.id}::uuid,updated_at=now() where id=${r.id}::uuid`;
          await tx`insert into private.student_identity_audit_events(actor_user_id,subject_user_id,event_type,reason) values(${a.user.id}::uuid,${r.subject_user_id}::uuid,'password_recovery_approved',${reason})`;
        });
        return out(req, { ok: true, reset_token: token, expires_in_hours: 2 });
      }
      if (action === "admin_decide") {
        const ref = txt(body.reference, 40),
          decision = txt(body.decision, 30),
          reason = txt(body.reason, 1000);
        const [immediate] =
          await sql`select ar.user_id from private.student_account_reviews ar join private.student_registration_requests r on r.id=ar.request_id where r.public_ref=${ref}::uuid`;
        if (immediate) {
          if (
            !new Set([
              "approved",
              "rejected",
              "suspended_by_admin",
              "reactivate",
            ]).has(decision) || reason.length < 8
          ) {
            throw new IdentityInputError(
              "invalid_decision",
              "اختر قرارًا صالحًا واكتب سببًا واضحًا.",
            );
          }
          const now = SYNTHETIC_FAILPOINTS && body.test_now
            ? new Date(txt(body.test_now, 40))
            : new Date();
          const target = await sql.begin(async (tx) => {
            const [review] =
              await tx`select ar.*,r.id request_id from private.student_account_reviews ar join private.student_registration_requests r on r.id=ar.request_id where r.public_ref=${ref}::uuid for update of ar`;
            if (!review) {
              throw new IdentityInputError(
                "request_not_approvable",
                "طلب المراجعة غير موجود.",
              );
            }
            if (
              decision === "reactivate" &&
              review.status !== "suspended_by_admin"
            ) {
              throw new IdentityInputError(
                "invalid_reactivation",
                "إعادة التفعيل متاحة فقط للحساب الموقوف يدويًا.",
              );
            }
            let target = decision;
            if (decision === "reactivate") {
              target = review.previous_status === "approved"
                ? "approved"
                : now >= new Date(review.review_deadline_at)
                ? "suspended_pending_approval"
                : "pending_review";
            }
            if (review.status === target && decision !== "reactivate") {
              throw new IdentityInputError(
                "decision_already_applied",
                "تم تطبيق هذا القرار بالفعل.",
              );
            }
            const active = target === "approved",
              scope = active
                ? "full"
                : target === "pending_review"
                ? "review_only"
                : "none";
            await tx`update private.student_account_reviews set previous_status=status,status=${target},access_scope=${scope},decided_at=${now},decided_by=${a.user.id}::uuid,decision_reason=${reason},updated_at=${now} where user_id=${review.user_id}::uuid`;
            await tx`update public.student_profiles set is_active=${active},updated_at=${now} where user_id=${review.user_id}::uuid`;
            if (decision === "approved" || decision === "rejected") {
              await tx`update private.student_registration_requests set status=${decision},decision_reason=${reason},decided_at=${now},decided_by=${a.user.id}::uuid,updated_at=${now} where id=${review.request_id}::uuid`;
            }
            await tx`insert into private.student_identity_audit_events(request_id,actor_user_id,subject_user_id,event_type,reason,metadata) values(${review.request_id}::uuid,${a.user.id}::uuid,${review.user_id}::uuid,${`review_${decision}`},${reason},${
              tx.json({ from: review.status, to: target })
            })`;
            return target;
          });
          return out(req, { ok: true, status: target });
        }
        if (
          !new Set(["needs_information", "rejected", "approved"]).has(decision)
        ) throw new IdentityInputError("invalid_decision", "القرار غير صالح.");
        if (decision !== "approved") {
          await sql`update private.student_registration_requests set status=${decision},decision_reason=${reason},decided_at=case when ${decision}='rejected' then now() else decided_at end,decided_by=case when ${decision}='rejected' then ${a.user.id}::uuid else decided_by end,updated_at=now() where public_ref=${ref}::uuid and status in('pending','needs_information')`;
          return out(req, { ok: true });
        }
        const group = txt(body.group_code, 80), attemptId = crypto.randomUUID();
        const r: any = await sql.begin(async (tx) => {
          const [x]: any =
            await tx`select r.* from private.student_registration_requests r join private.student_privacy_consents pc on pc.request_id=r.id and pc.notice_version=r.privacy_notice_version and pc.consent_kind='registration_and_identity_processing' where r.public_ref=${ref}::uuid and r.status in('pending','needs_information') for update of r`;
          if (!x) {
            throw new IdentityInputError(
              "request_not_approvable",
              "الطلب غير مكتمل أو لم يعد معلقًا.",
            );
          }
          const duplicate =
            !!x.duplicate_review?.national_id_already_registered ||
            Number(x.duplicate_review?.phone_request_count ?? 0) > 0;
          if (duplicate && !x.duplicate_review_resolved_at) {
            if (
              body.duplicate_review_resolved !== true &&
              body.duplicate_review_resolved !== "on"
            ) {
              throw new IdentityInputError(
                "duplicate_review_required",
                "يجب حسم مراجعة التكرار قبل إنشاء الحساب.",
              );
            }
            if (reason.length < 8) {
              throw new IdentityInputError(
                "duplicate_review_reason_required",
                "اكتب نتيجة واضحة لمراجعة التكرار.",
              );
            }
            await tx`update private.student_registration_requests set duplicate_review_resolved_at=now(),duplicate_review_resolved_by=${a.user.id}::uuid,duplicate_review_resolution=${reason} where id=${x.id}::uuid`;
          }
          if (!x.national_id_exception_requested) {
            const [used] =
              await tx`select 1 from private.student_sensitive_identities where national_id_hmac=${x.national_id_hmac} limit 1`;
            if (used) {
              throw new IdentityInputError(
                "identity_already_registered",
                "هذه الهوية مرتبطة بحساب قائم.",
              );
            }
            const [{ claimed: identityClaimed }] =
              await tx`select private.reserve_student_identity_claim(${x.id}::uuid,${x.national_id_hmac}) claimed`;
            if (!identityClaimed) {
              throw new IdentityInputError(
                "duplicate_identity_request",
                "يوجد طلب آخر يحجز هذه الهوية. يجب مراجعة الحساب القائم بدل إنشاء حساب جديد.",
              );
            }
          }
          const [{ code }] =
            await tx`select private.reserve_student_code(${x.id}::uuid,${group},${x.grade_level}) code`;
          await tx`update private.student_registration_requests set assigned_student_code=${code},assigned_group_code=${group},requested_group_code=coalesce(requested_group_code,${group}),updated_at=now() where id=${x.id}::uuid`;
          const [{ claimed }] =
            await tx`select private.claim_student_registration_provisioning(${x.id}::uuid,${attemptId}::uuid) claimed`;
          if (!claimed) {
            throw new IdentityInputError(
              "provisioning_in_progress",
              "إنشاء الحساب قيد التنفيذ بالفعل. أعد المحاولة لاحقًا.",
            );
          }
          return { ...x, code, assigned_group_code: group };
        });
        let authId = r.auth_user_id;
        const email = `${r.code.toLowerCase()}@students.yrphysicspractice.com`;
        if (!authId) {
          const [recoverable] =
            await sql`select id from auth.users where lower(email)=lower(${email}) and raw_app_meta_data->>'registration_request_id'=${r.public_ref} limit 1`;
          if (recoverable) authId = recoverable.id;
          else {
            if (
              SYNTHETIC_FAILPOINTS &&
              body.test_failpoint === "auth_create_error"
            ) {
              await sql`update private.student_registration_requests set provisioning_status='failed',provisioning_lock_token=null,provisioning_locked_at=null,updated_at=now() where id=${r.id}::uuid and provisioning_lock_token=${attemptId}::uuid`;
              throw new Error("synthetic_auth_create_failed");
            }
            const temp = `T-${crypto.randomUUID()}-${
              crypto.randomUUID().slice(0, 24)
            }`;
            const { data, error } = await admin.auth.admin.createUser({
              email,
              password: temp,
              email_confirm: true,
              app_metadata: {
                role: "student",
                registration_request_id: r.public_ref,
                synthetic_e2e: SYNTHETIC_FAILPOINTS,
                ...(SYNTHETIC_FAILPOINTS
                  ? { synthetic_run: txt(body.synthetic_run, 80) }
                  : {}),
              },
            });
            if (error || !data.user) {
              await sql`update private.student_registration_requests set provisioning_status='failed',provisioning_lock_token=null,provisioning_locked_at=null,updated_at=now() where id=${r.id}::uuid and provisioning_lock_token=${attemptId}::uuid and status<>'approved'`;
              throw new Error("auth_create_failed");
            }
            authId = data.user.id;
            if (
              SYNTHETIC_FAILPOINTS &&
              body.test_failpoint === "after_auth_create"
            ) throw new Error("synthetic_after_auth_create");
          }
          const [linked] =
            await sql`update private.student_registration_requests set auth_user_id=${authId}::uuid,provisioning_status='auth_created',updated_at=now() where id=${r.id}::uuid and provisioning_lock_token=${attemptId}::uuid and (auth_user_id is null or auth_user_id=${authId}::uuid) returning id`;
          if (!linked) {
            await sql`update private.student_registration_requests set provisioning_status='failed',provisioning_lock_token=null,provisioning_locked_at=null,updated_at=now() where id=${r.id}::uuid and provisioning_lock_token=${attemptId}::uuid and status<>'approved'`;
            throw new Error("auth_link_conflict");
          }
        }
        const activation = b64(crypto.getRandomValues(new Uint8Array(32))),
          activationHash = await hashToken(activation);
        try {
          await sql.begin(async (tx) => {
            const [g] =
              await tx`select id,group_code,center_name,grade_level from public.student_groups where group_code=${group} and is_active for share`;
            if (!g) {
              throw new IdentityInputError(
                "invalid_group",
                "المجموعة غير موجودة أو غير نشطة.",
              );
            }
            const compatible = (r.grade_level === "الصف الثاني الثانوي" &&
              (String(g.grade_level ?? "").includes("الثاني") ||
                String(g.grade_level ?? "").startsWith("2"))) ||
              (r.grade_level === "الصف الثالث الثانوي" &&
                (String(g.grade_level ?? "").includes("الثالث") ||
                  String(g.grade_level ?? "").startsWith("3")));
            if (!compatible) {
              throw new IdentityInputError(
                "group_grade_mismatch",
                "صف الطالب لا يطابق صف المجموعة.",
              );
            }
            await tx`insert into public.student_profiles(user_id,student_code,full_name,grade_level,is_active,center_name,group_code,student_phone,guardian_phone) values(${authId}::uuid,${r.code},${r.full_name},${r.grade_level},false,${g.center_name},${group},${r.student_phone_e164},${r.guardian_phone_e164}) on conflict(user_id) do nothing`;
            const [p] =
              await tx`select user_id from public.student_profiles where user_id=${authId}::uuid and student_code=${r.code} and group_code=${group} and grade_level=${r.grade_level} and not is_active for update`;
            if (!p) throw new Error("profile_link_conflict");
            await tx`insert into public.student_group_memberships(group_id,user_id,joined_on) select ${g.id}::uuid,${authId}::uuid,current_date where not exists(select 1 from public.student_group_memberships where user_id=${authId}::uuid and left_on is null)`;
            const [m] =
              await tx`select id from public.student_group_memberships where user_id=${authId}::uuid and group_id=${g.id}::uuid and left_on is null`;
            if (!m) throw new Error("membership_link_conflict");
            await tx`insert into private.student_sensitive_identities(user_id,national_id_ciphertext,national_id_iv,national_id_hmac,national_id_last4,birth_date) select ${authId}::uuid,${r.national_id_ciphertext},${r.national_id_iv},${r.national_id_hmac},${r.national_id_last4},${r.birth_date} where ${r.national_id_hmac}::text is not null on conflict(user_id) do nothing`;
            if (r.national_id_exception_requested) {
              await tx`insert into private.student_identity_exceptions(user_id,birth_date,reason,approved_by) values(${authId}::uuid,${r.birth_date},${r.national_id_exception_reason},${a.user.id}::uuid) on conflict(user_id) do nothing`;
            }
            const [idOk] =
              await tx`select 1 from private.student_sensitive_identities where user_id=${authId}::uuid union all select 1 from private.student_identity_exceptions where user_id=${authId}::uuid limit 1`;
            if (!idOk) throw new Error("identity_link_incomplete");
            if (r.national_id_hmac) {
              const [claim] =
                await tx`update private.student_identity_claims set status='assigned',user_id=${authId}::uuid,assigned_at=now() where request_id=${r.id}::uuid and national_id_hmac=${r.national_id_hmac} returning request_id`;
              if (!claim) throw new Error("identity_claim_incomplete");
            }
            await tx`insert into private.student_login_identifiers(user_id,kind,normalized_value,verified,verified_at,verification_source) values(${authId}::uuid,'student_code',${r.code},true,now(),'legacy_code') on conflict do nothing`;
            await tx`insert into private.student_profile_status(user_id) values(${authId}::uuid) on conflict do nothing`;
            await tx`update private.student_activation_tokens set expires_at=least(expires_at,now()),state=case when state='issued' then 'expired' else state end where request_id=${r.id}::uuid and used_at is null`;
            await tx`insert into private.student_activation_tokens(request_id,user_id,token_hash,expires_at,issued_by) values(${r.id}::uuid,${authId}::uuid,${activationHash},now()+interval '72 hours',${a.user.id}::uuid)`;
            await tx`update private.student_code_reservations set status='assigned',assigned_at=now() where request_id=${r.id}::uuid and student_code=${r.code} and status='reserved'`;
            const [done] =
              await tx`update private.student_registration_requests set status='approved',provisioning_status='activation_issued',provisioning_lock_token=null,provisioning_locked_at=null,assigned_group_code=${group},decision_reason=${reason},decided_at=now(),decided_by=${a.user.id}::uuid,updated_at=now() where id=${r.id}::uuid and auth_user_id=${authId}::uuid and provisioning_lock_token=${attemptId}::uuid returning id`;
            if (!done) throw new Error("registration_finalize_failed");
            await tx`insert into private.student_identity_audit_events(request_id,actor_user_id,subject_user_id,event_type,reason,metadata) values(${r.id}::uuid,${a.user.id}::uuid,${authId}::uuid,'registration_approved',${reason},${
              tx.json({ student_code: r.code, group_code: group })
            })`;
          });
        } catch (e) {
          await sql`update private.student_registration_requests set provisioning_status='failed',provisioning_lock_token=null,provisioning_locked_at=null,updated_at=now() where id=${r.id}::uuid and provisioning_lock_token=${attemptId}::uuid and status<>'approved'`;
          throw e;
        }
        return out(req, {
          ok: true,
          student_code: r.code,
          activation_token: activation,
          expires_in_hours: 72,
        });
      }
    }
    return out(req, { error: "unknown_action" }, 400);
  } catch (e) {
    if (e instanceof IdentityInputError) {
      return out(
        req,
        { error: e.code, message: e.message },
        e.code === "rate_limited" ? 429 : 400,
      );
    }
    console.error(
      "student-identity",
      action,
      e instanceof Error ? e.message : "error",
    );
    return out(req, {
      error: "server_error",
      message: "تعذر تنفيذ الطلب بأمان.",
    }, 500);
  }
});
