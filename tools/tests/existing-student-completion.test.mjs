import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const root=new URL("../../",import.meta.url);
const read=path=>readFile(new URL(path,root),"utf8");

test("Existing student onboarding retains YR branding and 4-step layout",async()=>{
 const h=await read("student-complete-profile.html");
 for(const item of ["assets/yr-mastery-mark.svg","teacher-youssef-studio-hq-1100.webp","student-profile-completion.js","step-panel","data-step-marker","fixedStudentCode","student-profile-completion.css"])assert.ok(h.includes(item),item);
 assert.equal((h.match(/class="step-panel"/g)||[]).length,4);
 assert.match(h,/id="fixedStudentCode"[^>]*readonly/);
 assert.doesNotMatch(h,/student-register-wizard.js|submit_registration|name="national_id"/);
 for(const id of ["firstName","secondName","thirdName","fourthName","grade","system","location","group","phone","guardian","passwordChangeFields","receipt"])assert.ok(h.includes('id="'+id+'"'),id);
});
test("Password change is optional and requires current password",async()=>{
 const h=await read("student-complete-profile.html");
 const js=await read("student-profile-completion.js");
 assert.match(h,/id="changePassword"/);
 assert.match(js,/change_password/);
 assert.match(js,/current_password/);
 assert.match(js,/new_password_confirm/);
 assert.match(js,/identity\("change_password"/);
 assert.match(js,/identity\("complete_profile_v2"/);
 assert.doesNotMatch(js,/submit_registration|admin\.auth|updateUserById/);
});
test("Dashboard and login gate on server-declared profile version",async()=>{
 const dash=await read("student.html"),login=await read("student-access.js");
 for(const s of [dash,login]){
  assert.match(s,/student-complete-profile\.html/);
  assert.match(s,/status\.enforcement/);
  assert.match(s,/required_profile_schema_version/);
  assert.match(s,/profile_schema_version/);
 }
});
test("Server requires authenticated student and never changes the code",async()=>{
 const src=await read("supabase/functions/student-identity/index.ts");
 const anchor=src.indexOf('if (action === "complete_profile_v2")');
 assert.ok(anchor>=0);
 const segment=src.slice(anchor,src.indexOf('if (action === "change_password")',anchor));
 assert.match(segment,/u\.app_metadata\?\.role !== "student"/);
 assert.match(segment,/profile_update_enabled/);
 assert.match(segment,/privacy_accepted/);
 assert.match(segment,/validateFullName/);
 assert.match(segment,/normalizeEgyptianPhone/);
 assert.match(segment,/student_profile_change_requests/);
 assert.match(segment,/profile_schema_version/);
 assert.doesNotMatch(segment,/set student_code\s*=/i);
 assert.match(src,/admin_profile_change_decide/);
 const sql=await read("supabase/migrations/20261030_student_profile_change_requests.sql");
 assert.match(sql,/revoke all .*anon,authenticated/);
});
test("Admin access uses server-side permission checks",async()=>{
 const h=await read("admin-student-profile-changes.html");
 const server=await read("supabase/functions/student-identity/index.ts");
 const adminHome=await read("admin-home.html");
 assert.match(h,/admin_profile_changes/);
 assert.match(h,/admin_profile_change_decide/);
 assert.match(adminHome,/admin-student-profile-changes\.html/);
 assert.match(server,/adminUser\(req, action !== "admin_list"\)/);
});
