import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { chromium } from 'playwright';

const grade3='الصف الثالث الثانوي';
const id='11111111-1111-4111-8111-111111111111';
const closed='22222222-2222-4222-8222-222222222222';
const open='33333333-3333-4333-8333-333333333333';
const archivedCycle={
  id:closed,cycle_code:'CHAPTER1-2026-G3-01',grade_level:grade3,title:'تقييم الفصل الأول',
  status:'frozen',archived:true,frozen_at:'2026-11-07T02:00:00Z',comprehensive_exam_id:'exam'
};
const currentCycle={
  id:open,cycle_code:'CHAPTER2-2026-G3-01',grade_level:grade3,title:'تقييم الفصل الثاني',status:'open',
  weights:{assessment_model:'chapter2_sources',quizzes:40,platform:30,attendance:10,homework:10,online_homework:10}
};
const frozen={
  student_code:'SYN-OLD',full_name:'طالب تجريبي',center_name:'سنتر سابق',group_code:'A',
  readiness_score:75,snapshot_final_score:80,snapshot_comprehensive_status:'scored',
  snapshot_comprehensive_earned:17,snapshot_comprehensive_max:20,snapshot_comprehensive_score:85,
  snapshot_exam_title:'شامل الفصل الأول',snapshot_exam_date:'2026-10-17',snapshot_exam_status:'approved'
};
const current={
  readiness_score:88.2,homework_rate:85,attendance_rate:100,quiz_ratio:90,platform_score:79,
  workshop_counted:2,platform_completed:1,platform_available:2,online_homework_rate:100,online_homework_available:4,online_homework_counted:3,online_homework_submitted:3
};
const profile={user_id:id,student_code:'SYN-NOW',full_name:'طالب تجريبي',grade_level:grade3,center_name:'سنتر حالي',group_code:'B',is_active:true};

function mockEndpoint(){
  let handle;
  const queries=[];
  const sql=async(parts,...params)=>{
    const query=parts.join('?');
    queries.push({query,params});
    if(query.includes('public.admin_profiles'))return [{is_owner:true,is_active:true}];
    if(query.includes('public.assessment_cycles c'))return [currentCycle,archivedCycle];
    if(query.includes('public.student_profiles'))return [profile];
    if(query.includes('select user_id, metrics m'))return [{user_id:id,m:frozen}];
    if(query.includes('private.assessment_cycle_metrics'))return [{user_id:id,m:current}];
    if(query.includes('assessment_cycle_sessions')||query.includes('assessment_cycle_tests'))return [];
    throw Error('Unexpected query '+query);
  };
  const source=readFileSync('supabase/functions/admin-student-ledger/index.ts','utf8').replace(/^import .*;\n/gm,'');
  runInNewContext(stripTypeScriptTypes(source),{
    Deno:{env:{get:()=>undefined},serve(fn){handle=fn}},
    createClient:()=>({auth:{getUser:async token=>({data:{user:{id,app_metadata:{role:token}}}})}}),
    postgres:()=>sql,Request,Response,console
  });
  return {queries,invoke:async(body,role='admin')=>handle(new Request('http://localhost/',{
    method:'POST',headers:{Authorization:'Bearer '+role},body:JSON.stringify(body)
  }))};
}

test('ledger reads frozen values and keeps the open cycle on the shared metrics',async()=>{
  const {queries,invoke}=mockEndpoint();
  const forbidden=await invoke({action:'list'},'student');
  assert.equal(forbidden.status,403);
  assert.equal(queries.length,0);
  const history=await (await invoke({action:'list',cycle_ids:{[grade3]:archivedCycle.cycle_code}})).json();
  assert.equal(history.cycles.grade3.id,closed);
  assert.equal(history.students.length,1);
  assert.equal(history.students[0].group_code,'A');
  assert.equal(history.students[0].final_score,80);
  assert.equal(history.students[0].comprehensive.percentage,85);
  const detail=await (await invoke({action:'detail',user_id:id,cycle_id:closed})).json();
  assert.equal(detail.comprehensive[0].date,'2026-10-17');
  assert.deepEqual(detail.sessions,[]);
  assert.deepEqual(detail.platform,[]);
  assert.equal(detail.readiness.final_score,80);
  assert.ok(!queries.some(({query})=>/private.assessment_cycle_metrics|comprehensive_exam_results|assessment_cycle_sessions/.test(query)));
  const today=await (await invoke({action:'list',cycle_ids:{[grade3]:currentCycle.cycle_code}})).json();
  assert.equal(today.cycles.grade3.id,open);
  assert.equal(today.students[0].group_code,'B');
  assert.equal(today.students[0].readiness,88.2);
  assert.equal(today.students[0].platform.workshop_counted,2);
  assert.equal(today.students[0].online_homework.submitted,3);
  assert.equal(today.students[0].comprehensive,null);
  const invalid=await invoke({action:'list',cycle_ids:{[grade3]:'WRONG-CYCLE'}});
  assert.equal(invalid.status,404);
});

