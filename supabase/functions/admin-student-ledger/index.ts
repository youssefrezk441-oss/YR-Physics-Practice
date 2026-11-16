import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.105.0";
import postgres from "npm:postgres@3.4.7";

const C={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const url=Deno.env.get('SUPABASE_URL')??'',keys=JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')??'{}'),key=keys.default??Deno.env.get('SUPABASE_ANON_KEY')??'',db=Deno.env.get('SUPABASE_DB_URL')??'';
const auth=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}),sql=postgres(db,{prepare:false,max:2,idle_timeout:20});
const j=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...C,"Content-Type":"application/json; charset=utf-8"}});
const txt=(v:any,n=200)=>typeof v==='string'?v.trim().slice(0,n):'';
const uid=(v:any)=>{const s=txt(v,80);return /^[0-9a-f-]{36}$/i.test(s)?s:''};
const r1=(v:any)=>Math.round((Number(v)+1e-9)*10)/10;
const pct=(a:any,b:any)=>Number(b)>0?r1(Number(a)/Number(b)*100):null;
function canon(v:any){const s=String(v??'');if(['2','2 ثانوي','الصف الثاني الثانوي'].includes(s))return'الصف الثاني الثانوي';if(['3','3 ثانوي','الصف الثالث الثانوي'].includes(s))return'الصف الثالث الثانوي';return s}
async function caller(req:Request){const h=req.headers.get('Authorization')??'';if(!h.startsWith('Bearer '))return null;const{data,error}=await auth.auth.getUser(h.slice(7));if(error||!data.user||data.user.app_metadata?.role!=='admin')return null;const[p]=await sql`select is_owner,is_active,public.admin_access_level('students',${data.user.id}::uuid) students_access,public.admin_access_level('class_sessions',${data.user.id}::uuid) sessions_access from public.admin_profiles where user_id=${data.user.id}::uuid`;if(!p?.is_active)return null;const ok=!!p.is_owner||(['view','edit'].includes(String(p.students_access||''))&&['view','edit'].includes(String(p.sessions_access||'')));return ok?data.user:null}
function compare(compPct:any,readiness:any,m:any,status:any){if(compPct==null||readiness==null)return{state:null,label:'—',delta:null,reason:'لا توجد بيانات كافية للمقارنة.'};const d=r1(Number(compPct)-Number(readiness)),ad=Math.abs(d);if(status==='absent')return{state:'lower',label:'أقل من المتوقع بوضوح',delta:d,reason:'غياب الشامل سُجل بصفر، لذلك المقارنة هنا لا تعكس مستوى أداء داخل الامتحان.'};if(ad<=10)return{state:'aligned',label:'طبيعي / متوافق',delta:d,reason:'الفرق داخل هامش ±10 نقاط مئوية، ويُعتبر طبيعيًا بين مؤشر الاستعداد ونتيجة امتحان واحد.'};const pl=m?.platform_score==null?null:Number(m.platform_score),w=.30;if(d>10){const e=pl==null?null:(Number(compPct)-pl)*w;if(e!=null&&e>=Math.max(4,ad*.40))return{state:'higher',label:'أعلى من المتوقع بوضوح',delta:d,reason:`مؤشر تدريبات المنصة كان ${r1(pl)}% مقابل ${r1(compPct)}% في الشامل، ويبدو أنه عامل رئيسي خفّض مؤشر الاستعداد.`};return{state:'higher',label:'أعلى من المتوقع بوضوح',delta:d,reason:'الفرق أكبر من 10 نقاط، لكن تدريبات المنصة لا تفسّره بشكل كافٍ. يُفضّل مناقشة الطالب لمعرفة سبب التفوق غير المتوقع.'}}const e=pl==null?null:(pl-Number(compPct))*w;if(e!=null&&e>=Math.max(4,ad*.40))return{state:'lower',label:'أقل من المتوقع بوضوح',delta:d,reason:`مؤشر تدريبات المنصة كان ${r1(pl)}% مقابل ${r1(compPct)}% في الشامل، ويبدو أنه عامل رئيسي رفع مؤشر الاستعداد فوق المستوى الذي ظهر في الامتحان.`};return{state:'lower',label:'أقل من المتوقع بوضوح',delta:d,reason:'الفرق أكبر من 10 نقاط، لكن تدريبات المنصة لا تفسّره بشكل كافٍ. يلزم مناقشة الطالب لمعرفة المشكلة التي أثرت على نتيجة الشامل.'}}

