import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const root=new URL("../../",import.meta.url);
const read=p=>readFile(new URL(p,root),"utf8");
const directs=["b2-lesson2-workshop.html","lecture4-workshop.html","lecture5-workshop.html","lecture6-workshop.html","student-ch1-mistakes.html","student-ch2-mistakes.html","lecture1-homework.html","workshop.html"];

test("compiled student dashboard source enforces completion and rechecks on tab return",async()=>{
 const base=await read("student-base.html"), entry=await read("student.html");
 assert.match(base,/data\.enforcement&&data\.profile\?\.is_active/);
 assert.match(base,/Number\(data\.profile\.profile_schema_version\|\|0\)<Number\(data\.required_profile_schema_version\|\|1\)/);
 assert.match(base,/location\.replace\('\.\/student-complete-profile\.html'\)/);
 assert.match(base,/state!=='profile_required'/);
 assert.match(base,/document\.addEventListener\('visibilitychange'/);
 assert.match(base,/window\.addEventListener\('focus'/);
 assert.match(base,/window\.addEventListener\('pageshow'/);
 assert.match(entry,/student-complete-profile\.html/);
});
test("already authenticated students entering public portal get redirected without signing out",async()=>{
 const s=await read("student-access.js");
 assert.match(s,/async function routeExistingSession\(/);
 assert.match(s,/const \{data:\{session\}\}=await sb\.auth\.getSession\(\)/);
 assert.match(s,/state\.enforcement&&state\.profile\?\.is_active/);
 assert.match(s,/location\.replace\("student-complete-profile\.html"\)/);
 assert.match(s,/location\.replace\("student\.html"\)/);
 assert.doesNotMatch(s.slice(s.indexOf("async function routeExistingSession")),/signOut\(/);
});
test("direct workshop deep links run the shared enforcement guard",async()=>{
 const guard=await read("student-profile-gate.js");
 assert.match(guard,/identity\("me"\)/);
 assert.match(guard,/state\.enforcement&&state\.profile\?\.is_active/);
 assert.match(guard,/profile_schema_version/);
 assert.match(guard,/window\.addEventListener\("focus"/);
 assert.match(guard,/document\.addEventListener\("visibilitychange"/);
 assert.match(guard,/redirect\("student-complete-profile\.html"\)/);
 assert.match(guard,/redirect\("student\.html"\)/);
 assert.match(guard,/student-register\.html\?tab=login/);
 for(const path of directs){
   const html=await read(path);
   assert.match(html,/student-profile-gate\.js/,path);
   assert.match(html,/data-yr-profile-pending/,path);
 }
});
test("admin and pending new-account states are not forced into legacy completion flow",async()=>{
 const base=await read("student-base.html"), portal=await read("student-access.js"),guard=await read("student-profile-gate.js");
 assert.match(base,/review_only/);
 assert.match(base,/data\.review&&!data\.review\.legacy_account&&data\.review\.status!=='approved'/);
 assert.match(portal,/state\.review&&!state\.review\.legacy_account&&state\.review\.status!=="approved"/);
 assert.match(guard,/state\.review&&!state\.review\.legacy_account&&state\.review\.status!=="approved"/);
 assert.match(portal,/session\.user\.app_metadata\?\.role==="admin"/);
 assert.match(guard,/session\.user\.app_metadata\?\.role==="admin"/);
});
