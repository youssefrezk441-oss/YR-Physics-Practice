import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import {chromium} from "playwright";

const root=new URL("../../",import.meta.url);
const pagePath=new URL("admin-student-registrations.html",root);
const backendPath=new URL("supabase/functions/student-identity/index.ts",root);
const fakeApi=String.raw`
export const $=id=>document.getElementById(id);
export const esc=x=>String(x??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
export const message=(text)=>{document.getElementById("message").textContent=text};
export const sb={auth:{getSession:async()=>({data:{session:{user:{app_metadata:{role:"admin"}}}}})}};
window.__recoveryCalls=[];
export async function identity(action,body={}){
 if(action==="admin_list")return {requests:[],groups:[],invites:[],level:window.__testAdminLevel||"edit",recovery_requests:[
  {public_ref:"11111111-1111-4111-8111-111111111111",status:"pending",account_matched:true,student_name:"طالبة تجريبية",student_code:"TEST-3-001",group_code:"N3-A",created_at:"2026-10-30T12:00:00Z"},
  {public_ref:"22222222-2222-4222-8222-222222222222",status:"pending",account_matched:false,created_at:"2026-10-30T12:00:00Z"}
 ]};
 if(action==="admin_recovery_decide"){
  window.__recoveryCalls.push(body);
  if(body.decision==="approved"&&(body.identity_verified!==true||!["in_person","registered_phone"].includes(body.verification_method)))
   throw Error("verification required");
  return body.decision==="approved"?{ok:true,reset_token:"SYNTHETIC-ONE-TIME-RESET-TOKEN"}:{ok:true};
 }
 throw Error("unexpected action: "+action);
}
`;

async function withPage(fn){
 const server=createServer(async(req,res)=>{
  if(req.url?.split("?")[0]==="/admin-student-registrations.html"){
   res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});res.end(await readFile(pagePath));return;
  }
  res.writeHead(404);res.end("not found");
 });
 await new Promise(ok=>server.listen(0,"127.0.0.1",ok));
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||chromium.executablePath(),args:["--no-sandbox"]});
 try{
  const page=await browser.newPage();
  await page.route("**/student-identity-api.js",route=>route.fulfill({status:200,contentType:"text/javascript",body:fakeApi}));
  await fn(page,"http://127.0.0.1:"+server.address().port+"/admin-student-registrations.html");
 }finally{
  await browser.close();
  await new Promise(ok=>server.close(ok));
 }
}

test("recovery approval is blocked until an administrator records real identity verification",async()=>{
 await withPage(async(page,url)=>{
  await page.goto(url,{waitUntil:"domcontentloaded"});
  await page.locator('#recoveryRows button[data-recovery]').first().waitFor();
  assert.match(await page.locator("#recoveryRows").innerText(),/طالبة تجريبية/);
  assert.match(await page.locator("#recoveryRows").innerText(),/N3-A/);
  await page.locator('[data-recovery="11111111-1111-4111-8111-111111111111"]').click();
  await page.locator("#recoveryChoice").selectOption("approved");
  assert.equal(await page.locator("#recoveryVerification").isVisible(),true);
  await page.locator("#recoveryReason").fill("تم التحقق من بيانات الطالبة مباشرة");
  await page.locator('#recoveryForm button[type="submit"]').click();
  assert.equal(await page.evaluate(()=>window.__recoveryCalls.length),0,"cannot approve without verification");
  await page.locator("#recoveryVerificationMethod").selectOption("in_person");
  await page.locator("#recoveryIdentityVerified").check();
  await page.locator('#recoveryForm button[type="submit"]').click();
  await page.locator("#recoveryTokenReceipt").waitFor({state:"visible"});
  const calls=await page.evaluate(()=>window.__recoveryCalls);
  assert.equal(calls.length,1);
  assert.equal(calls[0].verification_method,"in_person");
  assert.equal(calls[0].identity_verified,true);
  assert.equal(await page.locator("#recoveryTokenValue").getAttribute("type"),"password");
  assert.equal(await page.locator("#recoveryTokenValue").inputValue(),"SYNTHETIC-ONE-TIME-RESET-TOKEN");
  await page.locator("#dismissRecoveryToken").click();
  assert.equal(await page.locator("#recoveryTokenValue").inputValue(),"");
  assert.equal(await page.locator("#recoveryTokenReceipt").isVisible(),false);
  await page.locator('[data-recovery="22222222-2222-4222-8222-222222222222"]').click();
  assert.equal(await page.locator('#recoveryChoice option[value="approved"]').isDisabled(),true);
  assert.equal(await page.locator("#recoveryTokenValue").inputValue(),"");
 });
});

test("view-only staff never receive a recovery decision action",async()=>{
 await withPage(async(page,url)=>{
  await page.addInitScript(()=>{window.__testAdminLevel="view"});
  await page.goto(url,{waitUntil:"domcontentloaded"});
  await page.locator("#recoveryRows tr").first().waitFor();
  assert.equal(await page.locator("#recoveryRows button[data-recovery]").count(),0);
 });
});

test("backend checks verification server-side and never writes the raw reset token to the database",async()=>{
 const fn=await readFile(backendPath,"utf8");
 assert.match(fn,/body\.identity_verified !== true/);
 assert.match(fn,/in_person.*registered_phone/);
 assert.match(fn,/const token = b64\(crypto\.getRandomValues/);
 assert.match(fn,/token_hash,expires_at,issued_by/);
 assert.match(fn,/reset_token: token, expires_in_hours: 2/);
 assert.match(fn,/student_name,p\.student_code,p\.group_code/);
});