test('published ledger opens Chapter 2 and sends the exact cycle when expanding an archived student',async()=>{
  const out=mkdtempSync(join(tmpdir(),'yr-ledger-'));
  let server,browser;
  try{
    execFileSync(process.execPath,['tools/build_pages_artifact.mjs',out],{stdio:'pipe',timeout:60000});
    const {invoke}=mockEndpoint();
    const requests=[];
    server=createServer(async(req,res)=>{
      const name=basename(new URL(req.url,'http://localhost').pathname);
      if(name==='mock-edge'){
        const chunks=[];
        for await(const chunk of req)chunks.push(chunk);
        const request=JSON.parse(Buffer.concat(chunks).toString());
        requests.push(request);
        const reply=await invoke(request);
        res.writeHead(reply.status,{'content-type':'application/json'}).end(await reply.text());
        return;
      }
      try{
        const content=readFileSync(join(out,name));
        const type=extname(name)==='.html'?'text/html; charset=utf-8':'application/javascript; charset=utf-8';
        res.writeHead(200,{'content-type':type}).end(content);
      }catch{res.writeHead(404).end();}
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||chromium.executablePath(),args:['--no-sandbox']});
    const page=await browser.newPage();
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('https://cdn.jsdelivr.net/**',route=>route.fulfill({
      contentType:'application/javascript',headers:{'access-control-allow-origin':'*'},
      body:`export function createClient(){return {
        auth:{getSession:async()=>({data:{session:{user:{app_metadata:{role:'admin'}}}}})},
        functions:{invoke:async(name,{body})=>name==='admin-manager'?{data:{profile:{is_owner:true}}}:
          {data:await (await fetch('/mock-edge',{method:'POST',body:JSON.stringify(body)})).json()}}
      }}`
    }));
    await page.addInitScript(()=>{localStorage.setItem('yrLedgerCycleMode','foundation');window.print=()=>{};});
    await page.goto('http://127.0.0.1:'+server.address().port+'/student-ledger-admin.html');
    await page.getByText('SYN-NOW').waitFor({state:'visible'});
    assert.equal(requests[0].cycle_ids[grade3],currentCycle.cycle_code);
    assert.match(await page.locator('#rows').innerText(),/واجب المنصة · 3 تسليم من 3 محسوب/);
    assert.match(await page.locator('#rows').innerText(),/1 من 2 ورشة محسوبة/);
    assert.match(await page.locator('#rows').innerText(),/88\.2%/);
    await page.locator('#ledgerCycleMode').selectOption('chapter1');
    await page.getByText('SYN-OLD').waitFor({state:'visible'});
    assert.match(await page.locator('#ledgerCycleInfo').innerText(),/مؤرشفة/);
    assert.match(await page.locator('#rows').innerText(),/النتيجة النهائية/);
    assert.equal(await page.getByText('SYN-NOW').count(),0);
    await page.getByRole('button',{name:'فتح',exact:true}).click();
    await page.getByText('النتيجة النهائية المؤرشفة').waitFor({state:'visible'});
    assert.equal(requests.at(-1).cycle_id,closed);
    assert.equal(await page.getByText('سجل الحضور والواجب').count(),0);
    await page.locator('#exportPdf').click();
    assert.match(await page.locator('#printFilters').textContent(),/تقييم الفصل الأول/);
    assert.deepEqual(errors,[]);
  }finally{
    if(browser)await browser.close();
    if(server)await new Promise(resolve=>server.close(resolve));
    rmSync(out,{recursive:true,force:true});
  }
});
