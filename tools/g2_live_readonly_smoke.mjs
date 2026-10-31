#!/usr/bin/env node
// Public, anonymous-only smoke test. Reads no student records and performs no writes.
import assert from "node:assert/strict";
const endpoint="https://ltjdhconuiqblxfjzpzj.supabase.co/functions/v1/grade2-mastery";
const origin="https://youssefrezk441-oss.github.io";
const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),20000);
try{
 const response=await fetch(endpoint,{method:"POST",signal:ctrl.signal,headers:{"content-type":"application/json","origin":origin},body:JSON.stringify({action:"catalog"})});
 const json=await response.json();
 assert.equal(response.status,401,"anonymous request must get HTTP 401");
 assert.equal(json.error,"login_required","anonymous user must not see workshop data");
 assert.equal(response.headers.get("access-control-allow-origin"),origin);
 assert.equal("activities" in json,false,"anonymous response must contain no student data");
 console.log("grade2 anonymous runtime smoke: HTTP 401 login_required, CORS verified, no student content");
}finally{clearTimeout(timer)}
