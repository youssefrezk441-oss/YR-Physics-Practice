import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const root=new URL("../../",import.meta.url);
const read=file=>readFile(new URL(file,root),"utf8");

test("approved YR mark and four-stage journey appear within the actual student dashboard",async()=>{
 const src=await read("student-base.html");
 assert.match(src,/<body class="yrStudentApp">/);
 assert.match(src,/<link rel="stylesheet" href="student-internal-identity-v1.css">/);
 assert.match(src,/src="assets\/yr-mastery-mark\.svg"/);
 assert.match(src,/id="dashboardView" class="hidden"/);
 assert.match(src,/class="hero card yrDashboardHero"/);
 assert.match(src,/class="yrLearningPath"/);
 for(const word of ["افهم","طبّق","تدرّب","أتقن"])assert.ok(src.includes("<span>"+word+"</span>"),word);
 assert.match(src,/role="|aria-label="مراحل رحلة التعلم الأربع"/);
});
test("existing student interactive hooks and auth logic are intact",async()=>{
 const src=await read("student-base.html");
 for(const id of ["themeBtn","userBar","studentName","logoutBtn","dashboardView","welcomeTitle","studentProfileMeta","openTrainings","openIndicators","openHonor","openCommitment","openClassTests","openAssessmentCycle","honorView","practiceView","resultView","reviewView","finishBtn"])
  assert.match(src,new RegExp('id="'+id+'"'),id);
 assert.match(src,/const sb=createClient\(/);
 assert.match(src,/student-profile-gate|reviewStateBeforeLegacyInit/);
 assert.match(src,/student-complete-profile\.html/);
 const boot=await read("student.html");
 assert.match(boot,/fetch\('\.\/student-base\.html/);
 assert.match(boot,/document\.write\(html\)/);
 assert.match(boot,/<div id="studentProfileMeta" class="profilePills"><\/div>/);
});
test("interior navigation is accessible and visual only",async()=>{
 const src=await read("student-base.html");
 const css=await read("student-internal-identity-v1.css");
 for(const id of ["openTrainings","openIndicators","openHonor"]){
   assert.match(src,new RegExp('<button id="'+id+'"[^>]*type="button"'));
 }
 assert.match(css,/\.studentNavCard:focus-visible/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
 assert.match(css,/html\[data-theme="dark"\]/);
 assert.match(css,/@media\(max-width:600px\)/);
 assert.doesNotMatch(css,/(?:display\s*:\s*none\s*!important).*#logoutBtn/);
 assert.doesNotMatch(css,/font-size\s*:\s*0.*studentNavCard h3/);
});
test("shared internal identity sheet includes approved brand tokens and avoids modifying login auth page",async()=>{
 const css=await read("student-internal-identity-v1.css");
 const approved=await read("student-brand-studio-v2.css");
 assert.match(approved,/#075643/i);
 assert.match(css,/#0E5948/i);
 assert.match(css,/#D6A149/i);
 assert.match(css,/#F6F8F3/i);
 assert.match(css,/body\.yrStudentApp/);
 const login=await read("student-register.html");
 assert.doesNotMatch(login,/student-internal-identity-v1.css/);
});

test("critical student links remain reachable after replacing the legacy home cards",async()=>{
 const controller=await read("student-workspace-navigation-v1.js");
 const html=await read("student-base.html");
 for(const id of ["openIndicators","openCompleted","openReferences","openChapterMistakes","openCh2Mistakes"]){
  assert.match(controller,new RegExp('["\\']'+id+'["\\']'),id+" cannot disappear from the navigation adapter");
 }
 assert.match(controller,/function canSecondGrade\(/,"grade-2 references must not be shown as grade-3 content");
 assert.match(controller,/function canThirdGrade\(/);
 assert.match(controller,/progress\.id="yrHomeProgress"/);
 assert.match(controller,/تصفية حسب الفصل غير متاحة بعد/);
 assert.match(html,/student-workspace-navigation-v1\.js/);
});
