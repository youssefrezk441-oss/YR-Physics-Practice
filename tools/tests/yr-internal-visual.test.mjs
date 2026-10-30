import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {chromium} from "playwright";
const dir=path.resolve(process.cwd(),"_site_identity");
const mockSupabase=String.raw`export function createClient(){return{
 auth:{getSession:async()=>({data:{session:{user:{id:'visual-demo',app_metadata:{role:'student'}}}}}),signOut:async()=>({error:null})},
 functions:{invoke:async(name,{body}={})=>{
  if(name==='student-identity'&&body?.action==='config')return{data:{ok:true,registration_enabled:true,profile_enforcement_enabled:true,profile_update_enabled:true}};
  if(name==='student-identity'&&body?.action==='me')return{data:{ok:true,review:{status:'approved',legacy_account:false},profile:{is_active:true,profile_schema_version:1},required_profile_schema_version:1,enforcement:true}};
  if(name==='student-practice'&&body?.action==='ping')return{data:{profile:{full_name:'طالب تجريبي',student_code:'N3-TEST',grade_level:'الصف الثالث الثانوي',group_code:'N3-A',center_name:'ناهيا'}}};
  if(name==='student-practice'&&body?.action==='list_sets')return{data:{sets:[]}};
  if(name==='student-practice'&&body?.action==='history')return{data:{attempts:[]}};
  if(name==='student-honor-board'){
   const selected=body?.cycles?.grade3||'g3-live';
   return{data:{
    ok:true,profile:{role:'student',grade_key:'grade3'},generated_at:'2026-10-30T12:00:00Z',
    available_cycles:{grade3:[
     {id:'g3-live',code:'CHAPTER1-2026-G3-01',title:'الفصل الأول — رحلة التقييم',status:'open',archived:false},
     {id:'g3-new',code:'CHAPTER2-2026-G3-01',title:'الفصل الثاني — رحلة التقييم',status:'pending_review',archived:false},
     {id:'g3-frozen',code:'FOUNDATION-2026-G3-01',title:'الدورة التأسيسية',status:'pending_review',archived:true}],
     grade2:[{id:'g2-other',title:'جولة غير خاصة بحسابي',archived:true}],grade2_azhar:[]},
    grades:{grade3:{key:'grade3',label:'الصف الثالث الثانوي',phase:'readiness',
      cycle:{id:selected,code:selected==='g3-new'?'CHAPTER2-2026-G3-01':selected==='g3-frozen'?'FOUNDATION-2026-G3-01':'CHAPTER1-2026-G3-01',
      title:selected==='g3-new'?'الفصل الثاني':selected==='g3-frozen'?'الدورة التأسيسية':'الفصل الأول',
      status:selected==='g3-new'?'pending_review':'open',archived:selected==='g3-frozen'},
      stats:{students:0,eligible:0},challenge:'اختبار جولة تجريبية',
      podium:[],top10:[],risers:[],leaders:{},awards:{},groups:[],personal:null}}
   }};
  }
  return{data:{ok:true}};
 }}
}}`;
function serve(){
 return http.createServer((req,res)=>{
  const file=path.resolve(dir,decodeURIComponent(new URL(req.url,"http://127.0.0.1").pathname).slice(1)||"student.html");
  if(!file.startsWith(dir+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return}
  const ext=path.extname(file);
  res.writeHead(200,{"content-type":ext===".html"?"text/html; charset=utf-8":ext===".css"?"text/css; charset=utf-8":(ext===".js"||ext===".mjs")?"text/javascript; charset=utf-8":ext===".svg"?"image/svg+xml":ext===".webp"?"image/webp":"application/octet-stream"});
  res.end(fs.readFileSync(file));
 });
}
test("real compiled YR dashboard renders without horizontal overflow in light and dark modes",{skip:!fs.existsSync(dir)},async()=>{
 const s=serve();
 await new Promise(resolve=>s.listen(0,"127.0.0.1",resolve));
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||chromium.executablePath(),args:["--no-sandbox"]});
 try{
  fs.mkdirSync("yr-internal-previews",{recursive:true});
  for(const [width,height] of [[1440,900],[768,950],[390,844],[320,800]]){
   const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
   await page.route("https://cdn.jsdelivr.net/**",route=>route.fulfill({status:200,contentType:"text/javascript",body:mockSupabase}));
   await page.route("https://fonts.googleapis.com/**",route=>route.abort());
   await page.goto("http://127.0.0.1:"+s.address().port+"/student.html",{waitUntil:"domcontentloaded"});
   await page.locator("#dashboardView").waitFor({state:"visible",timeout:18000});
   for(const theme of ["light","dark"]){
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    const dimensions=await page.evaluate(()=>({
     viewport:document.documentElement.clientWidth,
     scroll:document.documentElement.scrollWidth,
     logo:document.querySelector(".yrInternalBrand img")?.getBoundingClientRect().width,
     navItems:document.querySelectorAll(".yrWorkspaceSidebar [data-yr-go]").length,
     workspaceWidth:document.querySelector("#yrWorkspaceContent")?.getBoundingClientRect().width,
     hello:document.querySelector("#welcomeTitle")?.textContent
    }));
    assert.ok(dimensions.logo>30,"YR mark missing at "+width+"/"+theme);
    assert.equal(dimensions.navItems,5,"all approved workspace destinations must exist");
    assert.ok(dimensions.workspaceWidth>240,"workspace text area too narrow at "+width+"/"+theme);
    assert.ok(dimensions.scroll<=dimensions.viewport+2,
      "horizontal overflow at "+width+"/"+theme+" "+JSON.stringify(dimensions));
    assert.match(dimensions.hello,/طالب تجريبي/);
    if([1440,390].includes(width))await page.screenshot({path:"yr-internal-previews/dashboard-"+width+"-"+theme+".png",fullPage:true});
    if(theme==="light"&&width===1440){
     await page.locator('.yrWorkspaceSidebar [data-yr-go="learning"]').click();
     await page.screenshot({path:"yr-internal-previews/learning-1440-light.png",fullPage:true});
     await page.locator('.yrWorkspaceSidebar [data-yr-go="home"]').click();
    }
    if(theme==="light"&&width===390){
     await page.locator('.yrMobileNav [data-yr-go="review"]').click();
     await page.locator('#yrReviewView [data-yr-chapter="2"]').click();
     await page.screenshot({path:"yr-internal-previews/review-390-light.png",fullPage:true});
     await page.locator('.yrMobileNav [data-yr-go="home"]').click();
    }
   }
   await page.close();
  }
 }finally{await browser.close();await new Promise(resolve=>s.close(resolve))}
});

