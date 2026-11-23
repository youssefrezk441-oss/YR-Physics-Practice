import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.105.0";
import postgres from "npm:postgres@3.4.7";

const C={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const url=Deno.env.get("SUPABASE_URL")??"";
const keys=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")??"{}");
const key=keys.default??Deno.env.get("SUPABASE_ANON_KEY")??"";
const db=Deno.env.get("SUPABASE_DB_URL")??"";
const auth=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const sql=postgres(db,{prepare:false,max:1,idle_timeout:20});
const j=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...C,"Content-Type":"application/json; charset=utf-8"}});
const r1=(n:any)=>n==null||!Number.isFinite(Number(n))?null:Math.round((Number(n)+1e-9)*10)/10;
function gradeKey(g:any){const s=String(g??"");if(/^[NK]3-/.test(s))return"grade3";if(/^[NK]2-B$/i.test(s))return"grade2_azhar";if(/^[NK]2-A$/i.test(s))return"grade2";return null}
function gradeLabel(k:string){if(k==="grade3")return"الصف الثالث الثانوي";if(k==="grade2_azhar")return"الصف الثاني الثانوي أزهر";return"الصف الثاني الثانوي بكالوريا"}
function gradeDb(k:string){return k==="grade3"?"الصف الثالث الثانوي":"الصف الثاني الثانوي"}
function trackDb(k:string){return k==="grade2_azhar"?"azhar":k==="grade2"?"baccalaureate":"all"}
function rankRows<T extends Record<string, any>>(rows:T[], field:string){
  let previous:number|null=null;
  let rank=0;
  return rows.map(row=>{
    const score=r1(row[field]);
    if(rank===0||score!==previous){
      rank++;
      previous=score;
    }
    return {...row,rank};
  });
}
function withinRanks<T extends {rank:number}>(rows:T[], limit:number){
  return rows.filter(row=>row.rank<=limit);
}
function badgesFor(x:any,phase:string){const b:string[]=[];if(phase==="final"&&x.rank===1)b.push("بطل الجولة");if(phase==="final"&&x.overall!=null&&x.overall>=90)b.push("نخبة الجولة");if(x.comprehensive_score!=null&&x.comprehensive_score>=90)b.push("فارس الشامل");if(x.readiness_score!=null&&x.readiness_score>=90)b.push("استعداد ذهبي");if(x.quiz_score!=null&&x.quiz_score>=90)b.push("فارس الكويزات");if(x.platform_score!=null&&x.platform_score>=85)b.push("نجم المنصة");if(x.homework_score===100)b.push("واجب كامل");if(x.attendance_rate===100)b.push("حضور كامل");return b.slice(0,3)}
function pub(x:any){return{user_id:x.user_id,student_code:x.student_code,full_name:x.full_name,group_code:x.group_code,center_name:x.center_name,overall:x.overall,final_score:x.final_score,readiness_score:x.readiness_score,comprehensive_score:x.comprehensive_score,comprehensive_earned:x.comprehensive_earned,comprehensive_max:x.comprehensive_max,quiz_score:x.quiz_score,test_score:x.quiz_score,attendance_rate:x.attendance_rate,homework_score:x.homework_score,online_homework_rate:x.online_homework_rate,online_homework_submitted:x.online_homework_submitted,online_homework_counted:x.online_homework_counted,commitment_score:x.commitment_score,platform_score:x.platform_score,platform_completion:x.platform_completion,platform_quality:x.platform_quality,quiz_earned:x.quiz_earned,quiz_possible:x.quiz_possible,quiz_absent:x.quiz_absent,total_sessions:x.total_sessions,completed_sets:x.completed_sets,available_sets:x.available_sets,eligible:x.eligible,missing:x.missing,badges:x.badges,rank:x.rank??null,improvement:x.improvement??null,latest_test:x.latest_test??null,previous_test:x.previous_test??null,previous_average:x.previous_average??null,pending_essay_answers:x.pending_essay_answers??0,pending_platform_attempts:x.pending_platform_attempts??0}}
function top(students:any[],field:string,filter=(x:any)=>x[field]!=null){
  const ordered=students.filter(filter).sort((a,b)=>
    Number(b[field])-Number(a[field])||String(a.full_name).localeCompare(String(b.full_name),"ar"));
  return withinRanks(rankRows(ordered,field),5).map(pub);
}
function awardPack(students:any[],field:string){const all=students.filter(x=>x.total_sessions>0&&Number(x[field])===100).sort((a,b)=>String(a.full_name).localeCompare(String(b.full_name),"ar"));return{count:all.length,students:all.slice(0,12).map(pub)}}
function chapter2Progress(metrics:any){
  return {
    attendance:{present:Number(metrics.present||0),total:Number(metrics.total_sessions||0)},
    classroom_homework:{total:Number(metrics.homework_known||0),pending:Number(metrics.homework_unknown||0)},
    quizzes:{taken:Number(metrics.quiz_scored||0),pending:Number(metrics.quiz_pending||0)}
  };
}
async function homeProgress(userId:string, groupCode:string){
  const pending=await sql`
    with activities as (
      select d.id, d.slug, d.title, d.active_version_id, d.lecture_no, v.published_at,
             case when r.due_at>=v.published_at then r.due_at end as due_at,
             h.workshop_id is not null as paper
      from private.workshop_definitions d
      join private.workshop_versions v on v.id=d.active_version_id and v.status='published'
      left join private.chapter2_assessment_activity_rules r on r.workshop_id=d.id
      left join private.homework_delivery_policies h on h.workshop_id=d.id
        and h.delivery_contract='paper_homework_capture_v1'
      where v.published_at<=now()
        and d.academic_term='second' and d.status='published' and d.grade_level='الصف الثالث الثانوي'
        and (h.workshop_id is null or h.enabled)
        and (jsonb_array_length(d.eligible_group_codes)=0 or d.eligible_group_codes ? ${groupCode})
    )
    select a.slug,
           case when a.paper then a.title else a.title || ' — ' ||
             (case when t.track_key = 'home' then 'ورشة الواجب' else t.title end) end as title,
           a.due_at, case when a.paper then 'homework' else 'workshops' end as kind,
           t.track_key as track
    from activities a
    left join private.workshop_tracks t on not a.paper and t.version_id=a.active_version_id
    where (a.paper and not exists (
      select 1 from private.homework_submissions s
      where s.workshop_id=a.id and s.user_id=${userId}::uuid
    )) or (not a.paper and (
          (t.mode='final_submit' and not exists (
            select 1 from private.workshop_submissions s join private.workshop_cycles w on w.id=s.cycle_id
            where s.track_id=t.id and w.user_id=${userId}::uuid and w.source='initial'
          )) or (t.mode='interactive' and exists (
            select 1 from private.workshop_track_questions tq
            join private.workshop_questions q on q.id=tq.question_id and q.active
            join private.workshop_question_parts p on p.question_id=q.id
            where tq.track_id=t.id and not exists (
              select 1 from private.workshop_attempt_events e join private.workshop_cycles w on w.id=e.cycle_id
              where e.track_id=t.id and e.part_id=p.id and e.attempt_no=1 and w.user_id=${userId}::uuid
                and w.source='initial'
            )
          ))
    ))
    order by
      case when a.due_at<=now()+interval '2 days' then 0 when a.paper then 1 else 2 end,
      case when a.due_at<=now()+interval '2 days' then a.due_at end,
      a.lecture_no, a.published_at, a.slug,
      case when t.track_key = 'class' then 0 else 1 end
  `;
  const [row]=await sql`
    select m from public.assessment_cycles c
    cross join lateral private.assessment_cycle_metrics(c.id) m
    where c.cycle_code='CHAPTER2-2026-G3-01' and c.status='open'
      and m->>'user_id'=${userId}
  `;
  const m=row?.m;
  return {progress:{
    pending,
    due:pending.find(activity=>{
      const time=new Date(activity.due_at).getTime();
      return time>Date.now()&&time<=Date.now()+48*60*60*1000;
    })??null,
    ...(m?{
      ranked:m.readiness_score!=null,
      ...chapter2Progress(m),
      workshops:{completed:Number(m.platform_completed||0),counted:Number(m.workshop_counted||0)},
      homework:{submitted:Number(m.online_homework_submitted||0),counted:Number(m.online_homework_counted||0)}
    }:{})
  }};
}
async function cycleCatalog(key:string){const g=gradeDb(key),track=trackDb(key);const rows=await sql`select c.id,c.cycle_code,c.title,c.grade_level,c.education_track,c.start_at,c.cutoff_at,c.comprehensive_exam_date,c.comprehensive_exam_id,c.status,c.created_at,exists(select 1 from public.assessment_cycle_snapshots s where s.cycle_id=c.id) archived,(select max(s.frozen_at) from public.assessment_cycle_snapshots s where s.cycle_id=c.id) frozen_at,e.status exam_status,e.approved_at from public.assessment_cycles c left join public.comprehensive_exams e on e.id=c.comprehensive_exam_id where c.grade_level=${g} and c.education_track=${track} order by (c.status='open') desc,c.start_at desc,c.created_at desc`;return rows.map((x:any,i:number)=>({id:x.id,code:x.cycle_code,title:x.title,grade_level:x.grade_level,education_track:x.education_track,start_at:x.start_at,cutoff_at:x.cutoff_at,exam_date:x.comprehensive_exam_date,status:x.status,exam_status:x.exam_status,archived:!!x.archived,frozen_at:x.frozen_at,is_default:i===0}))}
async function pickCycle(key:string,requested:string|null){const g=gradeDb(key),track=trackDb(key);let rows:any[]=[];if(requested)rows=await sql`select id,cycle_code,title,grade_level,education_track,start_at,cutoff_at,comprehensive_exam_date,comprehensive_exam_id,status,weights,created_at from public.assessment_cycles where grade_level=${g} and education_track=${track} and (id::text=${requested} or cycle_code=${requested}) limit 1`;if(!rows.length)rows=await sql`select id,cycle_code,title,grade_level,education_track,start_at,cutoff_at,comprehensive_exam_date,comprehensive_exam_id,status,weights,created_at from public.assessment_cycles where grade_level=${g} and education_track=${track} order by (status='open') desc,start_at desc,created_at desc limit 1`;return rows[0]??null}
async function build(key:string,currentId:string|null,requestedCycle:string|null){const cycle=await pickCycle(key,requestedCycle);if(!cycle)return{key,label:gradeLabel(key),phase:"none",source:"none",stats:{students:0,eligible:0},podium:[],top10:[],risers:[],leaders:{},awards:{},groups:[],personal:null};const isChapter2=cycle.cycle_code==="CHAPTER2-2026-G3-01";const snapMeta=await sql`select count(*)::int n,max(frozen_at) frozen_at from public.assessment_cycle_snapshots where cycle_id=${cycle.id}::uuid`;const archived=Number(snapMeta[0]?.n||0)>0;let raw:any[];if(archived)raw=await sql`select metrics m from public.assessment_cycle_snapshots where cycle_id=${cycle.id}::uuid order by user_id`;else raw=await sql`select private.assessment_cycle_metrics(${cycle.id}::uuid) m`;let exam:any=null,examMap=new Map<string,any>(),enteredCount=0,examRoster=0;if(cycle.comprehensive_exam_id){[exam]=await sql`select id,title,exam_date,max_score,status,approved_at from public.comprehensive_exams where id=${cycle.comprehensive_exam_id}::uuid`;if(exam&&!archived){const er=await sql`select user_id,status,score from public.comprehensive_exam_results where exam_id=${exam.id}::uuid`;examRoster=er.length;enteredCount=er.filter((x:any)=>["scored","absent"].includes(x.status)).length;examMap=new Map(er.map((x:any)=>[String(x.user_id),x]))}}const released=archived||exam?.status==="approved";let students=raw.map((x:any)=>{const m=x.m,attendance=m.attendance_rate==null?null:Number(m.attendance_rate),homework=m.homework_rate==null?null:Number(m.homework_rate),quiz=m.quiz_ratio==null?null:Number(m.quiz_ratio),platform=m.platform_score==null?null:Number(m.platform_score),readiness=m.readiness_score==null?null:Number(m.readiness_score),latest=m.latest_quiz_pct==null?null:Number(m.latest_quiz_pct),previous=m.previous_quiz_pct==null?null:Number(m.previous_quiz_pct),previousAverage=m.previous_quiz_avg_pct==null?null:Number(m.previous_quiz_avg_pct),previousCount=Number(m.previous_quiz_count||0),commitment=attendance==null?null:(homework==null?attendance:r1(attendance*.6+homework*.4)),missing:string[]=[];if(Number(m.total_sessions||0)===0)missing.push("الحضور");if(homework==null)missing.push("الواجب");if(quiz==null)missing.push("الكويزات");const chapter2=m.assessment_model==="chapter2_sources";if(platform==null)missing.push(chapter2?"ورش المنصة":"المنصة");if(chapter2&&m.online_homework_rate==null)missing.push("تسليم واجب المنصة");if(!archived&&Number(m.pending_essay_answers||0)>0)missing.push("مقالي معلق");if(!archived&&Number(m.pending_platform_attempts||0)>0&&!Number(m.pending_essay_answers||0))missing.push("تصحيح منصة معلق");if(!archived&&Number(m.quiz_pending||0)>0)missing.push("كويز غير مسجل");let comp:any=null,earned:any=null,max:any=null;if(archived){comp=m.snapshot_comprehensive_score==null?null:Number(m.snapshot_comprehensive_score);earned=m.snapshot_comprehensive_earned==null?null:Number(m.snapshot_comprehensive_earned);max=m.snapshot_comprehensive_max==null?null:Number(m.snapshot_comprehensive_max);if(m.snapshot_comprehensive_status&&!["scored","absent"].includes(String(m.snapshot_comprehensive_status)))comp=null}else{const cr=examMap.get(String(m.user_id));if(released&&cr&&["scored","absent"].includes(cr.status)){max=Number(exam.max_score);earned=cr.status==="absent"?0:Number(cr.score);comp=cr.status==="absent"?0:r1(earned/max*100)}}return{user_id:m.user_id,student_code:m.student_code,full_name:m.full_name,group_code:m.group_code,center_name:m.center_name,total_sessions:Number(m.total_sessions||0),attendance_rate:attendance,homework_score:homework,online_homework_rate:m.online_homework_rate,online_homework_submitted:m.online_homework_submitted,online_homework_counted:m.online_homework_counted,commitment_score:commitment,quiz_score:quiz,quiz_earned:Number(m.quiz_earned||0),quiz_possible:Number(m.quiz_possible||0),quiz_absent:Number(m.quiz_absent||0),quiz_scored:Number(m.quiz_scored||0),platform_score:platform,platform_completion:m.platform_completion_rate==null?null:Number(m.platform_completion_rate),platform_quality:m.platform_quality_ratio==null?null:Number(m.platform_quality_ratio),completed_sets:Number(m.platform_completed||0),available_sets:Number(m.platform_available||0),readiness_score:readiness,comprehensive_score:comp,comprehensive_earned:earned,comprehensive_max:max,latest_test:latest,previous_test:previous,previous_average:previousAverage,previous_count:previousCount,data_complete:!!m.data_complete,pending_essay_answers:archived?0:Number(m.pending_essay_answers||0),pending_platform_attempts:archived?0:Number(m.pending_platform_attempts||0),missing,snapshot_final_score:archived&&m.snapshot_final_score!=null?Number(m.snapshot_final_score):null}});const participants=students.filter(x=>x.total_sessions>0),readyCount=participants.filter(x=>x.readiness_score!=null).length;if(archived){examRoster=students.filter(x=>x.comprehensive_max!=null).length;enteredCount=students.filter(x=>x.comprehensive_score!=null).length}let phase="readiness";if(!archived&&exam&&enteredCount>0&&!released)phase="comprehensive_entry";else if(released)phase="final";students=students.map(x=>{const finalScore=phase==="final"&&x.readiness_score!=null&&x.comprehensive_score!=null?(x.snapshot_final_score!=null?r1(x.snapshot_final_score):r1(Number(x.comprehensive_score)*.8+Number(x.readiness_score)*.2)):null,overall=phase==="final"?finalScore:x.readiness_score,eligible=overall!=null,improvement=x.latest_test!=null&&x.previous_average!=null&&Number(x.previous_average)>0&&Number(x.previous_count||0)>0&&Number(x.latest_test)>=70&&Number(x.latest_test)>Number(x.previous_average)?r1(Number(x.latest_test)-Number(x.previous_average)):null;return{...x,final_score:finalScore,overall,eligible,improvement,badges:[]}});const eligibleSorted=students.filter(x=>x.eligible).sort((a,b)=>Number(b.overall)-Number(a.overall)||(phase==="final"?Number(b.comprehensive_score??-1)-Number(a.comprehensive_score??-1):Number(b.quiz_score??-1)-Number(a.quiz_score??-1))||(phase==="final"?Number(b.readiness_score??-1)-Number(a.readiness_score??-1):0)||String(a.full_name).localeCompare(String(b.full_name),"ar")),ranked=rankRows(eligibleSorted,"overall"),rankedById=new Map(ranked.map(x=>[String(x.user_id),x]));students=students.map(x=>{const rx=rankedById.get(String(x.user_id));return{...x,rank:rx?.rank??null,badges:badgesFor({...x,rank:rx?.rank??null},phase)}});const byId=new Map(students.map(x=>[String(x.user_id),x])),rankedFinal=ranked.map(x=>byId.get(String(x.user_id))??x);const orderedRisers=students.filter(x=>x.improvement!=null&&x.improvement>0).sort((a,b)=>Number(b.improvement)-Number(a.improvement)||String(a.full_name).localeCompare(String(b.full_name),"ar"));const risers=withinRanks(rankRows(orderedRisers,"improvement"),5).map(pub);const centerOf=(code:any)=>{const s=String(code??"").toUpperCase();if(s.startsWith("N"))return"ناهيا";if(s.startsWith("K"))return"كفر حكيم";return"أخرى"};const groups=[...new Set(students.map(x=>centerOf(x.group_code)).filter(x=>x!=="أخرى"))].map(center=>{const members=rankedFinal.filter(x=>centerOf(x.group_code)===center),avg=members.length?r1(members.reduce((s,x)=>s+Number(x.overall),0)/members.length):null,leader=members[0]??null;return{group_code:center,center_name:center,average:avg,eligible_count:members.length,total_count:students.filter(x=>centerOf(x.group_code)===center).length,leader:leader?{full_name:leader.full_name,overall:leader.overall}:null}}).sort((a,b)=>Number(b.average??-1)-Number(a.average??-1));let personal:any=null;const current=currentId?students.find(x=>String(x.user_id)===String(currentId)):null;if(current){if(current.eligible){const idx=rankedFinal.findIndex(x=>String(x.user_id)===String(currentId)),higher=idx>0?[...rankedFinal.slice(0,idx)].reverse().find(x=>Number(x.overall)>Number(current.overall)+.049)??null:null;personal={...pub(current),rank:current.rank,total_eligible:rankedFinal.length,next_target:higher?{rank:higher.rank,full_name:higher.full_name,score:higher.overall,gap:r1(Number(higher.overall)-Number(current.overall))}:null,message:archived?"هذه نتيجة مؤرشفة وثابتة لهذه الجولة.":current.rank===1?"أنت في الصدارة حاليًا.":higher?`يفصلك ${r1(Number(higher.overall)-Number(current.overall))} نقطة عن المركز الأعلى التالي.`:"أنت متعادل مع أعلى مركز متاح أمامك حاليًا."}}else{const underReview=!archived&&(current.pending_essay_answers>0||current.pending_platform_attempts>0);personal={...pub(current),rank:null,total_eligible:rankedFinal.length,review_pending:underReview,message:archived?"لم تتوفر نتيجة نهائية مؤهلة للترتيب في النسخة المؤرشفة لهذه الجولة.":underReview?`ترتيبك قيد المراجعة ⏳ — لديك ${current.pending_essay_answers||current.pending_platform_attempts} عنصرًا لم يكتمل اعتماده بعد.`:phase==="final"?"نتيجة الشامل معتمدة، لكن لا يمكن حساب ترتيبك النهائي قبل اكتمال بيانات الاستعداد الخاصة بك.":"سيظهر ترتيبك في سباق الاستعداد فور اكتمال البيانات الأساسية."}}if(isChapter2&&!archived){const metrics=raw.find(row=>String(row.m.user_id)===String(currentId))?.m;if(metrics)personal.progress=chapter2Progress(metrics)}}const groupGap=groups.length>1&&groups[0].average!=null&&groups[1].average!=null?r1(Number(groups[0].average)-Number(groups[1].average)):null;let challenge=archived?"نسخة مؤرشفة وثابتة من نتيجة هذه الدورة؛ لا تتأثر بأي نشاط أو دورة لاحقة.":phase==="readiness"?"سباق الاستعداد مبدئي حتى اعتماد الشامل المرتبط بهذه الدورة.":phase==="comprehensive_entry"?"تم حفظ بعض/كل درجات الشامل، لكن الترتيب يظل استعدادًا فقط حتى الاعتماد النهائي.":"تم اعتماد الشامل — الترتيب النهائي = 80% شامل + 20% استعداد.";if(groupGap!=null&&groupGap<=3)challenge+=" الفارق بين السنترين أقل من 3 نقاط.";const pendingStudents=archived?[]:participants.filter(x=>x.pending_essay_answers>0||x.pending_platform_attempts>0);return{key,label:gradeLabel(key),phase,source:archived?"snapshot":"live",archived,frozen_at:archived?snapMeta[0]?.frozen_at:null,cycle:{id:cycle.id,code:cycle.cycle_code,title:cycle.title,weights:cycle.weights,cutoff_at:cycle.cutoff_at,exam_date:exam?.exam_date??cycle.comprehensive_exam_date,status:cycle.status,archived,frozen_at:archived?snapMeta[0]?.frozen_at:null,comprehensive_exam:exam?{id:exam.id,title:exam.title,status:exam.status,max_score:Number(exam.max_score)}:null},stats:{students:students.length,participants:participants.length,eligible:rankedFinal.length,highest:rankedFinal[0]?.overall??null,biggest_rise:risers[0]?.improvement??null,leading_group:groups[0]?.group_code??null,comprehensive_recorded:enteredCount,comprehensive_expected:examRoster||participants.length,comprehensive_approved:released,readiness_ready:readyCount,pending_review_students:pendingStudents.length,pending_review_answers:pendingStudents.reduce((s,x)=>s+Number(x.pending_essay_answers||0),0)},challenge,podium:withinRanks(rankedFinal,3).map(pub),top10:withinRanks(rankedFinal,isChapter2?10:5).map(pub),risers,leaders:{comprehensive:top(students,"comprehensive_score",x=>phase==="final"&&x.comprehensive_score!=null),readiness:top(students,"readiness_score",x=>x.readiness_score!=null),quizzes:top(students,"quiz_score",x=>x.quiz_score!=null&&(!isChapter2||x.quiz_scored>0)),platform:top(students,"platform_score",x=>x.platform_score!=null)},awards:{perfect_attendance:awardPack(students,"attendance_rate"),perfect_homework:awardPack(students,"homework_score")},groups,personal}}
Deno.serve(async req=>{if(req.method==="OPTIONS")return new Response("ok",{headers:C});if(req.method!=="POST")return j({error:"method_not_allowed"},405);const h=req.headers.get("Authorization")??"";if(!h.startsWith("Bearer "))return j({error:"unauthorized"},401);const{data,error}=await auth.auth.getUser(h.slice(7));if(error||!data.user)return j({error:"unauthorized"},401);const u=data.user,role=u.app_metadata?.role;let viewer:any=null,currentId:string|null=null;if(role==="student"){const[p]=await sql`select user_id,student_code,full_name,group_code,is_active from public.student_profiles where user_id=${u.id}::uuid`;if(!p?.is_active)return j({error:"inactive_student"},403);viewer={role:"student",student_code:p.student_code,full_name:p.full_name,group_code:p.group_code,grade_key:gradeKey(p.group_code)};currentId=u.id}else if(role==="admin"){const[a]=await sql`select display_name,is_owner,is_active from public.admin_profiles where user_id=${u.id}::uuid`;if(!a?.is_active)return j({error:"inactive_admin"},403);let allowed=!!a.is_owner;if(!allowed){const perms=await sql`select section,access_level from public.admin_permissions where user_id=${u.id}::uuid and section in('students','class_sessions')`;const m=new Map(perms.map((p:any)=>[p.section,p.access_level]));allowed=["view","edit"].includes(String(m.get("students")||""))&&["view","edit"].includes(String(m.get("class_sessions")||""))}if(!allowed)return j({error:"forbidden"},403);viewer={role:"admin",display_name:a.display_name,is_owner:!!a.is_owner}}else return j({error:"forbidden"},403);let body:any={};try{body=await req.json()}catch{body={}}const selected=body?.cycles&&typeof body.cycles==="object"?body.cycles:{};try{if(body.action==="home_progress"){
 if(!currentId||viewer.grade_key!=="grade3")return j({error:"forbidden"},403);
 return j({ok:true,...await homeProgress(currentId,String(viewer.group_code??""))});
}const[cycles2,cycles2Azhar,cycles3]=await Promise.all([cycleCatalog("grade2"),cycleCatalog("grade2_azhar"),cycleCatalog("grade3")]);const[grade2,grade2Azhar,grade3]=await Promise.all([build("grade2",currentId,selected.grade2?String(selected.grade2):null),build("grade2_azhar",currentId,selected.grade2_azhar?String(selected.grade2_azhar):null),build("grade3",currentId,selected.grade3?String(selected.grade3):null)]);return j({ok:true,generated_at:new Date().toISOString(),profile:viewer,formula:{final:{comprehensive:80,readiness:20},readiness:{quizzes:40,platform:30,homework:20,attendance:10},platform:{method:"sum_best_scores_over_all_required_max",incomplete_counts_as_zero:true},quizzes:{method:"sum_actual_scores_over_sum_max_scores",absence_counts_as_zero:true},comprehensive:{source:"approved linked comprehensive_exam",absence_counts_as_zero:true},post_cutoff_affects_previous_round:false,source:"private.assessment_cycle_metrics or frozen assessment_cycle_snapshots + comprehensive_exams"},available_cycles:{grade2:cycles2,grade2_azhar:cycles2Azhar,grade3:cycles3},grades:{grade2,grade2_azhar:grade2Azhar,grade3}})}catch(e){console.error("student-honor-board",e);return j({error:"server_error",message:"تعذر تحميل لوحة الشرف."},500)}});
