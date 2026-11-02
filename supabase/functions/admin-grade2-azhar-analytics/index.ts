import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.105.0";
import postgres from "npm:postgres@3.4.7";

// Read-only, owner-only statistics for grade 2 Azhar. Never return answer keys, answer payloads or contact information.
const U=Deno.env.get("SUPABASE_URL")||"";
const A=Deno.env.get("SUPABASE_ANON_KEY")||"";
const db=postgres(Deno.env.get("SUPABASE_DB_URL")||"",{prepare:false,max:3,idle_timeout:20});
const auth=createClient(U,A,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const origins=new Set(["https://youssefrezk441-oss.github.io","http://localhost:8000","http://127.0.0.1:8000"]);
const headers=req=>({"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store, private","Vary":"Origin","Access-Control-Allow-Origin":origins.has(req.headers.get("origin")||"")?req.headers.get("origin"):"https://youssefrezk441-oss.github.io","Access-Control-Allow-Headers":"authorization,apikey,x-client-info,content-type","Access-Control-Allow-Methods":"POST,OPTIONS"});
const reply=(req,body,status=200)=>new Response(JSON.stringify(body),{status,headers:headers(req)});
async function requireOwner(req){
 const token=req.headers.get("authorization")||"";
 if(!token.startsWith("Bearer "))return false;
 const {data,error}=await auth.auth.getUser(token.slice(7));
 const user=data?.user;
 if(error||!user||user.app_metadata?.role!=="admin")return false;
 const [profile]=await db\`select is_owner,is_active from public.admin_profiles where user_id=\${user.id}::uuid limit 1\`;
 return profile?.is_owner===true&&profile?.is_active===true;
}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:headers(req)});
 if(req.method!=="POST")return reply(req,{error:"method_not_allowed"},405);
 try{
  if(!await requireOwner(req))return reply(req,{error:"owner_only",message:"هذه التحليلات متاحة لصاحب إدارة المنصة فقط"},403);
  const body=await req.json().catch(()=>({}));
  if(body?.action!=="snapshot")return reply(req,{error:"unsupported_action"},400);
  const [students,activities,parts,attempts,answers]=await Promise.all([
   db\`select sp.user_id::text as user_id,sp.student_code,sp.full_name,
      sp.group_code,sp.is_active as student_active,sg.is_active as group_active,
      sg.center_name
      from public.student_profiles sp join public.student_groups sg on sg.group_code=sp.group_code
      where sg.education_track='azhar' and sg.grade_level='الصف الثاني الثانوي'
      order by sp.group_code,sp.full_name,sp.user_id\`,
   db\`select slug,title,chapter,mode,status,published_at
      from private.g2_activities where slug like 'g2-azhar-%' and status='published'
      order by chapter,mode,slug\`,
   db\`select distinct on(k.activity_slug,k.bank_id,k.part_key)
      k.activity_slug,k.bank_id,k.part_key,k.max_points::float8 as max_points,
      (k.rubric is not null) as essay,q.skill_ref,q.sort_order
      from private.g2_keys k join private.g2_questions q
       on q.activity_slug=k.activity_slug and q.bank_id=k.bank_id
      join private.g2_activities a on a.slug=k.activity_slug
      where k.key_status='approved' and a.status='published' and a.slug like 'g2-azhar-%'
      order by k.activity_slug,k.bank_id,k.part_key,k.version_no desc\`,
   db\`select a.id::text as id,a.user_id::text as user_id,a.activity_slug,a.state,
      a.started_at,a.submitted_at
      from private.g2_attempts a join public.student_profiles sp on sp.user_id=a.user_id
      join public.student_groups sg on sg.group_code=sp.group_code
      join private.g2_activities act on act.slug=a.activity_slug
      where sg.education_track='azhar' and sg.grade_level='الصف الثاني الثانوي'
       and act.status='published' and act.slug like 'g2-azhar-%'
      order by a.started_at desc\`,
   db\`with latest as (
       select distinct on (e.attempt_id,e.bank_id,e.part_key)
        e.id,e.attempt_id,e.bank_id,e.part_key,e.revision,e.submitted_at
       from private.g2_answer_events e
       join private.g2_attempts a on a.id=e.attempt_id
       join public.student_profiles sp on sp.user_id=a.user_id
       join public.student_groups sg on sg.group_code=sp.group_code
       join private.g2_activities act on act.slug=a.activity_slug
       where sg.education_track='azhar' and sg.grade_level='الصف الثاني الثانوي'
         and act.status='published' and act.slug like 'g2-azhar-%'
       order by e.attempt_id,e.bank_id,e.part_key,e.revision desc,e.submitted_at desc,e.id desc
      )
      select e.attempt_id::text as attempt_id,e.bank_id,e.part_key,e.revision,
       e.submitted_at, d.awarded_points::float8 as awarded_points,
       d.max_points::float8 as decision_max,d.method
      from latest e left join lateral (
       select d.awarded_points,d.max_points,d.method from private.g2_grading_decisions d
       where d.answer_event_id=e.id order by d.created_at desc,d.id desc limit 1
      ) d on true\`
  ]);
  return reply(req,{ok:true,generated_at:new Date().toISOString(),scope:"grade2_azhar",
    privacy:"owner_only_no_raw_answers",students,activities,parts,attempts,answers});
 }catch(e){
  console.error("grade2-analytics",e instanceof Error?e.name:"error");
  return reply(req,{error:"analytics_unavailable",message:"تعذر تحميل التحليلات، حاول إعادة التحديث."},500);
 }
});