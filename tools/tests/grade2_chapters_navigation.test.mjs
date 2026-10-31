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
 assert.match(js,/sb\.functions\.invoke\("unified-workshop",\{body:\{action:"ping"\}\}\)/);
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
