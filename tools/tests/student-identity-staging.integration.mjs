import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { extname, resolve } from "node:path";
const prod = "ltjdhconuiqblxfjzpzj",
  target = process.env.E2E_TARGET || "staging",
  local = target === "local",
  url = (process.env.E2E_SUPABASE_URL || "").replace(/\/$/, ""),
  anon = process.env.E2E_ANON_KEY || "",
  service = process.env.E2E_SERVICE_ROLE_KEY || "",
  container = process.env.E2E_DB_CONTAINER || "",
  dbUrl = process.env.E2E_DB_URL || "",
  allow = new Set(
    (process.env.E2E_ALLOWED_PROJECT_REFS || "").split(",").filter(Boolean),
  );
if (
  !url ||
  !anon ||
  !service ||
  process.env.E2E_ALLOW_WRITES !== "synthetic-e2e-only"
)
  throw Error("Explicit synthetic E2E configuration required.");
const host = new URL(url).hostname,
  ref = host.match(/^([a-z0-9]+)\.supabase\.co$/)?.[1];
if (host.includes(prod) || dbUrl.includes(prod))
  throw Error("Production is forbidden.");
if (local) {
  if (
    !["localhost", "127.0.0.1"].includes(host) ||
    !container.startsWith("yr-identity-e2e-")
  )
    throw Error("Invalid local target.");
} else if (!ref || !allow.has(ref) || !dbUrl.includes(ref))
  throw Error("Cloud staging ref is not allow-listed and matched.");
