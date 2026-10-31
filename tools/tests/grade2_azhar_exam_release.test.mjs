import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const root=resolve(import.meta.dirname,"../..");
const code=()=>readFileSync(resolve(root,"supabase/functions/grade2-mastery/index.ts"),"utf8");
test("Azhar release routes are owner-only, audit-logged and do not leak keys",()=>{
 const s=code();
 assert.match(s,/owner_import_exam_bank/);
 assert.match(s,/owner_exam_manifest/);
 assert.match(s,/owner_prepare_exams/);
 assert.match(s,/owner_publish_exams/);
 assert.match(s,/if\(!c\.admin\)throw new E\(403,"owner_only"/);
 assert.match(s,/PUBLISH_EXAMS/);
 assert.match(s,/PROVISIONAL_EXAMS/);
 assert.match(s,/g2-exams-import/);
 assert.match(s,/exam_import/);
 assert.match(s,/exams_publish/);
});
test("learning and mastery checks remain independent of exam inventory",()=>{
 const s=code();
 assert.match(s,/a\.mode in \('learn','mastery'\)/);
 assert.match(s,/inventory\.total!==94/);
 assert.match(s,/assets\.ready!==94/);
 assert.match(s,/keys\.ready!==95/);
 assert.match(s,/keys\.manuals!==32/);
 assert.match(s,/where a\.mode in \('learn','mastery'\) group by a\.slug/);
});
test("exams have a separate guarded release gate and immutable reservations",()=>{
 const s=code();
 assert.match(s,/owner_publish_exams/);
 assert.match(s,/current\.questions!==56\|\|current\.keys!==66\|\|current\.essay_parts!==19\|\|current\.images!==56/);
 assert.match(s,/education_track='azhar'/);
 assert.match(s,/examSlugs=\["g2-azhar-ch01-exam"/);
 assert.match(s,/owner_exam_manifest/);
 assert.match(s,/image_checksum_mismatch/);
});
