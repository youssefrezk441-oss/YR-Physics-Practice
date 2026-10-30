import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const root=new URL("../../",import.meta.url);
const read=path=>readFile(new URL(path,root),"utf8");
test("registration and login share one branded student portal",async()=>{
 const html=await read("student-register.html");
 const entry=await read("student.html");
 const client=await read("student-access.js");
 assert.match(html,/مستر يوسف رزق/);
 assert.match(html,/YR <span>PHYSICS<\/span>/);
 assert.ok(html.includes('class="journeyVisual"'));
 assert.match(html,/assets\/teacher-youssef-studio-hq-1100\.webp/);
 assert.match(html,/من الفهم إلى الإتقان/);
 assert.match(html,/id="loginTab"/);
 assert.match(html,/id="registerTab"/);
 assert.match(html,/id="accessLoginForm"/);
 assert.match(html,/id="form"/);
 assert.match(html,/id="turnstileWidget"/);
 assert.match(html,/src="student-register-wizard\.js"/);
 assert.match(html,/src="student-access\.js"/);
 assert.match(html,/href="student-access\.css"/);
 assert.match(html,/href="student-brand-studio-v2\.css"/);
 assert.match(entry,/student-register\.html\?tab=login/);
 assert.match(entry,/if\(!session\?\.user\)/);
 assert.match(client,/signInWithPassword/);
 assert.match(client,/students\.yrphysicspractice\.com/);
 assert.match(client,/location\.replace\("student\.html"\)/);
 for(const phrase of ["الرقم القومي","مش مطلوب","SMS","OTP","غير موثّق"]){
  assert.doesNotMatch(html,new RegExp(phrase),"Student-facing auth page must omit irrelevant internal details");
 }
});
test("unified portal keeps original signup protections",async()=>{
 const form=await read("student-register.html");
 const wizard=await read("student-register-wizard.js");
 assert.match(form,/name="privacy"/);
 assert.match(form,/name="student_phone"/);
 assert.match(form,/name="guardian_phone"/);
 assert.doesNotMatch(form,/name="national_id"/);
 assert.match(wizard,/config\.captcha_required/);
 assert.match(wizard,/payload\.captcha_token = captchaToken/);
 assert.match(wizard,/request_idempotency_key: requestKey/);
 assert.match(wizard,/action: "student_registration"/);
});
