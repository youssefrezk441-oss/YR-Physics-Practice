import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.105.0";
import postgres from "npm:postgres@3.4.7";

const C={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const url=Deno.env.get("SUPABASE_URL")??"";
const keys=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")??"{}");
const key=keys.default??Deno.env.get("SUPABASE_ANON_KEY")??"";
const db=Deno.env.get("SUPABASE_DB_URL")??"";
const authClient=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const sql=postgres(db,{prepare:false,max:3,idle_timeout:20});
const j=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...C,"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
const t=(v:any,n=120)=>typeof v==='string'?v.trim().slice(0,n):'';
const n=(v:any,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const trackOf=(v:any)=>['home','class','all'].includes(v)?v:'home';
async function requireAdmin(req:Request){
  const h=req.headers.get('Authorization')??''; if(!h.startsWith('Bearer '))return null;
  const {data,error}=await authClient.auth.getUser(h.slice(7)); if(error||!data.user)return null;
  const uid=data.user.id;
  const [r]=await sql`select public.admin_access_level('students',${uid}::uuid) as level`;
  if(!r||!['view','edit'].includes(String(r.level)))return null;
  return {user:data.user,level:String(r.level)};
}
function eligibleGradeSql(){return ""}
Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C});
  if(req.method!=='POST')return j({error:'method_not_allowed'},405);
  const admin=await requireAdmin(req); if(!admin)return j({error:'unauthorized'},401);
  let body:any={}; try{body=await req.json()}catch{return j({error:'invalid_json'},400)}
  const action=t(body.action,40), track=trackOf(body.track);
  const groupCode=t(body.group_code,40), skill=t(body.skill,10), q=t(body.query,120);
  const limit=Math.min(200,Math.max(1,n(body.limit,100))), offset=Math.max(0,n(body.offset,0));
  try{
    if(action==='ping')return j({ok:true,level:admin.level});

    if(action==='overview'){
      const [elig]=await sql`select count(*)::int as eligible_students from public.student_profiles sp left join public.student_groups sg on sg.group_code=sp.group_code where sp.is_active=true and (coalesce(sg.grade_level,sp.grade_level,'')='الصف الثالث الثانوي' or coalesce(sg.grade_level,sp.grade_level,'')='3 ثانوي' or coalesce(sg.grade_level,sp.grade_level,'') like '3%' or coalesce(sg.grade_level,sp.grade_level,'') like '%الثالث%') ${groupCode?sql`and sp.group_code=${groupCode}`:sql``}`;
      const [qcount]=await sql`select count(*)::int as questions from public.l4_workshop_questions q where q.active=true and (${track}='all' or q.track=${track}) ${skill?sql`and q.skill=${skill}`:sql``}`;
      const rows=await sql`
        with ep as (
          select sp.user_id,sp.student_code,sp.full_name,sp.group_code,coalesce(sp.center_name,sg.center_name) center_name
          from public.student_profiles sp left join public.student_groups sg on sg.group_code=sp.group_code
          where sp.is_active=true and (coalesce(sg.grade_level,sp.grade_level,'')='الصف الثالث الثانوي' or coalesce(sg.grade_level,sp.grade_level,'')='3 ثانوي' or coalesce(sg.grade_level,sp.grade_level,'') like '3%' or coalesce(sg.grade_level,sp.grade_level,'') like '%الثالث%')
          ${groupCode?sql`and sp.group_code=${groupCode}`:sql``}
        ), sq as (
          select q.bank_no,q.skill,q.track,q.question_type,case when q.grading_mode='mcq' then 1 else greatest(1,jsonb_array_length(coalesce(q.answer_schema->'parts','[]'::jsonb))) end expected_parts
          from public.l4_workshop_questions q where q.active=true and (${track}='all' or q.track=${track}) ${skill?sql`and q.skill=${skill}`:sql``}
        ), uq as (
          select ep.user_id,sq.bank_no,sq.skill,sq.expected_parts,
                 count(p.*)::int attempted_parts,
                 count(*) filter(where p.mastered or p.revealed)::int resolved_parts,
                 count(*) filter(where p.mastered)::int mastered_parts,
                 count(*) filter(where p.revealed)::int assisted_parts,
                 count(*) filter(where p.first_attempt_correct=true)::int first_correct_parts,
                 coalesce(sum(p.attempts_count),0)::int attempts
          from ep cross join sq left join public.l4_workshop_progress p on p.user_id=ep.user_id and p.bank_no=sq.bank_no
          group by ep.user_id,sq.bank_no,sq.skill,sq.expected_parts
        ), agg as (
          select user_id,
                 count(*) filter(where attempted_parts>0)::int attempted_questions,
                 count(*) filter(where resolved_parts>=expected_parts)::int completed_questions,
                 count(*) filter(where mastered_parts>=expected_parts)::int direct_mastered_questions,
                 count(*) filter(where resolved_parts>=expected_parts and assisted_parts>0)::int assisted_questions,
                 count(*) filter(where first_correct_parts>=expected_parts)::int first_correct_questions,
                 coalesce(sum(attempts),0)::int attempts
          from uq group by user_id
        )
        select count(*) filter(where attempted_questions>0)::int started_students,
               coalesce(sum(attempted_questions),0)::int attempted_questions,
               coalesce(sum(completed_questions),0)::int completed_questions,
               coalesce(sum(direct_mastered_questions),0)::int direct_mastered_questions,
               coalesce(sum(assisted_questions),0)::int assisted_questions,
               coalesce(sum(first_correct_questions),0)::int first_correct_questions,
               coalesce(sum(attempts),0)::int attempts
        from agg`;
      const a=rows[0]??{};
      const started=n(a.started_students), questions=n(qcount?.questions), attempted=n(a.attempted_questions), completed=n(a.completed_questions), first=n(a.first_correct_questions), direct=n(a.direct_mastered_questions), assisted=n(a.assisted_questions), attempts=n(a.attempts);
      const hardest=await sql`
        with sq as (select bank_no,skill,skill_name,question_type as difficulty,track,case when grading_mode='mcq' then 1 else greatest(1,jsonb_array_length(coalesce(answer_schema->'parts','[]'::jsonb))) end expected_parts from public.l4_workshop_questions where active=true and (${track}='all' or track=${track}) ${skill?sql`and skill=${skill}`:sql``}), uq as (
          select p.user_id,sq.bank_no,max(sq.skill) skill,max(sq.skill_name) skill_name,max(sq.difficulty) difficulty,max(sq.expected_parts) expected_parts,
                 count(*) filter(where p.first_attempt_correct=true)::int first_parts,
                 count(*) filter(where p.mastered or p.revealed)::int resolved_parts,
                 count(*)::int attempted_parts
          from sq join public.l4_workshop_progress p on p.bank_no=sq.bank_no join public.student_profiles sp on sp.user_id=p.user_id
          where (${groupCode}='' or sp.group_code=${groupCode}) group by p.user_id,sq.bank_no
        )
        select bank_no,max(skill) skill,max(skill_name) skill_name,max(difficulty) difficulty,
               count(*)::int students_attempted,
               round(100.0*count(*) filter(where first_parts>=expected_parts)/nullif(count(*),0),1)::float8 first_attempt_rate
        from uq where attempted_parts>0 group by bank_no order by first_attempt_rate asc nulls first,students_attempted desc,bank_no limit 10`;
      return j({ok:true,filters:{track,group_code:groupCode||null,skill:skill||null},overview:{eligible_students:n(elig?.eligible_students),started_students:started,participation_rate:n(elig?.eligible_students)?Math.round(started*1000/n(elig?.eligible_students))/10:0,questions,attempted_questions:attempted,completed_questions:completed,avg_completion_rate:started&&questions?Math.round(completed*1000/(started*questions))/10:0,first_attempt_rate:attempted?Math.round(first*1000/attempted)/10:0,direct_mastery_rate:attempted?Math.round(direct*1000/attempted)/10:0,assisted_rate:attempted?Math.round(assisted*1000/attempted)/10:0,avg_attempts_per_attempted_question:attempted?Math.round(attempts*100/attempted)/100:0},hardest_questions:hardest});
    }

    if(action==='students'){
      const rows=await sql`
        with sq as (select bank_no,case when grading_mode='mcq' then 1 else greatest(1,jsonb_array_length(coalesce(answer_schema->'parts','[]'::jsonb))) end expected_parts from public.l4_workshop_questions where active=true and (${track}='all' or track=${track}) ${skill?sql`and skill=${skill}`:sql``}), ep as (
          select sp.user_id,sp.student_code,sp.full_name,sp.group_code,coalesce(sp.center_name,sg.center_name) center_name
          from public.student_profiles sp left join public.student_groups sg on sg.group_code=sp.group_code
          where sp.is_active=true and (coalesce(sg.grade_level,sp.grade_level,'')='الصف الثالث الثانوي' or coalesce(sg.grade_level,sp.grade_level,'')='3 ثانوي' or coalesce(sg.grade_level,sp.grade_level,'') like '3%' or coalesce(sg.grade_level,sp.grade_level,'') like '%الثالث%')
          ${groupCode?sql`and sp.group_code=${groupCode}`:sql``}
          ${q?sql`and (coalesce(sp.full_name,'') ilike ${'%'+q+'%'} or coalesce(sp.student_code,'') ilike ${'%'+q+'%'})`:sql``}
        ), uq as (
          select ep.user_id,sq.bank_no,sq.expected_parts,count(p.*)::int attempted_parts,count(*) filter(where p.mastered or p.revealed)::int resolved_parts,count(*) filter(where p.mastered)::int mastered_parts,count(*) filter(where p.revealed)::int assisted_parts,count(*) filter(where p.first_attempt_correct=true)::int first_parts,coalesce(sum(p.attempts_count),0)::int attempts
          from ep cross join sq left join public.l4_workshop_progress p on p.user_id=ep.user_id and p.bank_no=sq.bank_no group by ep.user_id,sq.bank_no,sq.expected_parts
        ), a as (
          select user_id,count(*) filter(where attempted_parts>0)::int attempted_questions,count(*) filter(where resolved_parts>=expected_parts)::int completed_questions,count(*) filter(where mastered_parts>=expected_parts)::int direct_mastered_questions,count(*) filter(where resolved_parts>=expected_parts and assisted_parts>0)::int assisted_questions,count(*) filter(where first_parts>=expected_parts)::int first_correct_questions,coalesce(sum(attempts),0)::int attempts
          from uq group by user_id
        )
        select ep.*,coalesce(a.attempted_questions,0)::int attempted_questions,coalesce(a.completed_questions,0)::int completed_questions,coalesce(a.direct_mastered_questions,0)::int direct_mastered_questions,coalesce(a.assisted_questions,0)::int assisted_questions,coalesce(a.first_correct_questions,0)::int first_correct_questions,coalesce(a.attempts,0)::int attempts
        from ep left join a using(user_id) order by attempted_questions desc,full_name nulls last limit ${limit} offset ${offset}`;
      return j({ok:true,students:rows});
    }

    if(action==='student_detail'){
      const userId=t(body.user_id,60); if(!userId)return j({error:'missing_user_id'},400);
      const [profile]=await sql`select sp.user_id,sp.student_code,sp.full_name,sp.group_code,coalesce(sp.center_name,sg.center_name) center_name,coalesce(sg.grade_level,sp.grade_level) grade_level from public.student_profiles sp left join public.student_groups sg on sg.group_code=sp.group_code where sp.user_id=${userId}::uuid limit 1`;
      if(!profile)return j({error:'student_not_found'},404);
      const qrows=await sql`
        with sq as (select bank_no,skill,skill_name,question_type as difficulty,track,sort_order,question_type,case when grading_mode='mcq' then 1 else greatest(1,jsonb_array_length(coalesce(answer_schema->'parts','[]'::jsonb))) end expected_parts from public.l4_workshop_questions where active=true and (${track}='all' or track=${track}) ${skill?sql`and skill=${skill}`:sql``})
        select sq.bank_no,sq.skill,sq.skill_name,sq.difficulty,sq.track,sq.sort_order,sq.question_type,sq.expected_parts,
               count(p.*)::int attempted_parts,count(*) filter(where p.mastered or p.revealed)::int resolved_parts,count(*) filter(where p.mastered)::int mastered_parts,count(*) filter(where p.revealed)::int assisted_parts,count(*) filter(where p.first_attempt_correct=true)::int first_correct_parts,coalesce(sum(p.attempts_count),0)::int attempts,max(p.updated_at) last_activity
        from sq left join public.l4_workshop_progress p on p.bank_no=sq.bank_no and p.user_id=${userId}::uuid group by sq.bank_no,sq.skill,sq.skill_name,sq.difficulty,sq.track,sq.sort_order,sq.question_type,sq.expected_parts order by sq.sort_order,sq.bank_no`;
      const skills=await sql`
        with x as (
          select q.skill,max(q.skill_name) skill_name,q.bank_no,case when q.grading_mode='mcq' then 1 else greatest(1,jsonb_array_length(coalesce(q.answer_schema->'parts','[]'::jsonb))) end expected_parts,count(p.*)::int attempted_parts,count(*) filter(where p.mastered or p.revealed)::int resolved_parts,count(*) filter(where p.mastered)::int mastered_parts,count(*) filter(where p.revealed)::int assisted_parts,count(*) filter(where p.first_attempt_correct=true)::int first_parts
          from public.l4_workshop_questions q left join public.l4_workshop_progress p on p.bank_no=q.bank_no and p.user_id=${userId}::uuid where q.active=true and (${track}='all' or q.track=${track}) group by q.skill,q.bank_no,q.question_type,q.grading_mode,q.answer_schema
        ) select skill,max(skill_name) skill_name,count(*)::int questions,count(*) filter(where attempted_parts>0)::int attempted_questions,count(*) filter(where resolved_parts>=expected_parts)::int completed_questions,count(*) filter(where mastered_parts>=expected_parts)::int direct_mastered_questions,count(*) filter(where resolved_parts>=expected_parts and assisted_parts>0)::int assisted_questions,count(*) filter(where first_parts>=expected_parts)::int first_correct_questions from x group by skill order by skill`;
      return j({ok:true,profile,skills,questions:qrows});
    }

    if(action==='questions'){
      const rows=await sql`
        with base as (
          select q.bank_no,q.skill,q.skill_name,q.question_type as difficulty,q.track,q.sort_order,q.question_type,case when q.grading_mode='mcq' then 1 else greatest(1,jsonb_array_length(coalesce(q.answer_schema->'parts','[]'::jsonb))) end expected_parts,p.user_id,count(p.*)::int attempted_parts,count(*) filter(where p.mastered or p.revealed)::int resolved_parts,count(*) filter(where p.mastered)::int mastered_parts,count(*) filter(where p.revealed)::int assisted_parts,count(*) filter(where p.first_attempt_correct=true)::int first_parts,coalesce(sum(p.attempts_count),0)::int attempts
          from public.l4_workshop_questions q left join public.l4_workshop_progress p on p.bank_no=q.bank_no left join public.student_profiles sp on sp.user_id=p.user_id
          where q.active=true and (${track}='all' or q.track=${track}) ${skill?sql`and q.skill=${skill}`:sql``} ${q?sql`and cast(q.bank_no as text) ilike ${'%'+q+'%'}`:sql``} and (${groupCode}='' or sp.group_code=${groupCode} or p.user_id is null)
          group by q.bank_no,q.skill,q.skill_name,q.question_type,q.track,q.sort_order,q.grading_mode,q.answer_schema,p.user_id
        )
        select bank_no,max(skill) skill,max(skill_name) skill_name,max(difficulty) difficulty,max(track) track,max(sort_order)::int sort_order,max(question_type) question_type,
               count(*) filter(where attempted_parts>0)::int students_attempted,
               round(100.0*count(*) filter(where first_parts>=expected_parts)/nullif(count(*) filter(where attempted_parts>0),0),1)::float8 first_attempt_rate,
               round(100.0*count(*) filter(where mastered_parts>=expected_parts)/nullif(count(*) filter(where attempted_parts>0),0),1)::float8 direct_mastery_rate,
               round(100.0*count(*) filter(where resolved_parts>=expected_parts and assisted_parts>0)/nullif(count(*) filter(where attempted_parts>0),0),1)::float8 assisted_rate,
               round(sum(attempts)::numeric/nullif(count(*) filter(where attempted_parts>0),0),2)::float8 avg_attempts
        from base group by bank_no order by sort_order,bank_no limit ${limit} offset ${offset}`;
      return j({ok:true,questions:rows});
    }

    if(action==='question_detail'){
      const bankNo=n(body.bank_no,-1); if(bankNo<0)return j({error:'missing_bank_no'},400);
      const [info]=await sql`select q.bank_no,q.skill,q.skill_name,q.question_type as difficulty,q.track,q.sort_order,q.question_type,k.display_answer from public.l4_workshop_questions q left join private.l4_workshop_keys k on k.bank_no=q.bank_no and k.verified=true where q.bank_no=${bankNo} limit 1`;
      if(!info)return j({error:'question_not_found'},404);
      const students=await sql`
        select sp.user_id,sp.student_code,sp.full_name,sp.group_code,coalesce(sp.center_name,sg.center_name) center_name,p.part_key,p.attempts_count,p.first_attempt_correct,p.mastered,p.revealed,p.tried_answers,p.last_answer,p.updated_at
        from public.l4_workshop_progress p join public.student_profiles sp on sp.user_id=p.user_id left join public.student_groups sg on sg.group_code=sp.group_code where p.bank_no=${bankNo} ${groupCode?sql`and sp.group_code=${groupCode}`:sql``} order by sp.full_name,p.part_key`;
      const dist=await sql`select part_key,answer_json->>'normalized' answer_text,count(*)::int attempts,count(*) filter(where is_correct=true)::int correct_attempts,count(*) filter(where is_correct=false)::int wrong_attempts from public.l4_workshop_events e join public.student_profiles sp on sp.user_id=e.user_id where e.bank_no=${bankNo} and e.event_type='attempt' ${groupCode?sql`and sp.group_code=${groupCode}`:sql``} group by part_key,answer_json->>'normalized' order by part_key,attempts desc,answer_text`;
      return j({ok:true,question:info,students,answer_distribution:dist});
    }

    if(action==='groups'){
      const rows=await sql`
        with ep as (
          select sp.user_id,sp.group_code,coalesce(sp.center_name,sg.center_name) center_name from public.student_profiles sp left join public.student_groups sg on sg.group_code=sp.group_code where sp.is_active=true and (coalesce(sg.grade_level,sp.grade_level,'')='الصف الثالث الثانوي' or coalesce(sg.grade_level,sp.grade_level,'')='3 ثانوي' or coalesce(sg.grade_level,sp.grade_level,'') like '3%' or coalesce(sg.grade_level,sp.grade_level,'') like '%الثالث%')
        ), sq as (select bank_no,case when grading_mode='mcq' then 1 else greatest(1,jsonb_array_length(coalesce(answer_schema->'parts','[]'::jsonb))) end expected_parts from public.l4_workshop_questions where active=true and (${track}='all' or track=${track}) ${skill?sql`and skill=${skill}`:sql``}), uq as (
          select ep.group_code,max(ep.center_name) center_name,ep.user_id,sq.bank_no,sq.expected_parts,count(p.*)::int attempted_parts,count(*) filter(where p.mastered or p.revealed)::int resolved_parts,count(*) filter(where p.mastered)::int mastered_parts,count(*) filter(where p.revealed)::int assisted_parts,count(*) filter(where p.first_attempt_correct=true)::int first_parts
          from ep cross join sq left join public.l4_workshop_progress p on p.user_id=ep.user_id and p.bank_no=sq.bank_no group by ep.group_code,ep.user_id,sq.bank_no,sq.expected_parts
        ), student_a as (
          select group_code,max(center_name) center_name,user_id,count(*) filter(where attempted_parts>0)::int attempted_questions,count(*) filter(where resolved_parts>=expected_parts)::int completed_questions,count(*) filter(where mastered_parts>=expected_parts)::int direct_mastered_questions,count(*) filter(where resolved_parts>=expected_parts and assisted_parts>0)::int assisted_questions,count(*) filter(where first_parts>=expected_parts)::int first_correct_questions from uq group by group_code,user_id
        )
        select group_code,max(center_name) center_name,count(*)::int students,count(*) filter(where attempted_questions>0)::int started_students,round(avg(completed_questions)::numeric,1)::float8 avg_completed_questions,round(100.0*sum(first_correct_questions)/nullif(sum(attempted_questions),0),1)::float8 first_attempt_rate,round(100.0*sum(direct_mastered_questions)/nullif(sum(attempted_questions),0),1)::float8 direct_mastery_rate,round(100.0*sum(assisted_questions)/nullif(sum(attempted_questions),0),1)::float8 assisted_rate from student_a group by group_code order by group_code`;
      return j({ok:true,groups:rows});
    }

    if(action==='skills'){
      const rows=await sql`
        with base as (
          select q.skill,q.skill_name,q.bank_no,case when q.grading_mode='mcq' then 1 else greatest(1,jsonb_array_length(coalesce(q.answer_schema->'parts','[]'::jsonb))) end expected_parts,p.user_id,count(p.*)::int attempted_parts,count(*) filter(where p.mastered or p.revealed)::int resolved_parts,count(*) filter(where p.mastered)::int mastered_parts,count(*) filter(where p.revealed)::int assisted_parts,count(*) filter(where p.first_attempt_correct=true)::int first_parts
          from public.l4_workshop_questions q left join public.l4_workshop_progress p on p.bank_no=q.bank_no left join public.student_profiles sp on sp.user_id=p.user_id
          where q.active=true and (${track}='all' or q.track=${track}) and (${groupCode}='' or sp.group_code=${groupCode} or p.user_id is null) group by q.skill,q.skill_name,q.bank_no,q.question_type,q.grading_mode,q.answer_schema,p.user_id
        ) select skill,max(skill_name) skill_name,count(distinct bank_no)::int questions,count(*) filter(where attempted_parts>0)::int student_question_attempts,round(100.0*count(*) filter(where first_parts>=expected_parts)/nullif(count(*) filter(where attempted_parts>0),0),1)::float8 first_attempt_rate,round(100.0*count(*) filter(where mastered_parts>=expected_parts)/nullif(count(*) filter(where attempted_parts>0),0),1)::float8 direct_mastery_rate,round(100.0*count(*) filter(where resolved_parts>=expected_parts and assisted_parts>0)/nullif(count(*) filter(where attempted_parts>0),0),1)::float8 assisted_rate from base group by skill order by skill`;
      return j({ok:true,skills:rows});
    }

    return j({error:'unknown_action'},400);
  }catch(e){console.error('admin-l4-workshop-analytics',e);return j({error:'server_error',message:'تعذر تحميل التحليل الآن.'},500)}
});
