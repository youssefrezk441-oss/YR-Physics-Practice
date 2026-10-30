import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const root=new URL("../../",import.meta.url);
const read=(name)=>readFile(new URL(name,root),"utf8");
test("second-term catalog is behind existing admin authorization",async()=>{
 const fn=await read("supabase/functions/admin-unified-workshop/index.ts");
 const permission=fn.indexOf("const admin = await requireAdmin(req);");
 const catalog=fn.indexOf('if (action === "term2_catalog")');
 const slugGuard=fn.indexOf('if (!slug) throw new WorkshopContractError');
 assert.ok(permission>=0&&catalog>permission&&slugGuard>catalog);
 assert.match(fn,/where slug like '%-term-2-%'/);
 assert.match(fn,/status = 'published'/);
 assert.match(fn,/active_version_id is not null/);
});
test("admin dashboard clearly routes registration reviews and combined analytics",async()=>{
 const home=await read("admin-home.html");
 assert.match(home,/id="registrationPriority"/);
 assert.match(home,/href="admin-student-registrations\.html"/);
 assert.match(home,/href="admin-ch1-workshop-analytics\.html"/);
 assert.match(home,/href="admin-ch2-analytics\.html"/);
 assert.doesNotMatch(home,/id="paperHomeworkAnalyticsCard"/);
 const first=await read("admin-ch1-workshop-analytics.html");
 for(const slug of ["l3","l4","l5","l6"])assert.doesNotMatch(first,new RegExp('href="admin-'+slug+'-workshop-analytics\\.html"'));
});
test("term 2 dashboard supports workshops, homework, and students without direct private table reads",async()=>{
 const html=await read("admin-ch2-analytics.html"),js=await read("admin-ch2-analytics.js");
 assert.match(html,/admin-ch2-analytics\.js/);
 assert.match(js,/term2_catalog/);
 assert.match(js,/admin-unified-workshop/);
 assert.match(js,/paper-homework/);
 assert.match(js,/loadStudents/);
 assert.match(js,/loadQuestions/);
 assert.doesNotMatch(js,/\.from\(['"](?:private\.|homework_submissions|workshop_progress)/);
});
test("individual reports use selected workshop instead of hardcoded lecture 1",async()=>{
 const workshop=await read("admin-workshop-analytics.js"),homework=await read("admin-paper-homework.html");
 assert.match(workshop,/requestedSlug=new URLSearchParams/);
 assert.match(workshop,/loadWorkshopCatalog/);
 assert.match(homework,/workshop_slug:slug/);
});