const image =
    "postgres@sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b",
  run = `e2e-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
  group = `SYN-${crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}-A`,
  base = { "content-type": "application/json", apikey: anon },
  svc = { ...base, authorization: `Bearer ${service}` },
  mail = (n) => `${run}-${n}@example.invalid`;
function sql(q) {
  const a = local
      ? [
          "exec",
          "-i",
          container,
          "psql",
          "-X",
          "-v",
          "ON_ERROR_STOP=1",
          "-U",
          "postgres",
          "-d",
          "postgres",
          "-Atc",
          q,
        ]
      : [
          "run",
          "--rm",
          image,
          "psql",
          dbUrl,
          "-X",
          "-v",
          "ON_ERROR_STOP=1",
          "-Atc",
          q,
        ],
    r = spawnSync("docker", a, { encoding: "utf8" });
  if (r.status) throw Error(String(r.stderr).trim());
  return r.stdout.trim();
}
// Only the disposable local Docker stack has a known synthetic HMAC key.
// Track the exact limiter entries created by this test run, never purge the table.
const localLimiterSecret = local
    ? Buffer.from("fedcba9876543210fedcba9876543210")
    : null,
  localLimiterPairs = new Set();
function localDigest(value) {
  return createHmac("sha256", localLimiterSecret)
    .update(value)
    .digest("base64");
}
function trackLocalLimiter(path, body, ip) {
  if (!local || path !== "/functions/v1/student-identity" || !body?.action) return;
  const ipScopes = {
    submit_registration: "registration",
    registration_status: "registration_status",
    request_recovery: "recovery",
    reset_password: "password_reset",
    activate: "activation",
  };
  const scope = ipScopes[body.action];
  if (scope) localLimiterPairs.add(`${scope}:${localDigest(`rate:${scope}:${ip}`)}`);
  if (body.action === "submit_registration" && body.student_phone) {
    const phoneHmac = localDigest(`registration-phone:${body.student_phone}`);
    localLimiterPairs.add(`registration_phone:${localDigest(`rate:registration_phone:${phoneHmac}`)}`);
  }
}
function cleanupLocalLimiter() {
  if (!local || !localLimiterPairs.size) return;
  const pairs = [...localLimiterPairs].map((pair) => {
    const colon = pair.indexOf(":");
    const scope = pair.slice(0, colon), key = pair.slice(colon + 1);
    assert.match(scope, /^[a-z_]+$/);
    assert.match(key, /^[A-Za-z0-9+/]+={0,2}$/);
    return `('${scope}','${key}')`;
  });
  const owned = `(scope,subject_hmac) in (values ${pairs.join(",")})`;
  sql(`delete from private.student_identity_rate_limits where ${owned}`);
  assert.equal(sql(`select count(*) from private.student_identity_rate_limits where ${owned}`), "0");
}
async function req(
  path,
  { body, token, admin = false, method = "POST", ip = "198.51.100.10" } = {},
) {
  trackLocalLimiter(path, body, ip);
  const r = await fetch(url + path, {
    method,
    headers: {
      ...(admin
        ? svc
        : { ...base, ...(token ? { authorization: `Bearer ${token}` } : {}) }),
      "x-forwarded-for": ip,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = {};
  try {
    data = await r.json();
  } catch {}
  return { status: r.status, body: data };
}
const invoke = (action, body = {}, token, ip) =>
    req("/functions/v1/student-identity", {
      body: {
        action,
        ...body,
        ...(action === "admin_decide" ? { synthetic_run: run } : {}),
      },
      token,
      ip,
    }),
  login = (email, password) =>
    req("/auth/v1/token?grant_type=password", { body: { email, password } }),
  uuid = (v) => {
    assert.match(String(v), /^[0-9a-f-]{36}$/i);
    return String(v);
  },
  flags = (v) =>
    sql(
      `update private.student_identity_settings set ${Object.entries(v)
        .map(
          ([k, x]) =>
            `${k}=${typeof x === "string" ? `'${x}'` : x ? "true" : "false"}`,
        )
        .join(",")},updated_at=now() where singleton`,
    );
async function createAuth(email, password, role) {
  const r = await req("/auth/v1/admin/users", {
    admin: true,
    body: {
      email,
      password,
      email_confirm: true,
      app_metadata: { role, synthetic_run: run },
    },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return uuid(r.body.id);
}
const form = (
  phone,
  key = crypto.randomUUID(),
  password = "StudentPass2026!",
) => {
  const words = [
      "صفر",
      "واحد",
      "اثنان",
      "ثلاثة",
      "أربعة",
      "خمسة",
      "ستة",
      "سبعة",
      "ثمانية",
      "تسعة",
    ],
    suffix = words[Number(phone.at(-1))] || "اختبار";
  return {
    full_name: `طالب تجريبي كامل ${suffix}`,
    grade_level: "الصف الثاني الثانوي",
    education_system: "عام",
    attendance_location: "ناهيا",
    residence_area: `e2e:${run}`,
    student_phone: phone,
    guardian_phone: "+201112345678",
    group_code: group,
    password,
    password_confirm: password,
    privacy_accepted: true,
    privacy_notice_version: "draft-v1",
    request_idempotency_key: key,
    synthetic_run: run,
  };
};
function proofIds() {
  return sql(
    `with r as(select id,public_ref,auth_user_id from private.student_registration_requests where residence_area='e2e:${run}')select id from auth.users where raw_app_meta_data->>'synthetic_run'='${run}' union select auth_user_id from r where auth_user_id is not null union select u.id from auth.users u join r on u.raw_app_meta_data->>'registration_request_id'=r.public_ref::text`,
  )
    .split("\n")
    .filter(Boolean);
}
async function cleanup() {
  const ids = proofIds(),
    script = readFileSync(
      "tools/fixtures/student_identity_staging_cleanup.sql",
      "utf8",
    )
      .replaceAll("__RUN_ID__", run)
      .replaceAll("__GROUP_CODE__", group)
      .replaceAll("__SECOND_GROUP_CODE__", group.replace(/-A$/, "-B"));
  sql(script);
  cleanupLocalLimiter();
  for (const id of ids) {
    const r = await req(`/auth/v1/admin/users/${id}`, {
      admin: true,
      method: "DELETE",
    });
    assert.ok([200, 204, 404].includes(r.status), `cleanup ${id}: ${r.status}`);
  }
}
function academicFingerprint() {
  if (local)
    return sql(
      "select attempt_count||':'||grade_total from private.local_e2e_academic_sentinel",
    );
  const out = {};
  for (const table of [
    "private.workshop_attempt_events",
    "private.workshop_grading_decisions",
    "private.homework_attempts",
  ])
    if (sql(`select to_regclass('${table}') is not null`) === "t")
      out[table] = sql(`select count(*) from ${table}`);
  assert.ok(Object.keys(out).length >= 2);
  return out;
}
async function register(phone, name, password = "StudentPass2026!", failpoint) {
  const body = form(phone, crypto.randomUUID(), password);
  if (failpoint) body.test_failpoint = failpoint;
  const ip = `198.51.${parseInt(body.request_idempotency_key.slice(0, 2), 16)}.${parseInt(body.request_idempotency_key.slice(2, 4), 16)}`;
  return {
    body,
    ip,
    response: await invoke("submit_registration", body, undefined, ip),
  };
}
async function verifyPendingStudentPage(code, password) {
  const { chromium } = await import("playwright");
  const root = process.cwd(),
    server = createServer((request, response) => {
      try {
        const pathname = new URL(request.url, "http://local").pathname,
          file = resolve(
            root,
            pathname === "/" ? "student.html" : pathname.slice(1),
          );
        if (!file.startsWith(root)) {
          response.writeHead(403).end();
          return;
        }
        let body = readFileSync(file);
        if (
          file.endsWith("student-base.html") ||
          file.endsWith("student-account-shell.js") ||
          file.endsWith("student-identity-api.js")
        )
          body = Buffer.from(
            body
              .toString()
              .replaceAll("https://ltjdhconuiqblxfjzpzj.supabase.co", url)
              .replaceAll("sb_publishable_-7SIdrqTmUibqpA7mXXrgg_SHz9EJRr","synthetic-anon"),
          );
        const type =
          extname(file) === ".html"
            ? "text/html; charset=utf-8"
            : extname(file) === ".js"
              ? "text/javascript; charset=utf-8"
              : extname(file) === ".css"
                ? "text/css"
                : "application/octet-stream";
        response
          .writeHead(200, { "content-type": type, "cache-control": "no-store" })
          .end(body);
      } catch {
        response.writeHead(404).end();
      }
    });
  await new Promise((ok, fail) =>
    server.once("error", fail).listen(58001, "127.0.0.1", ok),
  );
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || chromium.executablePath(),
    args: ["--no-sandbox", "--ignore-certificate-errors"],
  });
  try {
    const page = await browser.newPage({ ignoreHTTPSErrors: true });
    const browserErrors = [];
    page.on("console", (entry) => {
      if (entry.type() === "error") browserErrors.push(entry.text());
    });
    page.on("pageerror", (error) => browserErrors.push(error.message));
    page.on("requestfailed", (request) =>
      browserErrors.push(`request failed ${request.url()}: ${request.failure()?.errorText}`)
    );
    page.on("response", (response) => {
      if (response.status() >= 400)
        browserErrors.push(`response ${response.status()} ${response.url()}`);
    });
    await page.goto("http://127.0.0.1:58001/student-register.html?tab=login");
    await page.waitForSelector("#accessStudentCode");
    await page.fill("#accessStudentCode", code);
    await page.fill("#accessPassword", password);
    await page.click("#accessLoginBtn");
    try {
      await page.waitForSelector("#studentReviewGate", { timeout: 10000 });
    } catch {
      const debug = await page.evaluate(() => ({
        url: location.href,
        message: document.querySelector("#msg")?.textContent,
        review: window.__yrStudentReview,
        authKeys: Object.keys(localStorage).filter((key) => key.includes("auth")),
        body: document.body.innerText.slice(0, 500),
      }));
      throw new Error(`pending page gate missing: ${JSON.stringify({ debug, browserErrors })}`);
    }
    assert.match(
      await page.locator("#studentReviewGate").textContent(),
      /قيد مراجعة الإدارة/,
    );
    assert.equal(await page.locator("#dashboardView:not(.hidden)").count(), 0);
    assert.ok(
      await page.evaluate(() =>
        Object.keys(localStorage).some(
          (k) => k.startsWith("sb-") && k.endsWith("-auth-token"),
        ),
      ),
      "Auth session was not persisted",
    );
    await page.reload();
    await page.waitForSelector("#studentReviewGate");
    assert.match(
      await page.locator("#studentReviewGate").textContent(),
      /قيد مراجعة الإدارة/,
    );
    assert.ok(
      await page.evaluate(() =>
        Object.keys(localStorage).some(
          (k) => k.startsWith("sb-") && k.endsWith("-auth-token"),
        ),
      ),
      "pending session was signed out after reload",
    );
  } finally {
    await browser.close();
    await new Promise((ok) => server.close(ok));
  }
}

async function verifyProfileWizardInBrowser(studentCode,password,groupCode){
  const {chromium}=await import("playwright");
  const root=process.cwd();
  const server=createServer((req,res)=>{
    try{
      const pathname=new URL(req.url,"http://local").pathname;
      const file=resolve(root,pathname==="/"?"student.html":pathname.slice(1));
      if(!file.startsWith(root)){res.writeHead(403).end();return}
      let body=readFileSync(file);
      if(file.endsWith("student-identity-api.js")){
        body=Buffer.from(body.toString()
          .replaceAll("https://ltjdhconuiqblxfjzpzj.supabase.co",url)
          .replaceAll("sb_publishable_-7SIdrqTmUibqpA7mXXrgg_SHz9EJRr","synthetic-anon"));
      }
      const ext=extname(file), mime=ext===".html"?"text/html; charset=utf-8"
        :ext===".js"?"text/javascript; charset=utf-8"
        :ext===".css"?"text/css; charset=utf-8":"application/octet-stream";
      res.writeHead(200,{"content-type":mime,"cache-control":"no-store"}).end(body);
    }catch{res.writeHead(404).end()}
  });
  await new Promise((ok,fail)=>server.once("error",fail).listen(58001,"127.0.0.1",ok));
  const browser=await chromium.launch({headless:true,
    executablePath:process.env.CHROMIUM_PATH||chromium.executablePath(),
    args:["--no-sandbox","--ignore-certificate-errors"]});
  try{
    const page=await browser.newPage({ignoreHTTPSErrors:true});
    const errors=[];
    page.on("pageerror",e=>errors.push(e.message));
    page.on("console",entry=>{if(entry.type()==="error")errors.push(entry.text())});
    await page.goto("http://127.0.0.1:58001/student-register.html?tab=login");
    await page.locator("#accessStudentCode").fill(studentCode);
    await page.locator("#accessPassword").fill(password);
    await page.locator("#accessLoginBtn").click();
    try{
      await page.waitForURL(/student-complete-profile\.html/,{timeout:16000});
      await page.locator("#wizard:not(.hidden)").waitFor({timeout:16000});
    }catch(err){
      const debug=await page.evaluate(()=>({
        url:location.href,loginMessage:document.querySelector("#loginMessage")?.textContent,
        profileMessage:document.querySelector("#profileLockedMessage")?.textContent,
        body:document.body.innerText.slice(0,350)
      }));
      throw new Error("profile wizard redirect/prefill failure: "+JSON.stringify({debug,errors}));
    }
    assert.equal(await page.locator("#fixedStudentCode").inputValue(),studentCode);
    assert.equal(await page.locator("#fixedStudentCode").isEditable(),false);
    assert.equal(await page.locator("#firstName").inputValue(),"طالب");
    assert.equal(await page.locator("#grade").inputValue(),"الصف الثاني الثانوي");
    assert.equal(await page.locator("#changePassword").isChecked(),false);
    await page.locator("#next").click();
    await page.locator("#system").selectOption("عام");
    await page.locator("#location").selectOption("غير ذلك");
    await page.locator("#group").selectOption(groupCode);
    await page.locator("#next").click();
    await page.locator("#phone").fill("01012345589");
    await page.locator("#guardian").fill("01112345677");
    await page.locator("#next").click();
    await page.locator('input[name="privacy"]').check();
    await page.locator("#submitBtn").click();
    try{await page.locator("#receipt:not(.hidden)").waitFor({timeout:16000})}
    catch(err){
      const debug=await page.evaluate(()=>({
         message:document.querySelector("#message")?.textContent,
         currentPanel:[...document.querySelectorAll(".step-panel")].findIndex(x=>!x.hidden),
         active:document.activeElement?.id,
         validation:document.activeElement?.validationMessage
      }));
      throw new Error("profile completion browser submit failed: "+JSON.stringify({debug,errors}));
    }
    assert.match(await page.locator("#receipt").innerText(),/تم حفظ بياناتك بنجاح/);
    assert.equal(await page.locator("#fixedStudentCode").inputValue(),studentCode);
    console.log("Browser E2E: real code/password login, automatic completion redirect, prefilled immutable code, four-step form and verified profile save PASS");
  } finally {
    await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
}

test("immediate registration and 48-hour review journey", async (t) => {
  const original = JSON.parse(
    sql(
      "select row_to_json(s)::text from private.student_identity_settings s where singleton",
    ),
  );
  t.after(async () => {
    const errors = [];
    try {
      flags({
        registration_enabled: original.registration_enabled,
        immediate_registration_enabled: original.immediate_registration_enabled,
        registration_rollout_scope: original.registration_rollout_scope,
        national_id_collection_enabled: original.national_id_collection_enabled,
        phone_login_enabled: original.phone_login_enabled,
        profile_update_enabled: original.profile_update_enabled,
        profile_enforcement_enabled: original.profile_enforcement_enabled,
        sms_provider_ready: original.sms_provider_ready,
      });
    } catch (e) {
      errors.push(e.message);
    }
    try {
      await cleanup();
    } catch (e) {
      errors.push(e.message);
    }
    assert.deepEqual(errors, []);
  });
  let adminEmail,
    adminPassword = "AdminSynthetic2026!",
    adminId;
  if (local) {
    adminEmail = mail("admin");
    adminId = await createAuth(adminEmail, adminPassword, "admin");
    sql(
      `insert into public.local_e2e_admin_permissions values('${adminId}','students','edit')`,
    );
  } else {
    adminEmail = process.env.E2E_STAGING_ADMIN_EMAIL;
    adminPassword = process.env.E2E_STAGING_ADMIN_PASSWORD;
    const r = await login(adminEmail, adminPassword);
    assert.equal(r.status, 200);
    adminId = r.body.user.id;
    assert.equal(
      sql(`select public.admin_access_level('students','${adminId}'::uuid)`),
      "edit",
    );
  }
  const legacyEmail = mail("legacy"),
    legacyPass = "LegacySynthetic2026!",
    legacyId = await createAuth(legacyEmail, legacyPass, "student");
  sql(
    `insert into public.student_groups(group_code,is_active,grade_level,center_name)values('${group}',true,'الصف الثاني الثانوي','Synthetic E2E');insert into public.student_profiles(user_id,student_code,full_name,grade_level,is_active,group_code,student_phone,guardian_phone)values('${legacyId}','${group.slice(0, -1)}900','طالب قديم تجريبي كامل','الصف الثاني الثانوي',true,'${group}','+201012345590','+201112345678');insert into public.student_group_memberships(group_id,user_id,joined_on)select id,'${legacyId}',current_date from public.student_groups where group_code='${group}';insert into private.student_login_identifiers(user_id,kind,normalized_value,verified,verified_at,verification_source)values('${legacyId}','student_code','${group.slice(0, -1)}900',true,now(),'legacy_code')`,
  );
  if (local)
    sql(
      `insert into private.local_e2e_academic_sentinel values('${legacyId}',1,7)`,
    );
  const academic = academicFingerprint();
  const adminToken = (await login(adminEmail, adminPassword)).body.access_token;

  if (local) await t.test("existing student completion: authenticated save, password and admin review", async (t) => {
    const code=group.replace(/-A$/,"-901"), mailAddr=code.toLowerCase()+"@students.yrphysicspractice.com",
      oldPass="ProfileTest2026!", newPass="UpdatedProfile2026!";
    const uid=await createAuth(mailAddr,oldPass,"student"), other=group.replace(/-A$/,"-B");
    sql(`insert into public.student_groups(group_code,is_active,grade_level,center_name) values('${other}',true,'الصف الثاني الثانوي','Synthetic E2E B');
       insert into public.student_profiles(user_id,student_code,full_name,grade_level,is_active,group_code,center_name,student_phone,guardian_phone)
       values('${uid}','${code}','طالب اختباري قديم كامل','الصف الثاني الثانوي',true,'${group}','Synthetic E2E','+201012345589',null);
       insert into public.student_group_memberships(group_id,user_id,joined_on)
       select id,'${uid}',current_date from public.student_groups where group_code='${group}'`);
    flags({profile_update_enabled:true});
    const login1=await login(mailAddr,oldPass);assert.equal(login1.status,200,JSON.stringify(login1.body));
    const token=login1.body.access_token;
    const me0=await invoke("me",{},token);assert.equal(me0.status,200,JSON.stringify(me0.body));
    assert.equal(me0.body.profile.student_code,code);assert.equal(me0.body.profile.profile_schema_version,0);
    assert.ok(me0.body.groups.some(g=>g.group_code===other));
    const payload={full_name:"طالب اختباري قديم كامل",grade_level:"الصف الثاني الثانوي",
      education_system:"عام",attendance_location:"غير ذلك",group_code:group,
      residence_area:"قرية تجريبية",student_phone:"01012345589",guardian_phone:"01112345677",
      privacy_accepted:true,privacy_notice_version:"draft-v1"};
    await t.test("anonymous and invalid-consent writes denied",async()=>{
      assert.equal((await invoke("complete_profile_v2",{...payload,student_code:"FAKE-999"})).status,401);
      assert.equal((await invoke("admin_profile_changes",{},token)).status,403);
      const bad=await invoke("complete_profile_v2",{...payload,privacy_accepted:false},token);
      assert.equal(bad.status,400,JSON.stringify(bad.body));
    });
    if(process.env.E2E_BROWSER_CURRENT==="1"){
      await t.test("browser: actual login redirects to mandatory prefilled wizard and saves",async()=>{
        sql(`update private.student_identity_settings set enforcement_coverage_approved_at=now(),
          enforcement_coverage_approved_by='${adminId}'::uuid where singleton`);
        flags({profile_enforcement_enabled:true});
        try{await verifyProfileWizardInBrowser(code,oldPass,group)}
        finally{
          flags({profile_enforcement_enabled:false});
          sql("update private.student_identity_settings set enforcement_coverage_approved_by=null,enforcement_coverage_approved_at=null where singleton");
        }
      });
    }
    await t.test("prefilled data updates durably while code remains immutable",async()=>{
      const saved=await invoke("complete_profile_v2",{...payload,student_code:"FAKE-999"},token);
      assert.equal(saved.status,200,JSON.stringify(saved.body));assert.equal(saved.body.pending_change,false);
      const me=await invoke("me",{},token);assert.equal(me.status,200,JSON.stringify(me.body));
      assert.equal(me.body.profile.student_code,code);
      assert.equal(me.body.profile.student_phone,"+201012345589");
      assert.equal(me.body.profile.guardian_phone,"+201112345677");
      assert.equal(me.body.details.education_system,"عام");
      assert.equal(me.body.details.residence_area,"قرية تجريبية");
      assert.equal(me.body.profile.profile_schema_version,1);assert.ok(me.body.profile.completed_at);
      assert.equal(sql(`select count(*) from private.student_profile_change_requests where user_id='${uid}'`),"0");
    });
    await t.test("current password required; new login preserves student identity",async()=>{
      const bad=await invoke("change_password",{current_password:"Incorrect2026!",new_password:newPass},token);
      assert.equal(bad.status,401,JSON.stringify(bad.body));
      const good=await invoke("change_password",{current_password:oldPass,new_password:newPass},token);
      assert.equal(good.status,200,JSON.stringify(good.body));
      assert.notEqual((await login(mailAddr,oldPass)).status,200);
      const session=await login(mailAddr,newPass);assert.equal(session.status,200,JSON.stringify(session.body));
      assert.equal(session.body.user.id,uid);
      assert.equal((await invoke("me",{},session.body.access_token)).body.profile.student_code,code);
    });
    await t.test("reviewed group/name change cannot change educational assignment before approval",async()=>{
      const fresh=(await login(mailAddr,newPass)).body.access_token;
      const requested=await invoke("complete_profile_v2",{...payload,group_code:other,full_name:"طالب اختباري متغير كامل"},fresh);
      assert.equal(requested.status,200,JSON.stringify(requested.body));
      assert.equal(requested.body.pending_change,true);
      assert.equal(sql(`select group_code from public.student_profiles where user_id='${uid}'`),group);
      const list=await invoke("admin_profile_changes",{},adminToken);
      assert.equal(list.status,200,JSON.stringify(list.body));
      const request=list.body.requests.find(r=>r.user_id===uid);assert.ok(request);
      assert.equal(request.requested_profile.group_code,other);
      assert.equal((await invoke("admin_profile_change_decide",{request_id:request.id,decision:"approved",reason:"اختبار مسار الموافقة الإدارية"},fresh)).status,403);
      const approved=await invoke("admin_profile_change_decide",{request_id:request.id,decision:"approved",reason:"اختبار مسار الموافقة الإدارية"},adminToken);
      assert.equal(approved.status,200,JSON.stringify(approved.body));
      assert.equal(sql(`select group_code from public.student_profiles where user_id='${uid}'`),other);
      assert.equal(sql(`select student_code from public.student_profiles where user_id='${uid}'`),code);
      assert.equal(sql(`select full_name from public.student_profiles where user_id='${uid}'`),"طالب اختباري متغير كامل");
      assert.equal(sql(`select count(*) from public.student_group_memberships m join public.student_groups g on m.group_id=g.id where m.user_id='${uid}' and m.left_on is null and g.group_code='${other}'`),"1");
    });
    await t.test("rejection retains original student record",async()=>{
      const fresh=(await login(mailAddr,newPass)).body.access_token;
      const requested=await invoke("complete_profile_v2",{...payload,group_code:other,full_name:"اسم جديد قيد المراجعة"},fresh);
      assert.equal(requested.status,200,JSON.stringify(requested.body));assert.equal(requested.body.pending_change,true);
      const row=(await invoke("admin_profile_changes",{},adminToken)).body.requests.find(r=>r.user_id===uid);
      assert.ok(row);
      const declined=await invoke("admin_profile_change_decide",{request_id:row.id,decision:"rejected",reason:"رفض اختبار للتأكد من عدم تعديل الاسم"},adminToken);
      assert.equal(declined.status,200,JSON.stringify(declined.body));
      assert.equal(sql(`select full_name from public.student_profiles where user_id='${uid}'`),"طالب اختباري متغير كامل");
      assert.equal((await invoke("me",{},fresh)).body.pending_change,false);
    });
    flags({profile_update_enabled:false,profile_enforcement_enabled:false});
  });
  await t.test("flags are fail-closed", async () => {
    const c = await invoke("config");
    assert.equal(c.body.registration_enabled, false);
  });
  flags({
    registration_enabled: true,
    immediate_registration_enabled: true,
    registration_rollout_scope: "limited",
    national_id_collection_enabled: false,
  });
  await t.test(
    "limited rollout requires a server-verified invitation without blocking a shared family phone",
    async () => {
      const c = await invoke("config");
      assert.equal(c.body.registration_enabled, true);
      assert.equal(c.body.registration_invite_required, true);
      const denied = await invoke(
        "submit_registration",
        form("+201012345590"),
        undefined,
        "198.51.90.1",
      );
      assert.equal(denied.status, 400);
      assert.equal(denied.body.error, "registration_invite_invalid");
      const created = await invoke(
        "admin_create_invite",
        { label: `e2e:${run}`, group_code: group, max_uses: 1, expires_in_hours: 1 },
        adminToken,
      );
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const token = created.body.invite_token;
      assert.match(token, /^yr-[a-z0-9_-]+$/i);
      assert.ok(created.body.registration_url.includes(encodeURIComponent(token)));
      assert.equal(created.body.group_code, group);
      assert.equal(
        sql(`select used_count from private.student_registration_invites where id='${created.body.invite_id}'`),
        "0",
      );
      const adminOverview = await invoke("admin_list", {}, adminToken);
      assert.equal(adminOverview.status, 200);
      assert.ok(adminOverview.body.invites.some((i) => i.id === created.body.invite_id));
      assert.equal(JSON.stringify(adminOverview.body).includes(token), false,
        "issued token must never be re-exposed through admin_list");
      const body = form("+201012345590");
      body.registration_invite = token;
      assert.equal(
        (await invoke("submit_registration", body, undefined, "198.51.90.2"))
          .status,
        201,
      );
      const risk = JSON.parse(
        sql(
          `select duplicate_review::text from private.student_registration_requests where student_phone_e164='+201012345590'`,
        ),
      );
      assert.equal(risk.existing_student_phone_matches, 1);
      assert.ok(risk.existing_family_phone_matches >= 1);
      const reused = form("+201012345591");
      reused.registration_invite = token;
      assert.equal(
        (await invoke("submit_registration", reused, undefined, "198.51.91.2"))
          .status,
        400,
      );
    },
  );
  flags({ registration_rollout_scope: "all" });
  await t.test("general public signup remains unavailable without genuine Turnstile keys", async () => {
    const config = await invoke("config");
    assert.equal(config.status, 200);
    assert.equal(config.body.captcha_required, true);
    assert.equal(config.body.captcha_ready, false);
    assert.equal(config.body.registration_enabled, false);
    const denied = await invoke("submit_registration", form("+201012345598"), undefined, "198.51.73.98");
    assert.equal(denied.status, 503);
    assert.equal(denied.body.error, "registration_unavailable");
  });
  flags({ registration_rollout_scope: "staging" });
  await t.test("registration rate limiting returns 429 on the sixth same-IP attempt", async () => {
    const parts = crypto.getRandomValues(new Uint8Array(2));
    const throttleIp = `198.51.${parts[0]}.${parts[1]}`;
    for (let attempt = 1; attempt <= 6; attempt++) {
      const response = await invoke("submit_registration", {}, undefined, throttleIp);
      assert.equal(response.status, attempt <= 5 ? 400 : 429,
        `Attempt ${attempt} unexpectedly returned ${response.status}: ${JSON.stringify(response.body)}`);
    }
  });
  await t.test("staging flags are applied explicitly", async () => {
    const c = await invoke("config");
    assert.equal(c.status, 200);
    assert.equal(c.body.registration_enabled, true, JSON.stringify(c.body));
    assert.equal(c.body.registration_rollout_scope, "staging");
  });
  const first = await register("+201012345601", "first", "StudentPass2026!");
  await t.test(
    "student chooses password and receives immediate unique code",
    () => {
      assert.equal(
        first.response.status,
        201,
        JSON.stringify(first.response.body),
      );
      assert.match(first.response.body.student_code, /^[A-Z0-9-]+\d{3}$/);
      assert.equal(first.response.body.status, "pending_review");
      assert.ok(first.response.body.review_deadline_at);
      assert.equal(
        JSON.stringify(first.response.body).includes("StudentPass2026!"),
        false,
      );
    },
  );
  const code = first.response.body.student_code,
    email = `${code.toLowerCase()}@students.yrphysicspractice.com`,
    token = (await login(email, "StudentPass2026!")).body.access_token;
  await t.test("immediate login and pending status work", async () => {
    assert.ok(token);
    const me = await invoke("me", {}, token);
    assert.equal(me.status, 200);
    assert.equal(me.body.review.status, "pending_review");
    assert.equal(me.body.review.educational_access, false);
  });
  await t.test("student or anonymous requests cannot list or approve registrations", async () => {
    const reference = sql(
      `select public_ref from private.student_registration_requests where assigned_student_code='${code}'`,
    );
    for (const credential of [undefined, token]) {
      for (const action of ["admin_list", "admin_decide", "admin_create_invite"]) {
        const payload = action === "admin_decide"
          ? { reference, decision: "approved", reason: "unprivileged synthetic attempt" }
          : action === "admin_create_invite"
          ? { label: "unauthorized test", group_code: group, max_uses: 1 }
          : {};
        const result = await invoke(action, payload, credential);
        assert.equal(result.status, 403, `denial expected for ${action}`);
        assert.equal(result.body.error, "forbidden");
      }
    }
    assert.equal(
      sql(`select status from private.student_account_reviews where request_id=(select id from private.student_registration_requests where public_ref='${reference}')`),
      "pending_review",
      "an unprivileged request must not modify the review state",
    );
  });
  await t.test("JWT admin metadata alone cannot approve without DB permission", async () => {
    const impersonatorEmail = mail("unprivileged-admin");
    const impersonatorPassword = "SyntheticUnprivilegedAdmin2026!";
    await createAuth(impersonatorEmail, impersonatorPassword, "admin");
    const impostor = await login(impersonatorEmail, impersonatorPassword);
    assert.equal(impostor.status, 200);
    const reference = sql(
      `select public_ref from private.student_registration_requests where assigned_student_code='${code}'`,
    );
    const denied = await invoke(
      "admin_decide",
      { reference, decision: "approved", reason: "metadata-only synthetic attempt" },
      impostor.body.access_token,
    );
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error, "forbidden");
    const deniedInvite = await invoke(
      "admin_create_invite",
      { label: "metadata-only attempt", group_code: group },
      impostor.body.access_token,
    );
    assert.equal(deniedInvite.status, 403);
    assert.equal(deniedInvite.body.error, "forbidden");
    assert.equal(
      sql(`select status from private.student_account_reviews where request_id=(select id from private.student_registration_requests where public_ref='${reference}')`),
      "pending_review",
    );
  });
  if (local && process.env.E2E_BROWSER_CURRENT === "1")
    await t.test(
      "real student.html keeps the GoTrue pending session and blocks educational UI",
      () => verifyPendingStudentPage(code, "StudentPass2026!"),
    );
  else
    await t.test(
      "real student.html with GoTrue",
      { skip: "Enabled in CI with E2E_BROWSER=1 and Playwright." },
      () => {},
    );
  await t.test("deadline is exactly 48 server hours", () =>
    assert.equal(
      sql(
        `select extract(epoch from(review_deadline_at-review_started_at))::int from private.student_account_reviews where user_id=(select auth_user_id from private.student_registration_requests where assigned_student_code='${code}')`,
      ),
      "172800",
    ),
  );
  await t.test(
    "approval within deadline preserves credentials/code",
    async () => {
      const r = await invoke(
        "admin_decide",
        {
          reference: sql(
            `select public_ref from private.student_registration_requests where assigned_student_code='${code}'`,
          ),
          decision: "approved",
          reason: "اعتماد تجريبي مكتمل",
        },
        adminToken,
      );
      assert.equal(r.status, 200);
      assert.equal((await login(email, "StudentPass2026!")).status, 200);
      const me = await invoke("me", {}, token);
      assert.equal(me.body.review.status, "approved");
      assert.equal(me.body.review.educational_access, true);
    },
  );
  const exp = await register("+201012345602", "expire", "ExpirePass2026!"),
    expCode = exp.response.body.student_code,
    expEmail = `${expCode.toLowerCase()}@students.yrphysicspractice.com`,
    expToken = (await login(expEmail, "ExpirePass2026!")).body.access_token,
    deadline = new Date(
      sql(
        `select review_deadline_at from private.student_account_reviews where request_id=(select id from private.student_registration_requests where assigned_student_code='${expCode}')`,
      ),
    );
  await t.test("boundary before expiry remains pending", async () => {
    const me = await invoke(
      "me",
      { test_now: new Date(deadline.getTime() - 1).toISOString() },
      expToken,
    );
    assert.equal(me.body.review.status, "pending_review");
  });
  await t.test("at deadline old JWT is server-blocked", async () => {
    const me = await invoke(
      "me",
      { test_now: new Date(deadline.getTime() + 1).toISOString() },
      expToken,
    );
    assert.equal(me.body.review.status, "suspended_pending_approval");
    assert.equal(me.body.review.educational_access, false);
    assert.equal(
      sql(
        `select is_active from public.student_profiles where student_code='${expCode}'`,
      ),
      "f",
    );
  });
  await t.test(
    "late approval restores same account/password/code",
    async () => {
      const reference = sql(
          `select public_ref from private.student_registration_requests where assigned_student_code='${expCode}'`,
        ),
        r = await invoke(
          "admin_decide",
          { reference, decision: "approved", reason: "اعتماد متأخر موثق" },
          adminToken,
        );
      assert.equal(r.status, 200);
      assert.equal((await login(expEmail, "ExpirePass2026!")).status, 200);
      assert.equal(
        (await invoke("me", {}, expToken)).body.review.status,
        "approved",
      );
    },
  );
  const rejected = await register("+201012345603", "reject"),
    rejToken = (
      await login(
        `${rejected.response.body.student_code.toLowerCase()}@students.yrphysicspractice.com`,
        "StudentPass2026!",
      )
    ).body.access_token,
    rejRef = sql(
      `select public_ref from private.student_registration_requests where assigned_student_code='${rejected.response.body.student_code}'`,
    );
  await t.test(
    "rejection blocks access and does not release the registration fingerprint",
    async () => {
      assert.equal(
        (
          await invoke(
            "admin_decide",
            {
              reference: rejRef,
              decision: "rejected",
              reason: "رفض تجريبي موثق",
            },
            adminToken,
          )
        ).status,
        200,
      );
      const me = await invoke("me", {}, rejToken);
      assert.equal(me.body.review.status, "rejected");
      assert.equal(me.body.review.educational_access, false);
      const retry = await register("+201012345603", "rejected-repeat");
      assert.equal(retry.response.status, 400);
      assert.equal(retry.response.body.error, "duplicate_registration");
    },
  );
  await t.test(
    "manual suspension preserves request decision and blocks re-registration",
    async () => {
      const ref = sql(
        `select public_ref from private.student_registration_requests where assigned_student_code='${code}'`,
      );
      assert.equal(
        (
          await invoke(
            "admin_decide",
            {
              reference: ref,
              decision: "suspended_by_admin",
              reason: "إيقاف إداري تجريبي",
            },
            adminToken,
          )
        ).status,
        200,
      );
      assert.equal(
        (await invoke("me", {}, token)).body.review.status,
        "suspended_by_admin",
      );
      assert.equal(
        sql(
          `select status from private.student_registration_requests where public_ref='${ref}'`,
        ),
        "approved",
      );
      const retry = await register("+201012345601", "suspended-repeat");
      assert.equal(retry.response.status, 400);
      assert.equal(retry.response.body.error, "duplicate_registration");
      assert.equal(
        (
          await invoke(
            "admin_decide",
            {
              reference: ref,
              decision: "reactivate",
              reason: "إعادة تفعيل إدارية",
            },
            adminToken,
          )
        ).status,
        200,
      );
      assert.equal(
        (await invoke("me", {}, token)).body.review.status,
        "approved",
      );
    },
  );
  await t.test("repeat registration cannot evade review", async () => {
    const r = await register("+201012345602", "repeat");
    assert.equal(r.response.status, 400);
    assert.equal(r.response.body.error, "duplicate_registration");
  });
  await t.test(
    "changing only the student phone cannot evade duplicate review",
    async () => {
      const body = form("+201012345609");
      body.full_name = form("+201012345601").full_name;
      const r = await invoke(
        "submit_registration",
        body,
        undefined,
        "198.51.109.1",
      );
      assert.equal(r.status, 400);
      assert.equal(r.body.error, "duplicate_registration");
    },
  );
  await t.test("concurrent same phone creates one account/code", async () => {
    const a = form("+201012345604"),
      b = form("+201012345604"),
      [x, y] = await Promise.all([
        invoke("submit_registration", a, undefined, "198.51.101.1"),
        invoke("submit_registration", b, undefined, "198.51.101.2"),
      ]);
    assert.deepEqual([x.status, y.status].sort(), [201, 400]);
    assert.equal(
      sql(
        `select count(*) from private.student_registration_requests where student_phone_e164='+201012345604'`,
      ),
      "1",
    );
  });
  if (local) {
    await t.test("Auth failure retries same request safely", async () => {
      const x = await register(
        "+201012345605",
        "authfail",
        "AuthFail2026!",
        "auth_create_error",
      );
      assert.equal(x.response.status, 500);
      delete x.body.test_failpoint;
      const retry = await invoke(
        "submit_registration",
        x.body,
        undefined,
        x.ip,
      );
      assert.equal(retry.status, 201);
      assert.equal(
        sql(
          `select count(distinct assigned_student_code) from private.student_registration_requests where student_phone_e164='+201012345605'`,
        ),
        "1",
      );
    });
    await t.test("post-Auth failure reuses same Auth user", async () => {
      const x = await register(
        "+201012345606",
        "postauth",
        "PostAuth2026!",
        "after_auth_create",
      );
      assert.equal(x.response.status, 500);
      sql(
        `update private.student_registration_requests set provisioning_locked_at=now()-interval '6 minutes' where student_phone_e164='+201012345606'`,
      );
      delete x.body.test_failpoint;
      const retry = await invoke(
        "submit_registration",
        x.body,
        undefined,
        x.ip,
      );
      assert.equal(retry.status, 201);
      assert.equal(
        sql(
          `select count(*) from auth.users where raw_app_meta_data->>'registration_request_id'=(select public_ref::text from private.student_registration_requests where student_phone_e164='+201012345606')`,
        ),
        "1",
      );
    });
  } else {
    await t.test(
      "fault injection",
      {
        skip: "Cloud fault injection is forbidden and covered by local GoTrue CI.",
      },
      () => {},
    );
  }
  await t.test("registration kill switch preserves legacy login", async () => {
    flags({ registration_enabled: false });
    assert.equal(
      (await register("+201012345607", "closed")).response.status,
      503,
    );
    assert.equal((await login(legacyEmail, legacyPass)).status, 200);
  });
  await t.test(
    "legacy account has no deadline and data is unchanged",
    async () => {
      const legacyToken = (await login(legacyEmail, legacyPass)).body
          .access_token,
        me = await invoke(
          "me",
          { test_now: "2035-01-01T00:00:00Z" },
          legacyToken,
        );
      assert.equal(me.body.review.legacy_account, true);
      assert.equal(me.body.review.status, "approved");
      assert.equal(
        sql(
          `select count(*) from private.student_account_reviews where user_id='${legacyId}'`,
        ),
        "0",
      );
      assert.deepEqual(academicFingerprint(), academic);
    },
  );
  await t.test("cron/admin race ends in a valid approved state", async () => {
    flags({ registration_enabled: true });
    const r = await register("+201012345608", "race", "RacePass2026!");
    const ref = sql(
        `select public_ref from private.student_registration_requests where assigned_student_code='${r.response.body.student_code}'`,
      ),
      future = new Date(
        new Date(r.response.body.review_deadline_at).getTime() + 1,
      ).toISOString();
    await Promise.all([
      Promise.resolve().then(() =>
        sql(
          `select private.suspend_expired_student_reviews('${future}'::timestamptz)`,
        ),
      ),
      invoke(
        "admin_decide",
        {
          reference: ref,
          decision: "approved",
          reason: "اعتماد متزامن موثق",
          test_now: future,
        },
        adminToken,
      ),
    ]);
    assert.equal(
      sql(
        `select status from private.student_account_reviews where request_id=(select id from private.student_registration_requests where public_ref='${ref}')`,
      ),
      "approved",
    );
  });
});
