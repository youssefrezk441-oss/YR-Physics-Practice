import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";

const read=(path)=>readFile(new URL("../../"+path,import.meta.url),"utf8");

test("honor edition selector requests a real server cycle ID without locally recalculating ranks",async()=>{
 const html=await read("student-base.html");
 assert.match(html,/async function honorFn\(cycles=\{\}\)/);
 assert.match(html,/body:\{action:'summary',cycles\}/);
 assert.match(html,/function renderHonorCycleSelector\(key\)/);
 assert.match(html,/honorData\?\.available_cycles\?\.\[key\]/);
 assert.match(html,/window\.yrWorkspaceOpenHonorCycle=/);
 assert.match(html,/openHonorView\(key\)/);
 assert.match(html,/id="honorCycleSelector"/);
 assert.doesNotMatch(html,/نسخة الفصل الخاصة به لم تُربط هنا بعد/);
});

test("achievements show only the current student's grade and distinguish frozen rounds",async()=>{
 const adapter=await read("student-workspace-navigation-v1.js");
 assert.match(adapter,/const keys=grade&&all\[grade\]\?\[grade\]:Object\.keys\(all\)/);
 assert.match(adapter,/c\.archived\?"نسخة مؤرشفة وثابتة"/);
 assert.match(adapter,/c\.status==="pending_review"\?"دورة قيد التجهيز — لا يوجد ترتيب معتمد"/);
 assert.match(adapter,/window\.yrWorkspaceLoadHonorCatalog\(\)/);
 assert.match(adapter,/yr:honor-editions-ready/);
 const css=await read("student-workspace-navigation-v1.css");
 assert.match(css,/yrHonorCycleSelector/);
 assert.match(css,/yrEditionButton/);
});

test("chapter two shows all five weights without changing the legacy honor formula",async()=>{
 const weights={assessment_model:"chapter2_sources",quizzes:40,platform:30,attendance:10,homework:10,online_homework:10};
 for(const [file,name] of [["student-base.html","honorFormulaHtml"],["admin-honor.html","formulaHtml"]]){
  const source=await read(file);
  const declaration=source.match(new RegExp("function "+name+"\\(p,cycle\\)\\{[^\\n]+?\\}(?=\\s*function|\\s*$)","m"))?.[0];
  assert.ok(declaration,file);
  const render=runInNewContext(declaration+"\n"+name,{esc:String});
  const chapter2=render("readiness",{weights});
  assert.match(chapter2,/<b>40%<\/b> الكويزات/);
  assert.match(chapter2,/<b>30%<\/b> ورش المنصة/);
  assert.match(chapter2,/<b>10%<\/b> الحضور/);
  assert.match(chapter2,/<b>10%<\/b> واجب الحصة/);
  assert.match(chapter2,/<b>10%<\/b> تسليم واجب المنصة/);
  assert.doesNotMatch(render("readiness",{}),/تسليم واجب المنصة/);
 }
});
