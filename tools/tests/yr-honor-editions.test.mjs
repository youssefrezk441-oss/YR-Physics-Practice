import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

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