type Cycle={id:string;cycle_code:string;title:string;grade_level:string;status:string;start_at:string;cutoff_at:string|null;comprehensive_exam_id:string|null;weights:Record<string,unknown>;archived:boolean;frozen_at:string|null};
async function catalog(){return await sql`select c.id,c.cycle_code,c.title,c.grade_level,c.status,c.start_at,c.cutoff_at,c.comprehensive_exam_id,c.weights,
  c.status='frozen' archived,snapshot.frozen_at
  from public.assessment_cycles c
  cross join lateral (select max(s.frozen_at) frozen_at from public.assessment_cycle_snapshots s where s.cycle_id=c.id) snapshot
  order by c.grade_level,c.start_at desc,c.created_at desc` as any as Cycle[]}
function chooseCycle(all:Cycle[],grade:string,mode:string,explicit?:string){
  const rows=all.filter(c=>canon(c.grade_level)===grade);
  if(explicit)return rows.find(c=>c.id===explicit||c.cycle_code===explicit)??null;
  if(mode==='foundation')return rows.find(c=>c.cycle_code.startsWith('FOUNDATION-'))??rows.at(-1)??null;
  return rows.find(c=>c.status==='open')??rows[0]??null;
}
function cyclePublic(c:Cycle|null){return c?{id:c.id,code:c.cycle_code,title:c.title,grade_level:canon(c.grade_level),status:c.status,start_at:c.start_at,cutoff_at:c.cutoff_at,has_comprehensive:!!c.comprehensive_exam_id,archived:c.archived,frozen_at:c.frozen_at,weights:c.weights}:null}

function usesChapter2(c:Cycle){return c.weights?.assessment_model==='chapter2_sources'}
function onlineHomework(c:Cycle,m:any){
  return usesChapter2(c)?{rate:m?.online_homework_rate??null,submitted:Number(m?.online_homework_submitted||0),counted:Number(m?.online_homework_counted||0),available:Number(m?.online_homework_available||0)}:null;
}
async function cycleMetrics(c:Cycle,userId?:string){
  if(c.archived) return userId
    ? await sql`select user_id, metrics m from public.assessment_cycle_snapshots where cycle_id=${c.id}::uuid and user_id=${userId}::uuid`
    : await sql`select user_id, metrics m from public.assessment_cycle_snapshots where cycle_id=${c.id}::uuid`;
  return await sql`select m->>'user_id' user_id,m from private.assessment_cycle_metrics(${c.id}::uuid) m`;
}
function snapshotExam(c:Cycle,m:any){
  if(!m?.snapshot_comprehensive_status)return null;
  return {
    exam_id:c.comprehensive_exam_id,title:m.snapshot_exam_title,date:m.snapshot_exam_date,
    max_score:m.snapshot_comprehensive_max??null,exam_status:m.snapshot_exam_status,
    status:m.snapshot_comprehensive_status,
    score:m.snapshot_comprehensive_status==='absent'?0:m.snapshot_comprehensive_earned??null,
    percentage:m.snapshot_comprehensive_status==='absent'?0:m.snapshot_comprehensive_score??null
  };
}
function readinessSummary(c:Cycle,m:any){
  if(!m)return null;
  return {cycle_title:c.title,score:m.readiness_score,attendance:m.attendance_rate,
    homework:m.homework_rate,quizzes:m.quiz_ratio,platform:m.platform_score,
    platform_earned:m.platform_best_score_sum,platform_possible:m.platform_total_possible,
    platform_completion_rate:m.platform_completion_rate,platform_quality_ratio:m.platform_quality_ratio,
    platform_completed:m.platform_completed,platform_available:m.platform_available,
    online_homework:onlineHomework(c,m),final_score:c.archived?m.snapshot_final_score??null:null};
}

