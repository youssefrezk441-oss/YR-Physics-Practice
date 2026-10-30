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
  return{data:{ok:true}};
 }}
}}`;
function serve(){
 return http.createServer((req,res)=>{
  const file=path.resolve(dir,decodeURIComponent(new URL(req.url,"http://127.0.0.1").pathname).slice(1)||"student.html");
  if(!file.startsWith(dir+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return}
  const ext=path.extname(file);
  res.writeHead(200,{"content-type":ext===".html"?"text/html; charset=utf-8":ext===".css"?"text/css; charset=utf-8":ext===".js"?"text/javascript; charset=utf-8":ext===".svg"?"image/svg+xml":ext===".webp"?"image/webp":"application/octet-stream"});
  res.end(fs.readFileSync(file));
 });
}
test("real compiled YR dashboard renders without horizontal overflow in light and dark modes",async()=>{
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
     cards:[...document.querySelectorAll("#dashboardView .studentHomeGrid .studentNavCard")].map(x=>x.getBoundingClientRect().width),
     hello:document.querySelector("#welcomeTitle")?.textContent
    }));
    assert.ok(dimensions.logo>30,"YR mark missing at "+width+"/"+theme);
    assert.equal(dimensions.cards.length,3,"dashboard destinations missing");
    assert.ok(dimensions.cards.every(x=>x>=170),"narrow cards at "+width+"/"+theme);
    assert.ok(dimensions.scroll<=dimensions.viewport+2,
      "horizontal overflow at "+width+"/"+theme+" "+JSON.stringify(dimensions));
    assert.match(dimensions.hello,/طالب تجريبي/);
    if([1440,390].includes(width))await page.screenshot({path:"yr-internal-previews/dashboard-"+width+"-"+theme+".png",fullPage:true});
   }
   await page.close();
  }
 }finally{await browser.close();await new Promise(resolve=>s.close(resolve))}
});