test("student workspace routes separate chapter-specific learning and review with mobile focus mode",{skip:!fs.existsSync(dir)},async()=>{
 const server=serve();await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||chromium.executablePath(),args:["--no-sandbox"]});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.route("https://cdn.jsdelivr.net/**",route=>route.fulfill({status:200,contentType:"text/javascript",body:mockSupabase}));
  await page.route("https://fonts.googleapis.com/**",route=>route.abort());
  await page.goto("http://127.0.0.1:"+server.address().port+"/student.html",{waitUntil:"domcontentloaded"});
  await page.locator("#dashboardView").waitFor({state:"visible",timeout:18000});
  await page.waitForSelector(".yrWorkspaceReady");
  assert.equal(await page.locator(".yrMobileNav").isVisible(),true);
  await page.locator('.yrMobileNav [data-yr-go="learning"]').click();
  assert.equal(await page.locator("#yrLearnView").isVisible(),true);
  assert.equal(await page.locator('#yrLearnView [data-yr-chapter="1"]').getAttribute("aria-selected"),"true");
  await page.locator('#yrLearnView [data-yr-chapter="2"]').click();
  assert.equal(await page.locator('#yrLearnView [data-yr-chapter="2"]').getAttribute("aria-selected"),"true");
  assert.equal(await page.locator("#yrLearnView #openChapterMistakes").count(),0,"mistake launchers never appear inside learning list");
  await page.locator('.yrMobileNav [data-yr-go="review"]').click();
  assert.equal(await page.locator("#yrReviewView").isVisible(),true);
  assert.match(await page.locator("#yrReviewView").textContent(),/الفصل الأول/);
  await page.locator('#yrReviewView [data-yr-chapter="2"]').click();
  assert.match(await page.locator("#yrReviewView").textContent(),/الفصل الثاني/);
  await page.locator('.yrMobileNav [data-yr-go="more"]').click();
  assert.equal(await page.locator("#yrMobileMore").isVisible(),true);
  await page.locator('#yrMobileMore [data-yr-go="achievements"]').click();
  assert.equal(await page.locator("#yrAchievementsView").isVisible(),true);
  await page.locator("#yrAchievementCycles .yrEditionButton").first().waitFor({state:"visible",timeout:5000});
  assert.equal(await page.locator("#yrAchievementCycles .yrEditionButton").count(),3,"show only the authenticated student's grade");
  assert.match(await page.locator("#yrAchievementCycles").textContent(),/نسخة مؤرشفة وثابتة/);
  assert.doesNotMatch(await page.locator("#yrAchievementCycles").textContent(),/جولة غير خاصة بحسابي/);
  assert.match(await page.locator("#yrAchievementCycles").textContent(),/دورة قيد التجهيز/);
  await page.locator('#yrAchievementCycles .yrEditionButton').filter({hasText:'الفصل الثاني'}).click();
  await page.locator('#honorCycleSelector [data-cycle-id="g3-new"]').waitFor({state:'visible',timeout:10000});
  assert.equal(await page.locator('#honorCycleSelector [data-cycle-id="g3-new"]').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('#honorPendingNotice').isVisible(),true);
  assert.equal(await page.locator('#honorPodium').isVisible(),false,"never publish an unverified chapter-two podium");
  assert.match(await page.locator('#honorPendingNotice').textContent(),/لن نعرض مراكز أو نسبًا غير مكتملة/);
  await page.locator('#honorCycleSelector [data-cycle-id="g3-frozen"]').click();
  await page.locator('#honorCycleSelector [data-cycle-id="g3-frozen"]').waitFor({state:'visible',timeout:10000});
  assert.equal(await page.locator('#honorCycleSelector [data-cycle-id="g3-frozen"]').getAttribute("aria-pressed"),"true",
   "frozen edition selector must match the backend cycle actually loaded");
  assert.match(await page.locator("#honorCycleSelector").textContent(),/نسخة مؤرشفة/);
  await page.evaluate(()=>window.yrWorkspaceShowOnly("practiceView"));
  assert.equal(await page.locator(".yrMobileNav").isVisible(),false,"question focus must hide mobile nav");
  await page.close();
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
});