Deno.serve(async(req)=>{if(req.method==='OPTIONS')return new Response('ok',{headers:C});if(req.method!=='POST')return j({error:'method_not_allowed'},405);const u=await caller(req);if(!u)return j({error:'forbidden',message:'تحتاج صلاحية مشاهدة الطلاب والحصص.'},403);let b:any={};try{b=await req.json()}catch{}const action=txt(b.action,30)||'list',mode=txt(b.cycle_mode,30)==='foundation'?'foundation':'current';try{
 const allCycles=await catalog();
 if(action==='list'){
  const selected=new Map<string,Cycle|null>();
  for(const grade of ['الصف الثالث الثانوي','الصف الثاني الثانوي']){
    const requested=txt(b?.cycle_ids?.[grade],80);
    const cycle=chooseCycle(allCycles,grade,mode,requested);
    if(requested&&!cycle)return j({error:'cycle_not_found',message:'دورة التقييم المطلوبة غير موجودة.'},404);
    selected.set(grade,cycle);
  }
  const profiles=await sql`select user_id,student_code,full_name,grade_level,center_name,group_code,is_active from public.student_profiles order by student_code nulls last,full_name`;
  const metricByCycle=new Map<string,Map<string,any>>();for(const c of [...selected.values()].filter(Boolean) as Cycle[]){if(metricByCycle.has(c.id))continue;const rr=await cycleMetrics(c);metricByCycle.set(c.id,new Map(rr.map((x:any)=>[String(x.user_id),x.m])))}
  const examByCycle=new Map<string,Map<string,any>>();for(const c of [...selected.values()].filter(Boolean) as Cycle[]){if(c.archived||!c.comprehensive_exam_id){examByCycle.set(c.id,new Map());continue}const rr=await sql`select r.user_id,e.id exam_id,e.title,to_char(e.exam_date,'YYYY-MM-DD') exam_date,e.max_score,e.status exam_status,r.status,r.score from public.comprehensive_exam_results r join public.comprehensive_exams e on e.id=r.exam_id where e.id=${c.comprehensive_exam_id}::uuid`;examByCycle.set(c.id,new Map(rr.map((x:any)=>[String(x.user_id),x])))}
  const rosterById=new Map(profiles.map((p:any)=>[String(p.user_id),p]));
  const archivedStudentCycle=new Map<string,Cycle>();
  for(const c of selected.values()){
    if(!c?.archived)continue;
    for(const [userId,m] of metricByCycle.get(c.id)??[]){
      const profile=rosterById.get(userId);
      rosterById.set(userId,{...profile,user_id:userId,grade_level:c.grade_level,
        student_code:m.student_code,full_name:m.full_name,center_name:m.center_name,group_code:m.group_code,
        is_active:profile?.is_active??false});
      archivedStudentCycle.set(userId,c);
    }
  }
  const students=[...rosterById.values()].flatMap((p:any)=>{const grade=canon(p.grade_level),c=archivedStudentCycle.get(String(p.user_id))??selected.get(grade)??null,m=c?metricByCycle.get(c.id)?.get(String(p.user_id))||null:null,e=c?examByCycle.get(c.id)?.get(String(p.user_id))||null:null;if(c?.archived&&!m)return [];const att=m?.attendance_rate==null?null:Number(m.attendance_rate),hw=m?.homework_rate==null?null:Number(m.homework_rate),qr=m?.quiz_ratio==null?null:Number(m.quiz_ratio),pr=m?.platform_score==null?null:Number(m.platform_score);const exam=c?.archived?snapshotExam(c,m):e?{
    exam_id:e.exam_id,title:e.title,date:e.exam_date,max_score:Number(e.max_score),exam_status:e.exam_status,
    status:e.status,score:e.status==='absent'?0:e.score==null?null:Number(e.score),
    percentage:e.status==='absent'?0:e.status==='scored'?pct(e.score,e.max_score):null
  }:null;const cmp=compare(exam?.percentage,m?.readiness_score,m,exam?.status);return{user_id:p.user_id,student_code:p.student_code,full_name:p.full_name,grade_level:grade,center_name:p.center_name,group_code:p.group_code,is_active:p.is_active,cycle:cyclePublic(c),attendance:{rate:att,present:Number(m?.present||0),absent:Number(m?.absent||0),total:Number(m?.total_sessions||0)},homework:{rate:hw,known:Number(m?.homework_known||0),done:null,partial:null,not_submitted:null},quizzes:{ratio:qr,earned:Number(m?.quiz_earned||0),possible:Number(m?.quiz_possible||0),recorded:Number(m?.quiz_scored||0)+Number(m?.quiz_absent||0),absent:Number(m?.quiz_absent||0)},platform:{ratio:pr,earned:Number(m?.platform_best_score_sum||0),possible:Number(m?.platform_total_possible||0),trainings:Number(m?.platform_completed||0),available:m?.platform_available==null?null:Number(m.platform_available),completion_rate:m?.platform_completion_rate==null?null:Number(m.platform_completion_rate),quality_ratio:m?.platform_quality_ratio==null?null:Number(m.platform_quality_ratio),workshop_counted:m?.workshop_counted??null},readiness:m?.readiness_score==null?null:Number(m.readiness_score),readiness_components:m?{attendance:m.attendance_rate,homework:m.homework_rate,quizzes:m.quiz_ratio,platform:m.platform_score}:null,online_homework:c?onlineHomework(c,m):null,final_score:c?.archived?m?.snapshot_final_score??null:null,comprehensive:exam,comparison:cmp};});
  return j({ok:true,students,cycle_mode:mode,cycles:{grade3:cyclePublic(selected.get('الصف الثالث الثانوي')||null),grade2:cyclePublic(selected.get('الصف الثاني الثانوي')||null)},available_cycles:{grade3:allCycles.filter(c=>canon(c.grade_level)==='الصف الثالث الثانوي').map(cyclePublic),grade2:allCycles.filter(c=>canon(c.grade_level)==='الصف الثاني الثانوي').map(cyclePublic)},meta:{comparison_margin_points:10,comparison_basis:'selected_cycle_comprehensive_percentage_vs_selected_cycle_readiness',reason_is_hypothesis:true,platform_checked_first:true,platform_method:'selected_cycle_required_trainings_only'}})
 }
 if(action==='detail'){
  const userId=uid(b.user_id);if(!userId)return j({error:'missing_student'},400);
  const explicit=uid(b.cycle_id);
  const [p]=await sql`select user_id,student_code,full_name,grade_level,center_name,group_code,is_active from public.student_profiles where user_id=${userId}::uuid`;
  const archived=allCycles.find(c=>c.archived&&c.id===explicit);
  const cy=archived??(p?chooseCycle(allCycles,canon(p.grade_level),mode,explicit):null);
  if(!p&&!archived)return j({error:'not_found'},404);
  if(!cy)return j({error:'cycle_not_found',message:'لا توجد دورة تقييم لهذا الصف.'},404);
  const g=canon(cy.grade_level);
  const rr=await cycleMetrics(cy,userId);
  const m=rr.find((x:any)=>String(x.user_id)===userId)?.m;
  const readiness=readinessSummary(cy,m);
  if(cy.archived){
    if(!m)return j({error:'not_in_archive',message:'الطالب خارج نتائج الدورة المؤرشفة.'},404);
    const exam=snapshotExam(cy,m);
    return j({ok:true,cycle:cyclePublic(cy),profile:{...p,user_id:userId,student_code:m.student_code,full_name:m.full_name,grade_level:g,center_name:m.center_name,group_code:m.group_code},sessions:[],quizzes:[],platform:[],comprehensive:exam?[exam]:[],readiness});
  }
  if(!p)return j({error:'not_found'},404);
  const sessions=await sql`select to_char(cs.session_date,'YYYY-MM-DD') session_date,cs.session_number,cs.title,cs.has_homework,ssr.attendance,ssr.homework_status,ssr.note from public.assessment_cycle_sessions acs join public.class_sessions cs on cs.id=acs.session_id join public.session_student_records ssr on ssr.session_id=cs.id and ssr.user_id=${userId}::uuid where acs.cycle_id=${cy.id}::uuid order by cs.session_date desc,cs.session_number desc`;
  const quizzes=await sql`select to_char(cs.session_date,'YYYY-MM-DD') session_date,cs.session_number,cs.title session_title,ct.test_type,ct.test_name,ct.max_score,cts.status,case when cts.status='absent' then 0 else cts.score end score from public.assessment_cycle_tests act join public.class_tests ct on ct.id=act.test_id join public.class_sessions cs on cs.id=ct.session_id join public.session_student_records ssr on ssr.session_id=cs.id and ssr.user_id=${userId}::uuid left join public.class_test_scores cts on cts.test_id=ct.id and cts.user_id=ssr.user_id where act.cycle_id=${cy.id}::uuid and act.role='quiz' order by cs.session_date desc,cs.session_number desc`;
  const platform=usesChapter2(cy)?[]:await sql`select ts.id training_set_id,ts.slug,ts.title,ts.status training_status,count(a.id)::int attempts,count(a.id) filter(where a.status='graded')::int graded_attempts,max(a.percentage) filter(where a.status='graded') best_percentage,(array_agg(a.score order by a.percentage desc nulls last,a.submitted_at desc nulls last) filter(where a.status='graded'))[1] best_score,(array_agg(a.max_score order by a.percentage desc nulls last,a.submitted_at desc nulls last) filter(where a.status='graded'))[1] best_max,max(a.submitted_at) last_submitted_at from public.assessment_cycle_training_sets ac join public.training_sets ts on ts.id=ac.training_set_id left join public.attempts a on a.training_set_id=ts.id and a.user_id=${userId}::uuid where ac.cycle_id=${cy.id}::uuid and ac.evaluation_role='preparation' group by ts.id,ts.slug,ts.title,ts.status order by coalesce(ts.sequence_order,0),ts.created_at`;
  const comprehensive=cy.comprehensive_exam_id?await sql`select e.id exam_id,e.title,to_char(e.exam_date,'YYYY-MM-DD') exam_date,e.max_score,e.status exam_status,r.status,case when r.status='absent' then 0 else r.score end score,r.note from public.comprehensive_exams e left join public.comprehensive_exam_results r on r.exam_id=e.id and r.user_id=${userId}::uuid where e.id=${cy.comprehensive_exam_id}::uuid`:[];
  return j({ok:true,cycle:cyclePublic(cy),profile:{...p,grade_level:g},sessions,quizzes:quizzes.map((x:any)=>({...x,max_score:Number(x.max_score),score:x.score==null?null:Number(x.score),percentage:['scored','absent'].includes(String(x.status))?pct(x.status==='absent'?0:x.score,x.max_score):null})),platform:platform.map((x:any)=>({...x,best_percentage:x.best_percentage==null?null:Number(x.best_percentage),best_score:x.best_score==null?null:Number(x.best_score),best_max:x.best_max==null?null:Number(x.best_max)})),comprehensive:comprehensive.map((x:any)=>({...x,max_score:Number(x.max_score),score:x.score==null?null:Number(x.score),percentage:['scored','absent'].includes(String(x.status))?pct(x.status==='absent'?0:x.score,x.max_score):null})),readiness})
 }
 return j({error:'unknown_action'},400)
}catch(e){console.error('admin-student-ledger',e);return j({error:'server_error',message:'تعذر تحميل سجل الطلاب الشامل.'},500)}});
