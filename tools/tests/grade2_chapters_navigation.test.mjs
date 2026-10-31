import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const root=resolve(import.meta.dirname,"../..");
const read=p=>readFileSync(resolve(root,p),"utf8");
test("grade 2 has three chapter tabs and keeps other grades unchanged",()=>{
 const nav=read("student-workspace-navigation-v1.js");
 const module=read("student-grade2-learning-v3.js");
 assert.match(nav,/syncGrade2Tabs\(\$\("yrLearnView"\)/);
 assert.match(nav,/if\(second\)\{[\s\S]*renderGrade2Chapter\(\{box,chapter:ch,source\}\)/);
 assert.match(nav,/if\(!second\)\{/);
 assert.match(module,/if\(!second&&third\)third.remove\(\)/);
 for(const title of ["القياس الفيزيائي","الحركة في خط مستقيم","القوة والحركة"])assert.ok(module.includes(title));
});
test("only server-confirmed published workshops have navigation buttons",()=>{
 const js=read("student-grade2-learning-v3.js");
 assert.match(js,/sb\.functions\.invoke\("grade2-mastery",\{body:\{action:"catalog"\}\}\)/);
 assert.match(js,/!slugs\.has\(slug\)/);
 assert.match(js,/slot\.replaceWith\(action/);
 assert.match(js,/if\(error\|\|!data\?\.ok/);
 for(const category of ["learn","mastery","exam","cumulative"])assert.ok(js.includes(category));
});
test("student UI contains no answer-key material or privileged service credentials",()=>{
 const js=read("student-grade2-learning-v3.js");
 for(const forbidden of ["service_role","SUPABASE_SERVICE_ROLE","correct_answer","answer_key","rubric_limits","PILOT_TEACHER_TOKEN"]){
  assert.equal(js.includes(forbidden),false,forbidden);
 }
 assert.match(js,/import \{ sb \} from "\.\/student-identity-api\.js"/);
});
test("existing grade 3 routes and active launchers remain intact",()=>{
 const nav=read("student-workspace-navigation-v1.js");
 for(const id of ["openLecture3Workshop","openLecture4Workshop","openLecture5Workshop","openLecture6Workshop","openUnifiedL1Workshop"])assert.ok(nav.includes(id));
 for(const source of ["openB2Lesson1Workshop","openB2Lesson2Workshop"])assert.ok(read("student-grade2-learning-v3.js").includes(source));
});

test("new grade 2 links use dedicated service and no unpublished exam content",()=>{
 const nav=read("student-grade2-learning-v3.js");
 const client=read("g2-activity.js");
 const review=read("g2-review.js");
 assert.match(nav,/\.\/g2-activity\.html\?workshop=/);
 assert.match(client,/sb\.functions\.invoke\("grade2-mastery"/);
 assert.match(client,/request_id:crypto\.randomUUID\(\)/);
 assert.match(review,/sb\.functions\.invoke\("grade2-mastery"/);
 for(const text of [nav,client,review]){
  for(const bad of ["SUPABASE_SERVICE_ROLE_KEY","private.g2_keys","ANSWER_KEYS_PRIVATE_DO_NOT_PUBLISH"])assert.equal(text.includes(bad),false);
 }
});
test("upcoming grade 2 workshops are visibly named but never open without a published server result",()=>{
 const js=read("student-grade2-learning-v3.js");
 const css=read("student-grade2-learning-v3.css");
 assert.match(js,/function pending\(\{label,explain,count\}\)/);
 assert.match(js,/slot=pending\(\{label,explain,count\}\)/);
 assert.match(js,/!slugs\.has\(slug\)/);
 assert.match(js,/slot\.replaceWith\(action/);
 assert.match(js,/لم تُفتح بعد/);
 for(const label of ["ورشة الفصل — تدريب مفتوح","تدريبات إتقان الفصل","اختبار إتقان الفصل","اختبار الفصول الثلاثة"])assert.ok(js.includes(label));
 for(const count of [24,23,11,15,14,7])assert.match(js,new RegExp("\\b"+count+"\\b"));
 assert.match(css,/\.yrG2Preview\{/);
 assert.match(css,/cursor:default/);
});

test("grade 2 photo importer is owner-only and validates original SHA256",()=>{
 const src=read("supabase/functions/grade2-mastery/index.ts");
 const ui=read("g2-import.js");
 assert.match(src,/owner_upload_question_image/);
 assert.match(src,/if\(!c\.admin\)throw new E\(403,"owner_only"/);
 assert.match(src,/sha!==expected\.image_sha256/);
 assert.match(src,/storage\.from\("g2-question-images"\)\.upload/);
 assert.match(src,/upsert:false/);
 assert.match(ui,/owner_image_manifest/);
 assert.match(ui,/owner_prepare_image_catalog/);
 assert.match(ui,/\/assets\/grade2\//);
 assert.ok(!ui.includes("SUPABASE_SERVICE_ROLE_KEY"));
});

test("owner pilot launch is explicit, cohort scoped, and requires complete source bank",()=>{
 const src=read("supabase/functions/grade2-mastery/index.ts");
 const ui=read("g2-import.js");
 assert.match(src,/owner_group_catalog/);
 assert.match(src,/owner_launch_pilot/);
 assert.match(src,/confirm_provisional!==true/);
 assert.match(src,/inventory\.total!==94\|\|assets\.ready!==94\|\|keys\.ready!==95\|\|keys\.manuals!==32/);
 assert.match(src,/chosen\.some\(g=>!groups\.some/);
 assert.match(src,/provisional_live_pilot=true/);
 assert.match(src,/mode in \('learn','mastery'\)/);
 assert.match(src,/createSignedUrl\(q\.image_path,21600\)/);
 assert.match(ui,/input\[name="g2-cohort":checked\]/);
 assert.match(ui,/confirm_provisional:true/);
 const sql=read("supabase/migrations/20261031152721_g2_allow_explicit_provisional_learning_pilot_20261031.sql");
 assert.match(sql,/provisional_live_pilot/);
});
