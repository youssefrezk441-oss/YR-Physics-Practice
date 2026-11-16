import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, extname, sep } from 'node:path';
import { createServer } from 'node:http';
import { chromium } from 'playwright';

// Exercise the actual publish-time compiled student dashboard and the REAL
// student-workspace-navigation-v1.js. Supabase is stubbed ONLY for this local browser.
// No production user credentials, databases, network mutations, or live accounts.
const root=resolve(process.cwd());
const nav=readFileSync(join(root,'student-workspace-navigation-v1.js'),'utf8');
const loader=readFileSync(join(root,'student.html'),'utf8');
const base=readFileSync(join(root,'student-base.html'),'utf8');
const groups={
 workshops:[
  ['openUnifiedL1Workshop','/workshop.html?workshop=third-secondary-term-2-lecture-1'],
  ['openCh2Lecture5Workshop','/workshop.html?workshop=third-secondary-term-2-lecture-5'],
  ['openLesson1Review35','/workshop.html?workshop=third-secondary-term-2-lesson-1-review-35']
 ],
 homework:[
  ['openLecture1Homework','/lecture1-homework.html'],
  ['openBookRemainder','/lesson1-book-remaining.html'],
  ['openLesson2BookHomework','/lesson2-book-homework.html'],
  ['openLecture5BookHomework','/lecture5-book-homework.html']
 ]
};
test('Chapter 2 activities use the existing eligible launchers',()=>{
 const sources=nav.slice(nav.indexOf('const availableSources=['),nav.indexOf('];',nav.indexOf('const availableSources=['))+2);
 for(const [id] of Object.values(groups).flat()){
  assert.ok(loader.replaceAll('\\"','"').includes(`id="${id}"`),`missing launcher ${id}`);
  assert.ok(sources.includes('"'+id+'"'),`the workspace does not watch ${id}`);
 }
 assert.match(base,/student-workspace-navigation-v1\.js\?v=\d{8}-[a-z0-9-]+/);
});

const fakeSupabase=String.raw`export function createClient(){
 const grade=new URL(globalThis.location.href).searchParams.has('legacy_grade')?'3 ثانوي':'الصف الثالث الثانوي';
 const profile={full_name:'طالب تجربة',student_code:'SYN-L2-001',grade_level:grade,group_code:'N3-A',center_name:'ناهيا'};
 return {
  auth:{
   getSession:async()=>({data:{session:{user:{id:'synthetic-only',app_metadata:{role:'student'}}}}}),
   signOut:async()=>({error:null})
  },
  functions:{invoke:async(name,{body}={})=>{
   if(name==='student-practice'){
    if(body?.action==='ping')return {data:{profile}};
    if(body?.action==='list_sets')return {data:{sets:[]}};
    if(body?.action==='history')return {data:{attempts:[]}};
   }
   if(name==='student-identity'&&body?.action==='me')return {data:{ok:true,enforcement:false,review:{status:'approved',legacy_account:true},profile:{is_active:true,profile_schema_version:1},required_profile_schema_version:1}};
   if(name==='student-identity'&&body?.action==='config')return {data:{ok:true,registration_enabled:true,profile_enforcement_enabled:false,profile_update_enabled:true}};
   if(name==='paper-homework'&&body?.action==='ping'){
    const pending=body.workshop_slug==='third-secondary-term-2-lecture-5-book-homework'&&new URL(location.href).searchParams.has('pending_homework');
    return {data:{ok:!pending,available:!pending,workshop:{slug:body.workshop_slug}}};
   }
   if(name==='student-honor-board'&&body?.cycles?.grade3==='CHAPTER2-2026-G3-01'){
    const cycle={id:'synthetic-cycle',code:'CHAPTER2-2026-G3-01',title:'الفصل الثاني',status:'open'};
    const top10=Array.from({length:12},(_,i)=>({rank:i<2?i+1:i===2?2:Math.min(10,i),full_name:'طالب '+i,overall:i===2?99:i===11?90:100-i}));
    return {data:{profile:{grade_key:'grade3'},available_cycles:{grade3:[cycle]},grades:{grade3:{
      cycle,label:'الصف الثالث الثانوي',phase:'readiness',top10,podium:top10.slice(0,4),leaders:{quizzes:[{...top10[1],rank:1},{...top10[2],rank:1}]},
      risers:[{...top10[1],rank:1,improvement:10,latest_test:80,previous_average:70}],
      personal:{eligible:false,quiz_possible:40,quiz_earned:18,completed_sets:1,available_sets:2,
        online_homework_submitted:1,online_homework_counted:3,platform_score:40,homework_score:null,
        progress:{attendance:{present:0,total:0},classroom_homework:{total:1,pending:1},quizzes:{taken:1,pending:1}}}
    }}}};
   }
   if(name==='student-ch2-mistakes'&&body?.action==='ping')return {data:{ok:true,available:true}};
   if(name==='unified-workshop'&&body?.action==='ping')return {data:{ok:true,workshops:[
    {slug:'third-secondary-term-2-lecture-1'},
    {slug:'third-secondary-term-2-lecture-5'},
    {slug:'third-secondary-term-2-lesson-1-review-35'}
   ]}};
   return {data:{ok:true}};
  }},
  storage:{from:()=>({getPublicUrl:(key)=>({data:{publicUrl:'/synthetic/'+key}})})}
 }
}`;

