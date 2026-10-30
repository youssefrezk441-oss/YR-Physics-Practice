import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {resolveAttemptChapter,splitHistoryByChapter,historyChapterOptions,historyChapterLabel} from "../../student-history-chapters.mjs";

const sets=[
 {slug:"l3-week-two",course_slug:"third-secondary-electricity-chapter-1"},
 {slug:"l1-magnetism",course_slug:"grade3-chapter-2"},
 {slug:"foundations",course_slug:"foundation-physics"}
];
const attempts=[
 {id:"a",slug:"l3-week-two",status:"graded"},
 {id:"b",slug:"l1-magnetism",status:"submitted"},
 {id:"c",slug:"foundations",status:"graded"},
 {id:"d",slug:"legacy-missing-set",title:"اختبار قديم",status:"graded"},
 {id:"e",slug:"l1-magnetism",status:"in_progress"},
 {id:"f",slug:"legacy-ch2",chapter_number:2,status:"graded"},
 {id:"g",slug:"l3-week-two",chapter_number:2,status:"graded"}
];

test("only confirmed metadata or exact verified courses determine the academic chapter",()=>{
 assert.equal(resolveAttemptChapter(attempts[0],sets),"1");
 assert.equal(resolveAttemptChapter(attempts[1],sets),"2");
 assert.equal(resolveAttemptChapter(attempts[2],sets),"foundation");
 assert.equal(resolveAttemptChapter(attempts[3],sets),"unknown");
 assert.equal(resolveAttemptChapter(attempts[5],sets),"2");
 assert.equal(resolveAttemptChapter(attempts[6],sets),"unknown","conflicting evidence must not assign an incorrect chapter");
 assert.equal(resolveAttemptChapter({slug:"unlinked",title:"الفصل الثاني" },sets),"unknown","a title is not authoritative");
 assert.equal(resolveAttemptChapter({slug:"old",course_slug:"second-secondary-baccalaureate-physics"},sets),"unknown","a generic course slug is not chapter evidence");
});

test("completed attempts remain immutable and segregated, with an explicit all option",()=>{
 const before=JSON.stringify(attempts);
 const groups=splitHistoryByChapter(attempts,sets);
 assert.deepEqual([...groups.get("1")].map(x=>x.id),["a"]);
 assert.deepEqual([...groups.get("2")].map(x=>x.id),["b","f"]);
 assert.deepEqual([...groups.get("foundation")].map(x=>x.id),["c"]);
 assert.deepEqual([...groups.get("unknown")].map(x=>x.id),["d","g"]);
 assert.equal([...groups.values()].reduce((s,x)=>s+x.length,0),6);
 assert.equal(JSON.stringify(attempts),before);
 assert.deepEqual(historyChapterOptions(groups),["1","2","foundation","unknown","all"]);
 assert.equal(historyChapterLabel("unknown"),"غير مصنف");
});

test("compiled student UI keeps the original attempt review flow and chapter controls",async()=>{
 const base=await readFile(new URL("../../student-base.html",import.meta.url),"utf8");
 const adapter=await readFile(new URL("../../student-workspace-navigation-v1.js",import.meta.url),"utf8");
 const css=await readFile(new URL("../../student-workspace-navigation-v1.css",import.meta.url),"utf8");
 assert.match(base,/from'\.\/student-history-chapters\.mjs'/);
 assert.match(base,/function renderHistory\(\)/);
 assert.match(base,/data-review-attempt/);
 assert.match(base,/openAttemptReview\(b\.dataset\.reviewAttempt\)/);
 assert.match(base,/yr:history-chapter/);
 assert.match(base,/id='yrHistoryChapterFilter'/);
 assert.match(adapter,/new CustomEvent\("yr:history-chapter"/);
 assert.match(css,/yrHistoryFilterTabs/);
});
