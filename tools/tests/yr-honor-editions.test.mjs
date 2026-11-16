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

test("Chapter 2 highlights render ten overall leaders and the two requested star lists",async()=>{
 const html=await read("student-base.html");
 const renderSource=html.match(/function renderHonorHighlights\(g\)\{[\s\S]+?\n\}/)?.[0];
 assert.ok(renderSource);
 const elements=new Map();
 const $=id=>{
  if(!elements.has(id))elements.set(id,{classList:{toggle(_name,hidden){elements.get(id).hidden=hidden}}});
  return elements.get(id);
 };
 const render=runInNewContext(renderSource+"\nrenderHonorHighlights",{
  $,honorTopRows:rows=>rows.length,honorLeaderRows:rows=>rows.length,honorRiserCards:rows=>rows.length
 });
 const group={cycle:{code:"CHAPTER2-2026-G3-01"},top10:Array(12).fill({}),leaders:{quizzes:[{}]},risers:[{}]};
 render(group);
 assert.equal($("honorTop10").innerHTML,12);
 assert.equal($("honorQuizStars").hidden,false);
 assert.equal($("honorQuizLeaders").innerHTML,1);
 assert.equal($("honorRiseStars").hidden,false);
 assert.equal($("honorRisers").innerHTML,1);
 render({...group,cycle:{code:"CHAPTER1-2026-G3-01"},top10:Array(6).fill({})});
 assert.equal($("honorTop10").innerHTML,6);
 assert.equal($("honorQuizStars").hidden,true);
 assert.equal($("honorRiseStars").hidden,true);
});

test("honor endpoint sends the Chapter 2 top ten and uses real quiz participants for stars",async()=>{
 const {stripTypeScriptTypes}=await import("node:module");
 const source=(await read("supabase/functions/student-honor-board/index.ts")).replace(/^import .*;\n/gm,"");
 const entries=Array.from({length:15},(_,i)=>({m:{
  user_id:"synthetic-"+i,full_name:"طالب "+i,group_code:"N3-A",total_sessions:2,readiness_score:100-(i>=2?i-1:i)-(i>=7?-1:0),
  quiz_ratio:i===14?100:i===5?76:80-i,quiz_scored:i===14?0:2,latest_quiz_pct:i<4?([70,69,80,90][i]):null,
  previous_quiz_avg_pct:i===2?80:i===3?0:60,previous_quiz_count:1
 }}));
 let chapter2=true;
 const sql=async(parts)=>{
  const query=parts.join("?");
  if(query.includes("from public.assessment_cycles"))return [{
   id:"cycle",cycle_code:chapter2?"CHAPTER2-2026-G3-01":"CHAPTER1-2026-G3-01",status:"open"
  }];
  if(query.includes("count(*)::int n"))return [{n:0}];
  if(query.includes("private.assessment_cycle_metrics"))return entries;
  throw Error(query);
 };
 const build=runInNewContext(stripTypeScriptTypes(source)+"\nbuild",{
  Deno:{env:{get:()=>undefined},serve(){}},postgres:()=>sql,createClient:()=>({})
 });
 const result=await build("grade3",null,null);
 assert.equal(result.top10.length,12);
 assert.equal(result.top10.at(-1).rank,10);
 assert.deepEqual(Array.from(result.podium,student=>student.rank),[1,2,2,3]);
 assert.equal(result.leaders.quizzes[0].user_id,"synthetic-0");
 assert.deepEqual(Array.from(result.leaders.quizzes,student=>student.rank),[1,2,3,4,5,5]);
 assert.equal(result.risers.length,1);
 assert.equal(result.risers[0].user_id,"synthetic-0");
 chapter2=false;
 const earlier=await build("grade3",null,null);
 assert.equal(earlier.top10.length,6);
 assert.equal(earlier.risers.length,1);
});