test('real browser: Chapter 2 groups the eligible activities and opens their original pages',async()=>{
 const out=mkdtempSync(join(tmpdir(),'yr-lesson2-workspace-'));
 let server,browser;
 try{
  execFileSync(process.execPath,['tools/build_pages_artifact.mjs',out],{cwd:root,stdio:'pipe',timeout:60000});
  assert.ok(existsSync(join(out,'student.html')));
  server=createServer((req,res)=>{
   const u=new URL(req.url||'/','http://127.0.0.1');
   const pathname=decodeURIComponent(u.pathname);
   const file=resolve(out,'.'+pathname);
   if(!file.startsWith(out+sep)||!existsSync(file)){res.writeHead(404).end('not found');return}
   const ext=extname(file);
   const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webp':'image/webp','.jpg':'image/jpeg'};
   res.writeHead(200,{'content-type':types[ext]||'application/octet-stream','cache-control':'no-store'});
   res.end(readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||chromium.executablePath(),args:['--no-sandbox']});
  for(const legacy of [false,true]){
   const page=await browser.newPage({viewport:legacy?{width:390,height:844}:{width:1280,height:900}});
   const failures=[];
   page.on('pageerror',e=>failures.push(e.message));
   await page.route('https://cdn.jsdelivr.net/**',route=>route.fulfill({
    status:200,contentType:'text/javascript',
    body:route.request().url().endsWith('/supabase.min.js')
     ?fakeSupabase.replace('export function createClient','window.supabase={createClient}; function createClient')
     :fakeSupabase
   }));
   await page.route('https://fonts.googleapis.com/**',route=>route.abort());
   const origin='http://127.0.0.1:'+server.address().port;
   const enterChapter=async(pending=false)=>{
    const query=new URLSearchParams();
    if(legacy)query.set('legacy_grade','1');
    if(pending)query.set('pending_homework','1');
    await page.goto(origin+'/student.html?'+query,{waitUntil:'domcontentloaded'});
    await page.locator('#dashboardView').waitFor({state:'visible',timeout:20000});
    await page.locator('[data-yr-go="learning"]:visible').first().click();
    await page.locator('[data-yr-panel="learning"][data-yr-chapter="2"]:visible').first().click();
   };
   await enterChapter();
   const chapter=page.locator('#yrLearningContent');
   await chapter.locator('summary', {hasText:'واجبات الفصل الثاني'}).waitFor({state:'visible',timeout:6000});
   assert.deepEqual(await chapter.locator('summary strong').allTextContents(),['ورش الفصل الثاني','واجبات الفصل الثاني']);
   assert.equal(await chapter.locator('[data-yr-source]:visible').count(),0);
   for(const [group,entries] of Object.entries(groups)){
    const disclosure=chapter.locator(`details[data-yr-chapter-group="${group}"]`);
    const summary=disclosure.locator('summary');
    await summary.press('Enter');
    assert.deepEqual(await disclosure.locator('[data-yr-source]:visible').evaluateAll(items=>items.map(item=>item.dataset.yrSource)),entries.map(([id])=>id));
    if(group==='homework')assert.match(await disclosure.locator('[data-yr-source="openLesson2BookHomework"]').innerText(),/115 سؤالًا/);
    await summary.press('Enter');
    assert.equal(await disclosure.locator('[data-yr-source]:visible').count(),0);
    for(const [id,path] of entries){
     const isLastRoute=group==='homework'&&id==='openLecture5BookHomework';
     await summary.click();
     await Promise.all([page.waitForURL(origin+path,{timeout:12000}),disclosure.locator(`[data-yr-source="${id}"]`).click()]);
     if(!isLastRoute)await enterChapter();
    }
   }
   await enterChapter();
   const workshopGroup=chapter.locator('details[data-yr-chapter-group="workshops"]');
   await workshopGroup.locator('summary').click();
   await workshopGroup.getByRole('button',{name:/لوحة شرف الفصل الثاني/}).click();
   await page.locator('#honorQuizStars').waitFor({state:'visible'});
   assert.equal(await page.locator('#honorTop10 .honorRankNum').count(),10);
   assert.equal(await page.locator('#honorTop10 .honorTopRow[data-place="10"]').count(),2);
   assert.equal(await page.locator('#honorPodium [data-place="2"] .podiumMember').count(),2);
   assert.equal(await page.locator('#honorQuizLeaders .honorLeaderRow[data-place="1"]').count(),2);
   assert.equal(await page.locator('#honorQuizLeaders .honorLeaderNo').count(),1);
   assert.equal(await page.locator('#honorRisers .honorRiser').count(),1);
   const personal=page.locator('#honorPersonalWrap');
   assert.match(await personal.innerText(),/كمّل 1 من الورش/);
   assert.match(await personal.innerText(),/سلّم 2 من الواجبات/);
   assert.match(await personal.innerText(),/18 من 40 درجة/);
   assert.match(await personal.innerText(),/درجات الكويزات لسه مستنية التسجيل/);
   await personal.getByRole('button',{name:'افتح الواجبات'}).click();
   await chapter.locator('details[data-yr-chapter-group="homework"][open]').waitFor({state:'visible'});
   assert.equal(await chapter.locator('details[data-yr-chapter-group="workshops"][open]').count(),1);
   await workshopGroup.getByRole('button',{name:/لوحة شرف الفصل الثاني/}).click();
   await personal.getByRole('button',{name:'افتح الورش'}).click();
   await chapter.locator('details[data-yr-chapter-group="workshops"][open]').waitFor({state:'visible'});
   await enterChapter(true);
   const homework=chapter.locator('details[data-yr-chapter-group="homework"]');
   await homework.locator('summary').click();
   await homework.locator('[data-yr-source="openLesson2BookHomework"]').waitFor({state:'visible'});
   assert.equal(await homework.locator('[data-yr-source="openLecture5BookHomework"]').count(),0);
   assert.ok(!failures.some(x=>/SyntaxError|is not defined|Cannot access .* before initialization/.test(x)),failures.join('; '));
   await page.close();
  }
 }finally{
  if(browser)await browser.close();
  if(server)await new Promise(resolve=>server.close(resolve));
  rmSync(out,{recursive:true,force:true});
 }
});
