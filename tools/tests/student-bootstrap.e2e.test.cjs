const test = require("node:test"),
  assert = require("node:assert/strict"),
  http = require("node:http"),
  fs = require("node:fs"),
  path = require("node:path");
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {}
const root = path.resolve(__dirname, "../..");
function server() {
  return http.createServer((req, res) => {
    const pathname = new URL(req.url, "http://x").pathname,
      file = path.join(
        root,
        pathname === "/" ? "student.html" : pathname.slice(1),
      );
    if (!file.startsWith(root) || !fs.existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.setHeader(
      "Content-Type",
      file.endsWith(".html")
        ? "text/html; charset=utf-8"
        : file.endsWith(".js")
          ? "text/javascript; charset=utf-8"
          : file.endsWith(".css")
            ? "text/css"
            : "application/octet-stream",
    );
    res.end(fs.readFileSync(file));
  });
}
const mockModule = `export function createClient(){return{auth:{getSession:async()=>({data:{session:null}}),signInWithPassword:async p=>{window.__loginPayload=p;return{error:{message:'mock stop'}}},signOut:async()=>({})},functions:{invoke:async(name,{body}={})=>name==='student-identity'&&body?.action==='config'?{data:{ok:true,registration_enabled:true,phone_login_enabled:false,profile_update_enabled:false,profile_enforcement_enabled:false}}:{data:{},error:null}}}}`;
const profileMockModule = `export function createClient(){return{auth:{getSession:async()=>({data:{session:{user:{id:'synthetic',app_metadata:{role:'student'}}}}})},functions:{invoke:async(name,{body}={})=>{if(body?.action==='me')return{data:{ok:true,national_id_collection_enabled:false,privacy_notice_version:'draft-v1',profile:{full_name:'طالب تجريبي كامل',student_code:'N2-001',grade_level:'الصف الثاني الثانوي',group_code:'N2-A',student_phone:'+201012345678',guardian_phone:'+201112345678',birth_date:'2008-01-02',national_id_last4:'1234'}}};if(body?.action==='complete_profile'){window.__profilePayload=body;return{data:{ok:true,message:'saved'}}}return{data:{ok:true}}}}}}`;
const registrationMockModule = `export function createClient(){return{auth:{getSession:async()=>({data:{session:null}})},functions:{invoke:async(name,{body}={})=>{if(body?.action==='config')return{data:{ok:true,registration_enabled:true,privacy_notice_version:'v1-2026-10-30',groups:[{group_code:'N2-A',grade_level:'الصف الثاني الثانوي',center_name:'ذا فرست - ناهيا'}]}};if(body?.action==='submit_registration'){window.__registrationPayload=body;return{data:{ok:true,student_code:'N2-777',status:'pending_review',review_deadline_at:'2030-01-03T00:00:00Z',message:'تم إنشاء حسابك بنجاح.'}}}return{data:{ok:true}}}}}}`;
const adminMockModule = `export function createClient(){return{auth:{getSession:async()=>({data:{session:{user:{id:'admin',app_metadata:{role:'admin'}}}}})},functions:{invoke:async(name,{body}={})=>{if(body?.action==='admin_list')return{data:{ok:true,requests:[{public_ref:'11111111-1111-1111-1111-111111111111',assigned_student_code:'N2-777',full_name:'طالب تجريبي كامل',grade_level:'الصف الثاني الثانوي',education_system:'عام',requested_group_code:'N2-A',assigned_group_code:'N2-A',student_phone_e164:'+201012345678',created_at:'2030-01-01T00:00:00Z',account_status:'pending_review',review_deadline_at:'2030-01-03T00:00:00Z',duplicate_review:{}}],recovery_requests:[]}};if(body?.action==='admin_decide'){window.__decisionPayload=body;return{data:{ok:true,status:body.decision}}}return{data:{ok:true}}}}}}`;
test(
  "student bootstrap renders legacy dashboard and resilient account UI",
  { skip: !chromium },
  async () => {
    const s = server();
    await new Promise((r) => s.listen(0, "127.0.0.1", r));
    const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      args: ["--no-sandbox"],
    });
    try {
      const p = await browser.newPage();
      await p.route("https://cdn.jsdelivr.net/**", (r) =>
        r.fulfill({
          status: 200,
          contentType: "text/javascript",
          body: mockModule,
        }),
      );
      await p.goto(`http://127.0.0.1:${s.address().port}/student.html`);
      await p.waitForSelector("#studentCode");
      assert.ok(await p.locator("#dashboardView").count());
      assert.ok(await p.locator('a[href="student-register.html"]').count());
      await p.fill("#studentCode", "N3-001");
      await p.fill("#studentPassword", "Example1234");
      await p.click("#loginBtn");
      await p.waitForTimeout(50);
      assert.deepEqual(await p.evaluate(() => window.__loginPayload), {
        email: "n3-001@students.yrphysicspractice.com",
        password: "Example1234",
      });
      assert.equal(await p.locator(".err").count(), 1);
    } finally {
      await browser.close();
      s.close();
    }
  },
);
test(
  "legacy profile shows server birth date and submits contact data without implicit identity consent",
  { skip: !chromium },
  async () => {
    const s = server();
    await new Promise((r) => s.listen(0, "127.0.0.1", r));
    const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      args: ["--no-sandbox"],
    });
    try {
      const p = await browser.newPage();
      await p.route("https://cdn.jsdelivr.net/**", (r) =>
        r.fulfill({
          status: 200,
          contentType: "text/javascript",
          body: profileMockModule,
        }),
      );
      await p.goto(
        `http://127.0.0.1:${s.address().port}/student-profile-update.html`,
      );
      await p.waitForSelector("#current b");
      const current = await p.locator("#current").textContent();
      assert.match(current, /تاريخ الميلاد المستخرج/);
      assert.doesNotMatch(current, /تاريخ الميلاد المستخرج:\s*غير مسجل/);
      assert.equal(await p.locator("#identityCollection.hidden").count(), 1);
      await p.selectOption('[name="attendance_location"]', "ناهيا");
      await p.fill('[name="residence_area"]', "منطقة تجريبية");
      await p.click("#form button");
      await p.waitForTimeout(50);
      const payload = await p.evaluate(() => window.__profilePayload);
      assert.equal(payload.national_id, "");
      assert.equal(payload.privacy_accepted, false);
      assert.equal(payload.privacy_notice_version, "draft-v1");
    } finally {
      await browser.close();
      s.close();
    }
  },
);
test(
  "immediate registration chooses password and displays code without echoing password",
  { skip: !chromium },
  async () => {
    const s = server();
    await new Promise((r) => s.listen(0, "127.0.0.1", r));
    const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      args: ["--no-sandbox"],
    });
    try {
      const p = await browser.newPage();
      await p.route("https://cdn.jsdelivr.net/**", (r) =>
        r.fulfill({
          status: 200,
          contentType: "text/javascript",
          body: registrationMockModule,
        }),
      );
      await p.goto(
        `http://127.0.0.1:${s.address().port}/student-register.html`,
      );
      await p.waitForSelector('#next:not([disabled])');
      assert.equal(await p.locator('[name="national_id"]').count(), 0);
      await p.fill('[name="first_name"]', "طالب");
      await p.fill('[name="second_name"]', "تجريبي");
      await p.fill('[name="third_name"]', "كامل");
      await p.fill('[name="fourth_name"]', "جديد");
      await p.click("#next");
      await p.selectOption('[name="grade_level"]', "الصف الثاني الثانوي");
      await p.selectOption('[name="education_system"]', "عام");
      await p.selectOption('[name="attendance_location"]', "ناهيا");
      await p.waitForSelector('option[value="N2-A"]', { state: "attached" });
      await p.selectOption('[name="group_code"]', "N2-A");
      await p.fill('[name="residence_area"]', "منطقة تجريبية");
      await p.click("#next");
      await p.fill('[name="student_phone"]', "01012345678");
      await p.fill('[name="guardian_phone"]', "01112345678");
      await p.fill('[name="password"]', "StudentPass2026!");
      await p.fill('[name="password_confirm"]', "StudentPass2026!");
      await p.click("#next");
      await p.check('[name="privacy"]');
      await p.click('button[type="submit"]');
      await p.waitForSelector("#receipt:not(.hidden)");
      assert.equal(await p.locator("#studentCode").textContent(), "N2-777");
      assert.equal(
        (await p.locator("#receipt").textContent()).includes(
          "StudentPass2026!",
        ),
        false,
      );
      const payload = await p.evaluate(() => window.__registrationPayload);
      assert.equal(payload.password, "StudentPass2026!");
      assert.equal(payload.password_confirm, "StudentPass2026!");
      assert.equal(payload.national_id, undefined);
    } finally {
      await browser.close();
      s.close();
    }
  },
);
test(
  "admin review keeps credentials unchanged and sends an audited decision reason",
  { skip: !chromium },
  async () => {
    const s = server();
    await new Promise((r) => s.listen(0, "127.0.0.1", r));
    const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      args: ["--no-sandbox"],
    });
    try {
      const p = await browser.newPage();
      await p.route("https://cdn.jsdelivr.net/**", (r) =>
        r.fulfill({
          status: 200,
          contentType: "text/javascript",
          body: adminMockModule,
        }),
      );
      await p.goto(
        `http://127.0.0.1:${s.address().port}/admin-student-registrations.html`,
      );
      await p.waitForSelector("[data-ref]");
      assert.match(await p.locator("tbody#rows").textContent(), /N2-777/);
      await p.click("[data-ref]");
      await p.fill('[name="reason"]', "اعتماد تجريبي موثق بالكامل");
      await p.click("#decisionForm button");
      await p.waitForTimeout(50);
      const payload = await p.evaluate(() => window.__decisionPayload);
      assert.equal(payload.decision, "approved");
      assert.equal(payload.reference, "11111111-1111-1111-1111-111111111111");
      assert.ok(payload.reason.length >= 8);
    } finally {
      await browser.close();
      s.close();
    }
  },
);
