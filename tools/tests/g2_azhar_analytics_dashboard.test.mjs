import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {spawnSync} from "node:child_process";
const root=resolve(import.meta.dirname,"../..");
const read=p=>readFileSync(resolve(root,p),"utf8");
test("G2 Azhar analytics JavaScript parses without syntax errors",()=>{
 const file=resolve(root,"admin-g2-azhar-analytics.js");
 const p=spawnSync(process.execPath,["--check",file],{encoding:"utf8"});
 assert.equal(p.status,0,p.stderr||p.stdout);
});
test("G2 Azhar analytics are read-only and require an active owner, never a student",()=>{
 const code=read("supabase/functions/admin-grade2-azhar-analytics/index.ts");
 assert.match(code,/app_metadata\?\.role!=="admin"/);
 assert.match(code,/profile\?\.is_owner===true&&profile\?\.is_active===true/);
 assert.match(code,/body\?\.action!=="snapshot"/);
 assert.match(code,/sg\.education_track='azhar'/);
 assert.match(code,/sg\.grade_level='الصف الثاني الثانوي'/);
 assert.match(code,/a\.status='published'/);
 assert.match(code,/order by e\.attempt_id,e\.bank_id,e\.part_key,e\.revision desc/);
 assert.match(code,/order by d\.created_at desc,d\.id desc limit 1/);
 for(const forbidden of ["service_role","correct_answer","answer_spec","answer_payload,","student_phone","guardian_phone","select * from private.g2_keys"])assert.equal(code.includes(forbidden),false,forbidden);
 assert.doesNotMatch(code,/\b(update|delete|insert)\s+(?:into|from)?\s*private\.g2_/i);
});
test("Azhar history is imported as separate, scoped analytics sources",()=>{
 const source=read("supabase/functions/admin-grade2-azhar-analytics/index.ts");
 const ui=read("admin-g2-azhar-analytics.js"),html=read("admin-g2-azhar-analytics.html");
 assert.match(source,/ts\.slug like 'foundation-%'/);
 assert.match(source,/private\.azhar_exam_name_attempts/);
 assert.match(source,/name-only|name.only|name_only/i);
 assert.match(source,/foundation_attempts:foundationAttempts/);
 assert.match(source,/legacy_exam_attempts:legacyExamAttempts/);
 assert.match(ui,/tab==="foundation"/);
 assert.match(ui,/tab==="legacy"/);
 assert.match(html,/data-tab="foundation"/);
 assert.match(html,/data-tab="legacy"/);
 assert.match(ui,/setInterval\(\(\)=>/);
 assert.match(ui,/60000/);
 assert.match(ui,/document\.addEventListener\("visibilitychange"/);
 assert.match(ui,/source.*\w*foundation|foundation_attempts/);
});

test("Admin UI has real dataset filters and does not mix pending essay with final grades",()=>{
 const ui=read("admin-g2-azhar-analytics.js"),page=read("admin-g2-azhar-analytics.html"),home=read("admin-home.html");
 for(const id of ["group","chapter","kind","activity","search","stats","detail"])assert.ok(page.includes('id="'+id+'"'),id);
 assert.match(ui,/a\.state==="submitted"&&pending===0/);
 assert.match(ui,/e\.awarded_points===null\|\|e\.awarded_points===undefined/);
 assert.match(ui,/function matchParts\(a\)/);
 assert.ok(ui.includes("YR-G2-Azhar-Analytics.csv"));
 assert.match(home,/id="azharAnalyticsCard"/);
 assert.match(home,/\$\('azharAnalyticsCard'\)\.classList\.toggle\('hidden',!ctx\.isOwner\)/);
});