test("grade-two learning stays available without a fabricated chapter assignment",{skip:!fs.existsSync(dir)},async()=>{
 const server=serve();await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||chromium.executablePath(),args:["--no-sandbox"]});
 try{
  const b2Mock=mockSupabase.replace("student_code:'N3-TEST',grade_level:'الصف الثالث الثانوي',group_code:'N3-A'",
  "student_code:'N2-TEST',grade_level:'الصف الثاني الثانوي',group_code:'N2-A'");
  assert.notEqual(b2Mock,mockSupabase,"test setup must actually switch the student grade");
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.route("https://cdn.jsdelivr.net/**",route=>route.fulfill({status:200,contentType:"text/javascript",body:b2Mock}));
  await page.route("https://fonts.googleapis.com/**",route=>route.abort());
  await page.goto("http://127.0.0.1:"+server.address().port+"/student.html",{waitUntil:"domcontentloaded"});
  await page.locator("#dashboardView").waitFor({state:"visible",timeout:18000});
  await page.locator('.yrMobileNav [data-yr-go="learning"]').click();
  await page.waitForFunction(()=>document.querySelector("#yrLearnView .yrChapterTabs")?.classList.contains("hidden"));
  assert.equal(await page.locator("#yrLearnView .yrChapterTabs").isVisible(),false);
  assert.match(await page.locator("#yrLearnView").textContent(),/تصنيفها إلى فصول مؤجل/);
  assert.doesNotMatch(await page.locator("#yrLearningContent").textContent(),/ورش الفصل الثاني/);
  await page.locator('.yrMobileNav [data-yr-go="review"]').click();
  assert.equal(await page.locator("#yrReviewView .yrChapterTabs").isVisible(),false);
  assert.match(await page.locator("#yrReviewContent").textContent(),/غير مفعّلة حاليًا/);
  await page.close();
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
});
