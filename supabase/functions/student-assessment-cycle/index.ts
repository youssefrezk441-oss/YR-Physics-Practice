import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.105.0";
import postgres from "npm:postgres@3.4.7";

const C={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS"
};
const url=Deno.env.get("SUPABASE_URL")??"";
const keys=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")??"{}");
const key=keys.default??Deno.env.get("SUPABASE_ANON_KEY")??"";
const db=Deno.env.get("SUPABASE_DB_URL")??"";
const auth=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const sql=postgres(db,{prepare:false,max:1,idle_timeout:20});
const j=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...C,"Content-Type":"application/json; charset=utf-8"}});
const r1=(n:any)=>Math.round((Number(n)+1e-9)*10)/10;
const dateOut=(v:any)=>{if(v==null)return null;if(v instanceof Date)return v.toISOString().slice(0,10);const s=String(v),m=s.match(/^\d{4}-\d{2}-\d{2}/);return m?m[0]:s};

function canon(v:any){
  const s=String(v??"");
  if(s==="3 ثانوي"||s==="الصف الثالث الثانوي")return "الصف الثالث الثانوي";
  if(s==="2 ثانوي"||s==="الصف الثاني الثانوي")return "الصف الثاني الثانوي";
  return s;
}
function trackFor(groupCode:any,grade:any){
  if(grade!=="الصف الثاني الثانوي")return "all";
  return /-B$/i.test(String(groupCode??""))?"azhar":"baccalaureate";
}
function trackLabel(t:string){
  return t==="azhar"?"أزهر":t==="baccalaureate"?"بكالوريا":"عام";
}

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:C});
  if(req.method!=="POST")return j({error:"method_not_allowed"},405);

  const h=req.headers.get("Authorization")??"";
  if(!h.startsWith("Bearer "))return j({error:"unauthorized"},401);
  const {data,error}=await auth.auth.getUser(h.slice(7));
  if(error||!data.user)return j({error:"unauthorized"},401);
  const u=data.user;
  if(u.app_metadata?.role!=="student")return j({error:"student_only"},403);

  try{
    let body:any={};
    try{body=await req.json()}catch{}

    const [p]=await sql`
      select sp.student_code,sp.full_name,sp.grade_level,sp.group_code,sp.center_name,sp.is_active,
             sg.grade_level group_grade
      from public.student_profiles sp
      left join public.student_groups sg on sg.group_code=sp.group_code
      where sp.user_id=${u.id}::uuid
    `;
    if(!p?.is_active)return j({error:"inactive_student"},403);

    const g=canon(p.group_grade??p.grade_level);
    const track=trackFor(p.group_code,g);
    const requested=String(body?.cycle_id??body?.cycle_code??body?.cycle??"").trim();

    let cycles:any[]=[];
    if(requested){
      cycles=await sql`
        select id,cycle_code,title,grade_level,education_track,start_at,cutoff_at,
               comprehensive_exam_date,comprehensive_exam_id,status,weights,created_at
        from public.assessment_cycles
        where grade_level=${g}
          and education_track=${track}
          and (id::text=${requested} or cycle_code=${requested})
        limit 1
      `;
    }
    if(!cycles.length){
      cycles=await sql`
        select id,cycle_code,title,grade_level,education_track,start_at,cutoff_at,
               comprehensive_exam_date,comprehensive_exam_id,status,weights,created_at
        from public.assessment_cycles
        where grade_level=${g}
          and education_track=${track}
        order by (status='open') desc,start_at desc,created_at desc
        limit 1
      `;
    }
    const c=cycles[0];
    if(!c)return j({ok:true,profile:p,cycle:null,message:"لا توجد دورة تقييم مسجلة لهذه السنة الدراسية."});

    const [snapMeta]=await sql`
      select count(*)::int n,max(frozen_at) frozen_at
      from public.assessment_cycle_snapshots
      where cycle_id=${c.id}::uuid
    `;
    const archived=Number(snapMeta?.n||0)>0;

    let m:any=null;
    if(archived){
      const [sr]=await sql`
        select metrics m
        from public.assessment_cycle_snapshots
        where cycle_id=${c.id}::uuid and user_id=${u.id}::uuid
        limit 1
      `;
      m=sr?.m??null;
    }else{
      const rr=await sql`select private.assessment_cycle_metrics(${c.id}::uuid) m`;
      m=rr.map((x:any)=>x.m).find((x:any)=>String(x.user_id)===String(u.id))??null;
    }
    if(!m)return j({error:"student_not_in_cycle"},404);

    let hwBreak:any={mastered:null,done:null,partial:null,not_submitted:null,legacy_done:null};
    if(!archived){
      [hwBreak]=await sql`
        select
          count(*) filter(where cs.has_homework and ssr.homework_status='mastered')::int mastered,
          count(*) filter(where cs.has_homework and ssr.homework_status='done')::int done,
          count(*) filter(where cs.has_homework and ssr.homework_status='partial')::int partial,
          count(*) filter(where cs.has_homework and ssr.homework_status='not_submitted')::int not_submitted,
          count(*) filter(where cs.has_homework and ssr.homework_status='legacy_done')::int legacy_done
        from public.assessment_cycle_sessions acs
        join public.class_sessions cs on cs.id=acs.session_id
        join public.session_student_records ssr on ssr.session_id=cs.id and ssr.user_id=${u.id}::uuid
        where acs.cycle_id=${c.id}::uuid
      `;
    }

    let postBreak:any={new_count:null,repeat_count:null};
    if(!archived&&c.cutoff_at){
      [postBreak]=await sql`
        with base as(
          select distinct a.training_set_id,a.submitted_at
          from public.attempts a
          join public.assessment_cycle_training_sets acts
            on acts.training_set_id=a.training_set_id
           and acts.cycle_id=${c.id}::uuid
           and acts.evaluation_role='preparation'
          where a.user_id=${u.id}::uuid
            and a.submitted_at is not null
            and a.submitted_at>=${c.start_at}::timestamptz
        ),
        pre as(select distinct training_set_id from base where submitted_at<${c.cutoff_at}::timestamptz),
        post as(select distinct training_set_id from base where submitted_at>=${c.cutoff_at}::timestamptz)
        select
          count(*) filter(where not exists(select 1 from pre where pre.training_set_id=post.training_set_id))::int new_count,
          count(*) filter(where exists(select 1 from pre where pre.training_set_id=post.training_set_id))::int repeat_count
        from post
      `;
    }

    let comp:any={status:"not_entered",score:null,max_score:null,percentage:null,test_name:"الامتحان الشامل"};
    let exam:any=null;

    if(archived){
      const st=String(m.snapshot_comprehensive_status??"pending");
      const max=m.snapshot_comprehensive_max==null?null:Number(m.snapshot_comprehensive_max);
      const earned=m.snapshot_comprehensive_earned==null?null:Number(m.snapshot_comprehensive_earned);
      const pct=m.snapshot_comprehensive_score==null?null:Number(m.snapshot_comprehensive_score);
      comp={
        status:st==="pending"?"not_entered":st,
        score:earned,
        max_score:max,
        percentage:pct,
        test_name:m.snapshot_exam_title??"الامتحان الشامل"
      };
      exam={
        title:m.snapshot_exam_title??null,
        exam_date:m.snapshot_exam_date??c.comprehensive_exam_date,
        status:m.snapshot_exam_status??null,
        max_score:max
      };
    }else if(c.comprehensive_exam_id){
      [exam]=await sql`
        select id,title,exam_date,max_score,status
        from public.comprehensive_exams
        where id=${c.comprehensive_exam_id}::uuid
      `;
      if(exam?.status==="approved"){
        const [x]=await sql`
          select status,score
          from public.comprehensive_exam_results
          where exam_id=${exam.id}::uuid and user_id=${u.id}::uuid
        `;
        if(x){
          comp={
            status:x.status==="pending"?"not_entered":x.status,
            score:x.status==="absent"?0:x.score==null?null:Number(x.score),
            max_score:Number(exam.max_score),
            percentage:x.status==="absent"?0:x.status==="scored"?r1(Number(x.score)/Number(exam.max_score)*100):null,
            test_name:exam.title
          };
        }
      }
    }

    const chapter2 = c.weights?.assessment_model === "chapter2_sources";
    const weightKeys = ["attendance", "homework", "quizzes", "platform"];
    if (chapter2) weightKeys.push("online_homework");
    const approved = weightKeys.every(key => c.weights?.[key] != null && Number.isFinite(Number(c.weights[key])))
      && Math.abs(weightKeys.reduce((sum,key) => sum + Number(c.weights?.[key] || 0),0)-100)<.001;

    const readinessReason=archived
      ?"هذه نتيجة مؤرشفة وثابتة لهذه الدورة."
      :m.readiness_score!=null
        ?"مؤشر الاستعداد مكتمل لهذه الجولة."
        :Number(m.pending_essay_answers||0)>0
          ?"توجد إجابات مقالية قبل الشامل ما زالت تنتظر المراجعة."
          :Number(m.pending_platform_attempts||0)>0
            ?"توجد محاولات منصة قبل الشامل لم تعتمد نهائيًا بعد."
            :Number(m.quiz_pending||0)>0
              ?"توجد كويزات لم تسجل حالتها بعد."
              :Number(m.homework_unknown||0)>0
                ?"توجد حالات واجب غير مسجلة وتُحسب صفرًا حتى تصحيحها."
                :"لا توجد بيانات كافية لحساب كل المكونات.";

    return j({
      ok:true,
      profile:{...p,grade_level:g,education_track:track,education_track_label:trackLabel(track)},
      cycle:{
        id:c.id,code:c.cycle_code,title:c.title,grade_level:c.grade_level,
        education_track:c.education_track,education_track_label:trackLabel(c.education_track),
        start_at:c.start_at,cutoff_at:c.cutoff_at,
        exam_date:dateOut(exam?.exam_date??c.comprehensive_exam_date),
        status:c.status,weights:c.weights||{},weights_approved:approved,
        comprehensive_exam_status:exam?.status??null,
        archived,
        source:archived?"snapshot":"live",
        frozen_at:archived?snapMeta?.frozen_at:null
      },
      pre_comprehensive:{
        attendance:{rate:m.attendance_rate,total_sessions:m.total_sessions,present:m.present,absent:m.absent},
        homework:{
          rate:m.homework_rate,eligible:m.homework_known,unknown:m.homework_unknown,
          mastered:hwBreak?.mastered??null,done:hwBreak?.done??null,partial:hwBreak?.partial??null,
          not_submitted:hwBreak?.not_submitted??null,legacy_done:hwBreak?.legacy_done??null,
          detail_available:!archived
        },
        quizzes:{
          earned_score:m.quiz_earned,possible_score:m.quiz_possible,
          average_actual_score:m.quiz_avg_score,average_actual_max:m.quiz_avg_max,
          score_ratio:m.quiz_ratio,recorded_tests:Number(m.quiz_scored||0)+Number(m.quiz_absent||0),
          scored_tests:m.quiz_scored,absent_tests:m.quiz_absent,pending_tests:m.quiz_pending
        },
        platform:{
          completed_trainings:m.platform_completed,available_trainings:m.platform_available,
          completion_rate:m.platform_completion_rate,graded_trainings:m.platform_graded_sets,
          quality_ratio:m.platform_quality_ratio,score:m.platform_score,
          earned_score:m.platform_best_score_sum,total_possible_score:m.platform_total_possible,
          pending_attempts:archived?0:m.pending_platform_attempts
        },
        ...(chapter2 ? { online_homework: {
          rate: m.online_homework_rate,
          submitted: m.online_homework_submitted,
          counted: m.online_homework_counted,
          available: m.online_homework_available
        }} : {}),
        pending_essay_answers:archived?0:m.pending_essay_answers,
        pending_essay_attempts:archived?0:m.pending_essay_attempts,
        data_complete:m.data_complete,
        readiness_score:m.readiness_score,
        readiness_reason:readinessReason
      },
      after_comprehensive:{
        attempts:m.post_cutoff_attempts,
        completed_trainings:m.post_cutoff_trainings,
        new_trainings_after_cutoff:postBreak?.new_count??null,
        repeated_trainings_after_cutoff:postBreak?.repeat_count??null,
        affects_previous_evaluation:false,
        detail_available:!archived
      },
      comprehensive:[comp],
      calculation_rules:{
        source:archived?"assessment_cycle_snapshots":"private.assessment_cycle_metrics + approved comprehensive_exams",
        readiness:{
          quizzes:Number(c.weights?.quizzes??40),
          platform:Number(c.weights?.platform??30),
          homework:Number(c.weights?.homework??20),
          attendance:Number(c.weights?.attendance??10),
          ...(chapter2 ? { online_homework: Number(c.weights.online_homework) } : {})
        },
        homework:{mastered:100,done:80,partial:50,not_submitted:0,legacy_done:100,assigned_homework_always_counted:true,unknown_counts_as_zero:true},
        platform:{
          method:chapter2?"chapter2_first_class_attempt_and_final_home_submission":"sum_best_scores_over_total_possible_all_required_trainings",
          incomplete_training_counts_as_zero:true,
          completion_rate_is_diagnostic_only:true,
          quality_ratio_is_diagnostic_only:true,
          quality_method:"sum_best_scores_over_sum_max_of_completed_graded_trainings"
        },
        quiz_method:"sum_actual_scores_over_sum_max_scores_with_absence_zero",
        quiz_absence_counts_as_zero:true,
        comprehensive_release_requires_approval:true,
        platform_reference_time:chapter2?"workshop_attempt_events.server_received_at or workshop_submissions.submitted_at":"attempts.submitted_at",
        review_approval_time_affects_cycle:false,
        cutoff_timezone:"Africa/Cairo",
        post_cutoff_excluded:true,
        archived_cycles_use_frozen_snapshot:true
      }
    });
  }catch(e){
    console.error("student-assessment-cycle",e);
    return j({error:"server_error",message:"تعذر تحميل تقييم دورة الشامل."},500);
  }
});
