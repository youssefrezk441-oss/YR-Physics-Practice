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
const slug='openLesson2BookHomework';
test('Chapter 2 homework is included in both the legacy launcher and the visible workspace adapter',()=>{
 const sources=nav.slice(nav.indexOf('const availableSources=['),nav.indexOf('];',nav.indexOf('const availableSources=['))+2);
 const ch2=nav.slice(nav.indexOf('}else if(third){'),nav.indexOf('if(ch==="1"&&third)'));
 assert.match(loader,/id="openLesson2BookHomework"/);
 assert.ok(sources.includes('"'+slug+'"'),'new workspace does not watch homework source');
 assert.ok(ch2.includes('["'+slug+'"'),'new workspace does not render homework in Chapter 2');
 assert.match(base,/student-workspace-navigation-v1\.js\?v=20261111-lesson2-workspace/);
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
   if(name==='paper-homework'&&body?.action==='ping')return {data:{ok:true,available:true,workshop:{slug:body.workshop_slug}}};
   if(name==='student-ch2-mistakes'&&body?.action==='ping')return {data:{ok:true,available:true}};
   if(name==='unified-workshop'&&body?.action==='ping')return {data:{ok:true,workshops:[]}};
   return {data:{ok:true}};
  }},
  storage:{from:()=>({getPublicUrl:(key)=>({data:{publicUrl:'/synthetic/'+key}})})}
 }
}`;

test('real browser: 3rd-secondary learner sees and opens Lesson 2 in the NEW Chapter 2 workspace',async()=>{
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
   const page=await browser.newPage({viewport:{width:1280,height:900}});
   const failures=[];
   page.on('pageerror',e=>failures.push(e.message));
   await page.route('https://cdn.jsdelivr.net/**',route=>route.fulfill({status:200,contentType:'text/javascript',body:fakeSupabase}));
   await page.route('https://fonts.googleapis.com/**',route=>route.abort());
   await page.goto('http://127.0.0.1:'+server.address().port+'/student.html'+(legacy?'?legacy_grade=1':''),{waitUntil:'domcontentloaded'});
   await page.locator('#dashboardView').waitFor({state:'visible',timeout:20000});
   await page.locator('[data-yr-go="learning"]:visible').first().click();
   await page.locator('[data-yr-panel="learning"][data-yr-chapter="2"]:visible').first().click();
   const item=page.locator('#yrLearningContent [data-yr-source="openLesson2BookHomework"]');
   await item.waitFor({state:'visible',timeout:16000});
   assert.equal(await item.count(),1);
   assert.match(await item.innerText(),/115 سؤالًا/);
   const originalCard=page.locator('#openLesson2BookHomework');
   assert.equal(await originalCard.evaluate(el=>el.classList.contains('hidden')),false);
   assert.ok(!failures.some(x=>/SyntaxError|is not defined|Cannot access .* before initialization/.test(x)),failures.join('; '));
   await Promise.all([page.waitForURL(/lesson2-book-homework\.html/,{timeout:12000}),item.click()]);
   await page.close();
  }
 }finally{
  if(browser)await browser.close();
  if(server)await new Promise(resolve=>server.close(resolve));
  rmSync(out,{recursive:true,force:true});
 }
});
