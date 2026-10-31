import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.105.0";
import postgres from "npm:postgres@3.4.7";
const U=Deno.env.get("SUPABASE_URL")||"",A=Deno.env.get("SUPABASE_ANON_KEY")||"",S=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const auth=createClient(U,A,{auth:{persistSession:false,autoRefreshToken:false}});
const storage=createClient(U,S,{auth:{persistSession:false,autoRefreshToken:false}}).storage;
const sql=postgres(Deno.env.get("SUPABASE_DB_URL")||"",{prepare:false,max:4,idle_timeout:20});
class E extends Error{constructor(status,code,message){super(message);this.status=status;this.code=code}}
const origins=new Set(["https://youssefrezk441-oss.github.io","http://localhost:8000","http://127.0.0.1:8000"]);
const headers=r=>({"Content-Type":"application/json;charset=utf-8","Cache-Control":"no-store","Vary":"Origin","Access-Control-Allow-Origin":origins.has(r.headers.get("origin")||"")?r.headers.get("origin"):"https://youssefrezk441-oss.github.io","Access-Control-Allow-Headers":"authorization,apikey,x-client-info,content-type","Access-Control-Allow-Methods":"POST,OPTIONS"});
const send=(r,x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:headers(r)});
const str=(x,n=100)=>String(x??"").trim().slice(0,n);
const uid=x=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
const norm=x=>({"ا":"أ","أ":"أ","إ":"أ","آ":"أ","1":"أ","A":"أ","a":"أ","ب":"ب","2":"ب","B":"ب","b":"ب","ج":"ج","3":"ج","C":"ج","c":"ج","د":"د","4":"د","D":"د","d":"د"})[str(x,8).replace(/[\s.,،:;]/g,"")]||null;
async function who(r){
 const token=r.headers.get("authorization")||"";if(!token.startsWith("Bearer "))throw new E(401,"login_required","سجل الدخول أولًا");
 const {data,error}=await auth.auth.getUser(token.slice(7));if(error||!data?.user)throw new E(401,"bad_session","جلسة غير صالحة");
 const u=data.user;
 if(u.app_metadata?.role==="admin"){const [a]=await sql`select is_active,is_owner from public.admin_profiles where user_id=${u.id}::uuid limit 1`;return {u,admin:!!a?.is_active&&!!a?.is_owner,p:null}}
 if(u.app_metadata?.role!=="student")throw new E(403,"role","الحساب غير مصرح له");
 const [p]=await sql`select sp.grade_level,sp.group_code,sp.is_active,sg.is_active as group_active,sg.education_track from public.student_profiles sp left join public.student_groups sg on sg.group_code=sp.group_code where sp.user_id=${u.id}::uuid limit 1`;
 if(!p?.is_active||!p?.group_active)throw new E(403,"inactive","الحساب أو المجموعة غير نشط");return {u,admin:false,p};
}
const permitted=(a,p)=>Boolean(a?.status==="published"&&p?.education_track==="azhar"&&p?.is_active&&p?.group_active&&/الثاني|second|2_secondary|^2$/i.test(String(p.grade_level))&&Array.isArray(a.eligible_group_codes)&&a.eligible_group_codes.length&&a.eligible_group_codes.includes(p.group_code)&&["content_verified","images_verified","keys_verified"].every(k=>a[k]===true)&&(a.rubrics_verified===true||a.provisional_manual_grading===true)&&(a.staging_verified===true||a.provisional_live_pilot===true));
const clean=(type,v)=>{
 if(type==="mcq"){const n=norm(v);if(!n)throw new E(400,"choice","اختيار غير صالح");return {choice:n}}
 if(!["text","numeric","symbolic"].includes(type))throw new E(400,"type","نوع السؤال غير مدعوم");
 if(v?.image_only===true&&Object.keys(v).length===1)return {image_only:true};
 if(!["string","number"].includes(typeof v)||!str(v,5001)||String(v).length>5000)throw new E(400,"answer","إجابة غير صالحة");
 return {text:String(v).trim()};
};
async function getKey(slug,bank,part){const [k]=await sql`select * from private.g2_keys where activity_slug=${slug} and bank_id=${bank} and part_key=${part} and key_status='approved' order by version_no desc limit 1`;return k}
async function attempt(slug,user){const [a]=await sql`insert into private.g2_attempts(activity_slug,user_id) values(${slug},${user}::uuid) on conflict(activity_slug,user_id) do update set started_at=private.g2_attempts.started_at returning *`;return a}
function rubric(c,points){if(!Array.isArray(c)||!c.length||!points||typeof points!=="object"||Array.isArray(points))throw new E(409,"rubric","المعيار غير متاح");let sum=0,max=0;const ids=new Set();for(const p of c){const id=str(p.criterion_id),v=points[id],m=Number(p.points);if(!id||ids.has(id)||!(m>0)||typeof v!=="number"||!Number.isFinite(v)||v<0||v>m||Math.abs(v*4-Math.round(v*4))>1e-7)throw new E(400,"points","درجات البنود غير صحيحة");ids.add(id);sum+=v;max+=m}if(Object.keys(points).some(id=>!ids.has(id)))throw new E(400,"extra","بند غير معروف");return {sum,max}}
Deno.serve(async r=>{
 if(r.method==="OPTIONS")return new Response(null,{status:204,headers:headers(r)});
 if(r.method!=="POST")return send(r,{error:"method"},405);
 try{
  const c=await who(r);const l=Number(r.headers.get("content-length")||0);if(l>5600000)throw new E(413,"size","الطلب كبير");
  const raw=await r.text();if(raw.length>5600000)throw new E(413,"size","الطلب كبير");
  let b;try{b=JSON.parse(raw)}catch{throw new E(400,"json","طلب غير صالح")}if(!b||Array.isArray(b)||typeof b!=="object")throw new E(400,"json","طلب غير صالح");
  const op=str(b.action,40);


  if(["owner_exam_status","owner_import_exam_bank","owner_prepare_exams","owner_publish_exams"].includes(op)){
   if(!c.admin)throw new E(403,"owner_only","استيراد الامتحانات لصاحب الإدارة فقط");
   const examSlugs=["g2-azhar-ch01-exam","g2-azhar-ch02-exam","g2-azhar-ch03-exam","g2-azhar-chapters-1-3-exam"];
   const expected=[15,14,9,18],target=new Set(examSlugs);
   const stats=async()=>{
    const [q]=await sql`select count(*)::int as n from private.g2_questions where activity_slug=any(${examSlugs})`;
    const [k]=await sql`select count(*)::int as n,count(*) filter(where rubric is not null)::int as essay from private.g2_keys where key_status='approved' and activity_slug=any(${examSlugs})`;
    const [img]=await sql`select count(*)::int as n from private.g2_questions q where q.activity_slug=any(${examSlugs}) and exists(select 1 from storage.objects o where o.bucket_id='g2-question-images' and o.name=q.image_path)`;
    return {questions:q.n,keys:k.n,essay_parts:k.essay,images:img.n};
   };
   if(op==="owner_exam_status")return send(r,{ok:true,...await stats()});
   if(op==="owner_import_exam_bank"){
    if(b.confirm_source_keys!=="PROVISIONAL_EXAMS"||!Array.isArray(b.questions)||!Array.isArray(b.keys)||b.questions.length!==56||b.keys.length!==66)
      throw new E(400,"invalid_exam_package","حزمة الامتحانات أو تأكيد المفاتيح غير صحيح");
    const reserved=await sql`select activity_slug,bank_id from private.g2_exam_reservations`;
    if(reserved.length!==56)throw new E(409,"exam_blueprint_missing","حجز أسئلة الامتحانات غير مكتمل");
    const allowed=new Set(reserved.map(x=>x.activity_slug+":"+x.bank_id)),count=[0,0,0,0],parts=new Map(),qs=[],ks=[];
    for(const q of b.questions){
     const slug=str(q.workshop_slug,100),id=str(q.id,35),ix=examSlugs.indexOf(slug);
     if(ix<0||!allowed.has(slug+":"+id)||!/^F[1-5]-(H|E)-\d\d$/.test(id)||!Array.isArray(q.parts)||!q.parts.length||
        !/^[a-f0-9]{64}$/.test(String(q.image_sha256))||
        q.image_path!==`assets/grade2/${slug}/${id}.png`)throw new E(400,"bad_exam_question","سؤال أو بصمة غير صالحة");
     count[ix]++;
     for(const p of q.parts){
      if(!["mcq","text"].includes(p.input_type)||!str(p.key,90))throw new E(400,"part_type","جزء سؤال غير صالح");
      const key=slug+":"+id+":"+p.key;
      if(parts.has(key))throw new E(400,"duplicate_part","تكرار جزء سؤال");
      parts.set(key,p.input_type);
     }
     qs.push({activity_slug:slug,bank_id:id,prompt:null,parts_public:q.parts,image_path:q.image_path,image_sha256:q.image_sha256,skill_ref:str(q.skill,150)||"unclassified",sort_order:count[ix]});
    }
    if(count.some((n,i)=>n!==expected[i])||parts.size!==66)throw new E(400,"exam_distribution","توزيع الامتحانات غير مطابق");
    const seen=new Set();
    for(const k of b.keys){
     const tag=str(k.workshop_slug,100)+":"+str(k.question_id,35)+":"+str(k.part_key,90),kind=parts.get(tag);
     const n=Number(k.max_points);
     if(!kind||seen.has(tag)||!Number.isFinite(n)||n<=0||n>30)throw new E(400,"exam_key","مفتاح غير صالح");
     seen.add(tag);let spec={},rubric=null;
     if(kind==="mcq"){
      if(!["أ","ب","ج","د"].includes(k.choice)||n!==1)throw new E(400,"mcq_key","اختيار خاطئ في الحزمة");
      spec={option:k.choice,provisional_source:true};
     }else{
      const criteria=k.rubric?.criteria;
      if(!Array.isArray(criteria)||!criteria.length||criteria.some(x=>!str(x.criterion_id,90)||!(Number(x.points)>0))||
         Math.abs(criteria.reduce((v,x)=>v+Number(x.points),0)-n)>0.001)throw new E(400,"essay_rubric","معيار المقالي غير صالح");
      rubric={criteria,provisional:true};spec={mode:"teacher_manual",provisional:true};
     }
     ks.push({activity_slug:k.workshop_slug,bank_id:k.question_id,part_key:k.part_key,answer_spec:spec,rubric,max_points:n});
    }
    if(seen.size!==66)throw new E(400,"missing_exam_keys","مفاتيح الامتحان ناقصة");
    await sql.begin(async tx=>{
     await tx`select pg_advisory_xact_lock(hashtextextended('g2-exams-import',0))`;
     await tx`insert into private.g2_questions(activity_slug,bank_id,prompt,parts_public,image_path,image_sha256,skill_ref,sort_order)
       select activity_slug,bank_id,prompt,parts_public,image_path,image_sha256,skill_ref,sort_order
       from jsonb_to_recordset(${tx.json(qs)}::jsonb) as x(activity_slug text,bank_id text,prompt text,parts_public jsonb,image_path text,image_sha256 text,skill_ref text,sort_order integer)
       on conflict(activity_slug,bank_id) do nothing`;
     await tx`insert into private.g2_keys(activity_slug,bank_id,part_key,version_no,key_status,answer_spec,rubric,max_points,approved_by,approved_at)
       select activity_slug,bank_id,part_key,1,'approved',answer_spec,rubric,max_points,${c.u.id}::uuid,now()
       from jsonb_to_recordset(${tx.json(ks)}::jsonb) as x(activity_slug text,bank_id text,part_key text,answer_spec jsonb,rubric jsonb,max_points numeric)
       on conflict(activity_slug,bank_id,part_key,version_no) do nothing`;
     await tx`insert into private.g2_admin_events(actor_id,action,payload) values(${c.u.id}::uuid,'exam_import',${tx.json({questions:56,parts:66,provisional:true})})`;
    });
    const results=await stats();
    if(results.questions!==56||results.keys!==66||results.essay_parts!==19)throw new E(409,"exam_incomplete","فحص الاستيراد لم ينجح");
    return send(r,{ok:true,...results});
   }
   const current=await stats();
   if(current.questions!==56||current.keys!==66||current.essay_parts!==19||current.images!==56)
    throw new E(409,"exam_assets_missing","الامتحانات تحتاج 56 صورة و66 مفتاحًا بينها 19 مقاليًا");
   if(op==="owner_prepare_exams"){
    await sql`update private.g2_activities set content_verified=true,images_verified=true,keys_verified=true,status='validated' where slug=any(${examSlugs}) and status='draft'`;
    return send(r,{ok:true,prepared:4,...current});
   }
   if(b.confirm_provisional!=="PUBLISH_EXAMS")throw new E(400,"confirmation_required","تأكيد نشر الامتحانات مطلوب");
   const groups=await sql`select group_code from public.student_groups where education_track='azhar' and grade_level='الصف الثاني الثانوي' and is_active=true`;
   const allowedGroups=new Set(groups.map(g=>g.group_code)),chosen=Array.isArray(b.group_codes)?b.group_codes.map(x=>str(x,50)):[];
   if(!chosen.length||new Set(chosen).size!==chosen.length||chosen.some(x=>!allowedGroups.has(x)))throw new E(403,"wrong_track","المجموعات المحددة ليست أزهرية");
   const out=await sql.begin(async tx=>{
    await tx`select pg_advisory_xact_lock(hashtextextended('g2-exams-publish',0))`;
    const records=await tx`update private.g2_activities set status='published',eligible_group_codes=array(select jsonb_array_elements_text(${tx.json(chosen)}::jsonb)),provisional_manual_grading=true,provisional_live_pilot=true,published_at=coalesce(published_at,now()) where slug=any(${examSlugs}) and status in ('validated','published') returning slug`;
    if(records.length!==4)throw new E(409,"draft_exam","لم تجهز جميع الامتحانات");
    await tx`insert into private.g2_admin_events(actor_id,action,payload) values(${c.u.id}::uuid,'exams_publish',${tx.json({groups:chosen,exams:4,provisional:true})})`;
    return records;
   });
   return send(r,{ok:true,published:out.map(x=>x.slug),provisional:true,essay_policy:"manual_review"});
  }
  if(op==="owner_group_catalog"||op==="owner_launch_pilot"){
    if(!c.admin)throw new E(403,"owner_only","تحديد مجموعات الورش متاح لصاحب المنصة فقط");
    const groups=await sql`select group_code,center_name,grade_level from public.student_groups
      where is_active=true and grade_level='الصف الثاني الثانوي' and education_track='azhar' order by group_code`;
    if(op==="owner_group_catalog")return send(r,{ok:true,groups:groups.map(g=>({code:g.group_code,center:g.center_name}))});
    const chosen=Array.isArray(b.group_codes)?b.group_codes.map(g=>str(g,50)):[];
    const choices=new Set(chosen);
    if(b.confirm_provisional!==true||!chosen.length||chosen.length>20||choices.size!==chosen.length||
       chosen.some(g=>!groups.some(real=>real.group_code===g)))
       throw new E(400,"bad_group_selection","اختر مجموعة أو أكثر من مجموعات الصف الثاني الصحيحة وأكد تشغيل التجربة");
    const [inventory]=await sql`select count(*)::int as total from private.g2_questions q join private.g2_activities a on a.slug=q.activity_slug where a.mode in ('learn','mastery')`;
    const [assets]=await sql`select count(*)::int as ready from private.g2_questions q join private.g2_activities a on a.slug=q.activity_slug
       where a.mode in ('learn','mastery') and exists(select 1 from storage.objects o where o.bucket_id='g2-question-images' and o.name=q.image_path)`;
    const [keys]=await sql`select count(*)::int as ready,count(*) filter(where rubric is not null)::int as manuals
       from private.g2_keys where key_status='approved'`;
    if(inventory.total!==94||assets.ready!==94||keys.ready!==95||keys.manuals!==32)
       throw new E(409,"release_not_complete","يجب استكمال الصور الـ94 ومفاتيح الإجابة الـ95 ومعايير المقالي الـ32 أولًا");
    const rows=await sql.begin(async tx=>{
      await tx`select pg_advisory_xact_lock(hashtextextended('grade2-owner-launch',0))`;
      const current=await tx`select slug,status,content_verified,images_verified,keys_verified
        from private.g2_activities where mode in ('learn','mastery') and slug like 'g2-azhar-ch%' order by slug for update`;
      if(current.length!==6||current.some(a=>!['validated','published'].includes(a.status)||
         !a.content_verified||!a.images_verified||!a.keys_verified))
         throw new E(409,"not_validated","الورش الست غير جاهزة للنشر");
      const launched=await tx`update private.g2_activities
       set status='published',
           eligible_group_codes=array(select jsonb_array_elements_text(${tx.json(chosen)}::jsonb)),
           provisional_manual_grading=true,provisional_live_pilot=true,
           published_at=coalesce(published_at,now())
       where slug like 'g2-azhar-ch%' and mode in ('learn','mastery')
       returning slug,status`;
      await tx`insert into private.g2_admin_events(actor_id,action,payload)
       values(${c.u.id}::uuid,'provisional_launch',${tx.json({group_codes:chosen,slug_count:launched.length,choice_keys:63,manual_essays:32})})`;
      return launched;
    });
    return send(r,{ok:true,published:rows.map(v=>v.slug),groups:chosen,grade_policy:"mcq_auto_essay_teacher_review",provisional:true});
  }
  if(op==="catalog"){
   if(!c.p)return send(r,{ok:true,activities:[]});
   const list=await sql`select * from private.g2_activities where status='published' order by chapter,mode`;
   return send(r,{ok:true,activities:list.filter(a=>permitted(a,c.p)).map(a=>({slug:a.slug,title:a.title,chapter:a.chapter,mode:a.mode}))});
  }

  if(["owner_image_manifest","owner_upload_question_image","owner_prepare_image_catalog","owner_exam_manifest"].includes(op)){
   if(!c.admin)throw new E(403,"owner_only","رفع صور الأسئلة متاح لصاحب المنصة فقط");
   const manifest=await sql`
     select q.activity_slug,q.bank_id,q.image_path,q.image_sha256,a.mode,
     exists(select 1 from storage.objects o where o.bucket_id='g2-question-images' and o.name=q.image_path) as uploaded
     from private.g2_questions q join private.g2_activities a on a.slug=q.activity_slug
     where q.activity_slug like 'g2-azhar-ch%'
     order by q.activity_slug,q.sort_order`;
   if(op==="owner_image_manifest"||op==="owner_exam_manifest")return send(r,{ok:true,images:manifest.filter(q=>op==="owner_image_manifest"?q.mode!=="exam":q.mode==="exam").map(q=>({slug:q.activity_slug,id:q.bank_id,sha256:q.image_sha256,uploaded:q.uploaded}))});
   if(op==="owner_upload_question_image"){
    const slug=str(b.workshop_slug,100),id=str(b.bank_id,40);
    const expected=manifest.find(q=>q.activity_slug===slug&&q.bank_id===id);
    if(!expected)throw new E(404,"unknown_question","السؤال غير موجود");
    const encoded=b.image_base64,mime=str(b.mime_type,35);
    if(typeof encoded!=="string"||encoded.length>5600000||!(/^[A-Za-z0-9+/]+={0,2}$/).test(encoded)||!["image/png","image/jpeg"].includes(mime))
     throw new E(400,"invalid_image","صيغة ملف السؤال غير صالحة");
    let binary;try{binary=atob(encoded)}catch{throw new E(400,"bad_encoding","بيانات الصورة غير صالحة")}
    const bytes=Uint8Array.from(binary,x=>x.charCodeAt(0));
    if(bytes.length<100||bytes.length>4000000)throw new E(413,"invalid_image_size","حجم الصورة خارج الحدود");
    const isPng=bytes.slice(0,8).every((x,i)=>x===[137,80,78,71,13,10,26,10][i]);
    const isJpeg=bytes[0]===255&&bytes[1]===216&&bytes.at(-2)===255&&bytes.at(-1)===217;
    if(!(mime==="image/png"?isPng:isJpeg))throw new E(415,"invalid_image_header","امتداد الصورة لا يطابق محتواها");
    const sha=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),x=>x.toString(16).padStart(2,"0")).join("");
    if(sha!==expected.image_sha256)throw new E(409,"image_checksum_mismatch","الصورة ليست النسخة الأصلية المعتمدة لهذا السؤال");
    if(expected.uploaded)return send(r,{ok:true,id,already_uploaded:true});
    const {error}=await storage.from("g2-question-images").upload(expected.image_path,bytes,{contentType:mime,cacheControl:"0",upsert:false});
    if(error)throw new E(503,"question_upload_failed","تعذر رفع الصورة إلى التخزين الخاص");
    return send(r,{ok:true,id,uploaded:true});
   }
   const by=new Map();
   for(const q of manifest.filter(q=>q.mode!=="exam")){
    const g=by.get(q.activity_slug)||{total:0,uploaded:0};
    g.total++;if(q.uploaded)g.uploaded++;
    by.set(q.activity_slug,g);
   }
   if(manifest.filter(q=>q.mode!=="exam").length!==94||Array.from(by.values()).some(c=>c.total!==c.uploaded))
    throw new E(409,"images_incomplete","لا يمكن تجهيز الورش قبل اكتمال الصور الـ94");
   const verified=await sql`
      select a.slug,count(distinct(k.id))::int as keys
      from private.g2_activities a
      join private.g2_questions q on q.activity_slug=a.slug
      join lateral jsonb_array_elements(q.parts_public) part on part->>'input_type'='mcq'
      left join private.g2_keys k on k.activity_slug=q.activity_slug and k.bank_id=q.bank_id
         and k.part_key=part->>'key' and k.key_status='approved'
      where a.mode in ('learn','mastery') group by a.slug`;
   const actual=verified.reduce((s,r)=>s+Number(r.keys),0);
   if(actual!==63)throw new E(409,"keys_incomplete","مفاتيح الاختيار المعتمدة غير مكتملة");
   await sql`update private.g2_activities
     set content_verified=true,images_verified=true,keys_verified=true,status='validated'
     where slug like 'g2-azhar-ch%' and status='draft'`;
   return send(r,{ok:true,activities_prepared:by.size,photos:manifest.length,mcq_parts:actual,student_access:false});
  }
  if(["review_queue","review_image","rubric","review"].includes(op)){
   if(!c.admin)throw new E(403,"owner_only","المراجعة لصاحب الإدارة فقط");
   if(op==="review_image"){
    const id=str(b.image_id,60);if(!uid(id))throw new E(400,"image_id","معرّف خاطئ");
    const [i]=await sql`select storage_path from private.g2_answer_images where id=${id}::uuid limit 1`;
    if(!i)throw new E(404,"image_missing","الصورة غير موجودة");
    const {data,error}=await storage.from("g2-solution-images").createSignedUrl(i.storage_path,60);
    if(error||!data?.signedUrl)throw new E(503,"image_unavailable","تعذر فتح الصورة");return send(r,{ok:true,url:data.signedUrl});
   }
   if(op==="review_queue"){
    const list=await sql`select e.id,e.bank_id,e.part_key,e.answer_payload,a.activity_slug,
     (select d.awarded_points from private.g2_grading_decisions d where d.answer_event_id=e.id order by d.created_at desc,d.id desc limit 1) as current_score,
     (select coalesce(json_agg(i.id),'[]'::json) from private.g2_answer_images i where i.answer_event_id=e.id) as image_ids
     from private.g2_answer_events e join private.g2_attempts a on a.id=e.attempt_id where a.state='submitted' and e.revision=(select max(z.revision) from private.g2_answer_events z where z.attempt_id=e.attempt_id and z.bank_id=e.bank_id and z.part_key=e.part_key) order by e.submitted_at desc limit 50`;
    return send(r,{ok:true,items:list});
   }
   const ev=str(b.event_id,60);if(!uid(ev))throw new E(400,"event","معرف خاطئ");
   const [row]=await sql`select e.bank_id,e.part_key,a.activity_slug,a.state from private.g2_answer_events e join private.g2_attempts a on a.id=e.attempt_id where e.id=${ev}::uuid limit 1`;
   if(!row||row.state!=="submitted")throw new E(404,"event_missing","الإجابة غير مسلمة");
   const k=await getKey(row.activity_slug,row.bank_id,row.part_key);
   if(!Array.isArray(k?.rubric?.criteria))throw new E(409,"rubric_unapproved","المعيار لم يعتمد");
   if(op==="rubric")return send(r,{ok:true,event_id:ev,max_points:k.max_points,criteria:k.rubric.criteria});
   const reason=str(b.reason,1000);if(reason.length<5)throw new E(400,"reason","سبب التصحيح مطلوب");
   const p=rubric(k.rubric.criteria,b.criteria_points);if(Math.abs(p.max-Number(k.max_points))>0.001)throw new E(409,"mismatch","مجموع درجات غير متطابق");
   const result=await sql.begin(async tx=>{
    await tx`select pg_advisory_xact_lock(hashtextextended(${"g2-review-"+ev},0))`;
    const [old]=await tx`select id from private.g2_grading_decisions where answer_event_id=${ev}::uuid order by created_at desc,id desc limit 1`;
    const [d]=await tx`insert into private.g2_grading_decisions(answer_event_id,key_id,awarded_points,max_points,criteria_points,method,reviewer_id,reason,supersedes)
     values(${ev}::uuid,${k.id}::uuid,${p.sum},${p.max},${tx.json(b.criteria_points)},'teacher_manual',${c.u.id}::uuid,${reason},${old?.id||null}::uuid) returning id,awarded_points,max_points`;
    await tx`insert into private.g2_admin_events(actor_id,action,payload) values(${c.u.id}::uuid,'review_grade',${tx.json({event_id:ev,decision_id:d.id})})`;
    return d;
   });
   return send(r,{ok:true,decision:result});
  }
  const slug=str(b.workshop_slug,100);
  if(!/^g2-azhar-(ch0[123]-(learn|mastery|exam)|chapters-1-3-exam)$/.test(slug))throw new E(404,"slug","نشاط غير متاح");
  const [a]=await sql`select * from private.g2_activities where slug=${slug} limit 1`;
  if(!permitted(a,c.p))throw new E(403,"unavailable","النشاط غير منشور أو غير متاح لمجموعتك");
  if(op==="load"){
   const rows=await sql`select bank_id,prompt,parts_public,image_path,skill_ref from private.g2_questions where activity_slug=${slug} order by sort_order`;
   const questions=[];for(const q of rows){
    const {data,error}=await storage.from("g2-question-images").createSignedUrl(q.image_path,21600);
    if(error||!data?.signedUrl)throw new E(503,"asset_missing","صورة غير متاحة");
    questions.push({id:q.bank_id,prompt:q.prompt,parts:q.parts_public,image_url:data.signedUrl,skill:q.skill_ref});
   }
   const [at]=await sql`select id,state from private.g2_attempts where activity_slug=${slug} and user_id=${c.u.id}::uuid limit 1`;
   const answers=at?await sql`select distinct on(bank_id,part_key) bank_id,part_key,answer_payload,id as event_id from private.g2_answer_events where attempt_id=${at.id}::uuid order by bank_id,part_key,revision desc`:[];
   return send(r,{ok:true,activity:{slug:a.slug,title:a.title,chapter:a.chapter,mode:a.mode},questions,answers:answers.map(x=>({bank_id:x.bank_id,part_key:x.part_key,answer:x.answer_payload,event_id:x.event_id})),submitted:at?.state==="submitted"});
  }
  if(op==="progress"){
   const [at]=await sql`select * from private.g2_attempts where activity_slug=${slug} and user_id=${c.u.id}::uuid limit 1`;
   if(!at)return send(r,{ok:true,state:"not_started"});
   const [stat]=await sql`select count(*)::int as saves,count(distinct(bank_id,part_key))::int as answered_parts from private.g2_answer_events where attempt_id=${at.id}::uuid`;
   return send(r,{ok:true,state:at.state,submitted_at:at.submitted_at,...stat});
  }
  if(op==="save"){
   const bank=str(b.bank_id,30),part=str(b.part_key||"main",80),rid=str(b.request_id,60);
   if(!uid(rid))throw new E(400,"request","معرف الطلب غير صالح");
   const [q]=await sql`select * from private.g2_questions where activity_slug=${slug} and bank_id=${bank} limit 1`;
   const piece=Array.isArray(q?.parts_public)?q.parts_public.find(x=>x.key===part):null;
   if(!piece)throw new E(404,"part","جزء غير موجود");
   const answer=clean(piece.input_type,b.answer),at=await attempt(slug,c.u.id);
   const k=piece.input_type==="mcq"?await getKey(slug,bank,part):null;
   const correct=k?norm(k.answer_spec?.option):null;
   const grade=correct?{ok:answer.choice===correct,max:Number(k.max_points)}:null;
   const out=await sql.begin(async tx=>{
    const [state]=await tx`select state from private.g2_attempts where id=${at.id}::uuid for update`;
    if(state?.state!=="open")throw new E(409,"submitted","النشاط تم تسليمه");
    const [old]=await tx`select id,bank_id,part_key,answer_payload from private.g2_answer_events where attempt_id=${at.id}::uuid and client_request_id=${rid}::uuid limit 1`;
    if(old){if(old.bank_id!==bank||old.part_key!==part||JSON.stringify(old.answer_payload)!==JSON.stringify(answer))throw new E(409,"duplicate","معرف مكرر");return {event_id:old.id,duplicate:true}}
    const [last]=await tx`select coalesce(max(revision),0)::int as n from private.g2_answer_events where attempt_id=${at.id}::uuid and bank_id=${bank} and part_key=${part}`;
    if(a.mode!=="learn"&&last.n>0)throw new E(409,"single_attempt","لا يمكن إعادة الإجابة");
    if(last.n>=8)throw new E(429,"limit","الحد الأقصى للمحاولات");
    const [ev]=await tx`insert into private.g2_answer_events(attempt_id,bank_id,part_key,revision,answer_payload,client_request_id) values(${at.id}::uuid,${bank},${part},${last.n+1},${tx.json(answer)},${rid}::uuid) returning id,revision`;
    if(grade)await tx`insert into private.g2_grading_decisions(answer_event_id,key_id,awarded_points,max_points,method,reason) values(${ev.id}::uuid,${k.id}::uuid,${grade.ok?grade.max:0},${grade.max},'verified_mcq','Approved immutable answer key')`;
    return {event_id:ev.id,revision:ev.revision};
   });
   return send(r,{ok:true,...out,status:grade?"graded":"pending_review",...a.mode==="learn"&&grade?{correct:grade.ok}:{}});
  }
  if(op==="upload"){
   const ev=str(b.event_id,60),mime=str(b.mime_type,30),base=b.image_base64;
   if(!uid(ev)||!["image/png","image/jpeg"].includes(mime)||typeof base!=="string"||base.length>5600000||!/^[A-Za-z0-9+/]+={0,2}$/.test(base))throw new E(400,"image","ملف الصورة غير صالح");
   let decoded;try{decoded=atob(base)}catch{throw new E(400,"image","تعذر قراءة الصورة")}
   const bytes=Uint8Array.from(decoded,x=>x.charCodeAt(0));
   if(bytes.length<100||bytes.length>4000000)throw new E(413,"image_size","حجم الصورة غير صالح");
   const png=bytes.slice(0,8).every((v,i)=>v===[137,80,78,71,13,10,26,10][i]);
   const jpg=bytes[0]===255&&bytes[1]===216&&bytes.at(-2)===255&&bytes.at(-1)===217;
   if(!(mime==="image/png"?png:jpg))throw new E(415,"image_format","الصورة غير صالحة");
   const [row]=await sql`select e.id,a.id as attempt_id,a.state from private.g2_answer_events e join private.g2_attempts a on a.id=e.attempt_id where e.id=${ev}::uuid and a.activity_slug=${slug} and a.user_id=${c.u.id}::uuid limit 1`;
   if(!row||row.state!=="open")throw new E(403,"image_denied","الرفع غير متاح");
   const [count]=await sql`select coalesce(max(slot),0)::int as n from private.g2_answer_images where answer_event_id=${ev}::uuid`;
   if(count.n>=2)throw new E(409,"image_limit","الحد الأقصى صورتان");
   const path=`${c.u.id}/${row.attempt_id}/${ev}/${crypto.randomUUID()}.${mime==="image/png"?"png":"jpg"}`;
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),x=>x.toString(16).padStart(2,"0")).join("");
   const {error}=await storage.from("g2-solution-images").upload(path,bytes,{contentType:mime,upsert:false});
   if(error)throw new E(503,"storage","تعذر رفع الصورة");
   try{const [im]=await sql`insert into private.g2_answer_images(answer_event_id,slot,storage_path,mime_type,bytes_count,sha256) values(${ev}::uuid,${count.n+1},${path},${mime},${bytes.byteLength},${hash}) returning id`;return send(r,{ok:true,image_id:im.id})}
   catch(e){await storage.from("g2-solution-images").remove([path]);throw e}
  }
  if(op==="submit"){
   const at=await attempt(slug,c.u.id);
   const result=await sql.begin(async tx=>{
    const [locked]=await tx`select state from private.g2_attempts where id=${at.id}::uuid for update`;
    if(locked?.state==="submitted")return {state:"submitted"};
    const [num]=await tx`select count(*)::int as n from private.g2_answer_events where attempt_id=${at.id}::uuid`;
    if(!num.n)throw new E(400,"no_answers","لا يوجد إجابات");
    const [missing]=await tx`select e.id from private.g2_answer_events e where e.attempt_id=${at.id}::uuid and e.answer_payload @> '{"image_only":true}'::jsonb
     and e.revision=(select max(z.revision) from private.g2_answer_events z where z.attempt_id=e.attempt_id and z.bank_id=e.bank_id and z.part_key=e.part_key) and not exists(select 1 from private.g2_answer_images i where i.answer_event_id=e.id) limit 1`;
    if(missing)throw new E(409,"image_missing","هناك حل مصور لم يُرفع");
    const [done]=await tx`update private.g2_attempts set state='submitted',submitted_at=now() where id=${at.id}::uuid and state='open' returning submitted_at`;
    return {state:"submitted",submitted_at:done?.submitted_at};
   });
   return send(r,{ok:true,...result});
  }
  throw new E(400,"action","إجراء غير معروف");
 }catch(e){
  const status=e instanceof E?e.status:500;if(status===500)console.error("grade2 error",e instanceof Error?e.name:"unknown");
  return send(r,{error:e instanceof E?e.code:"internal_error",message:e instanceof E?e.message:"تعذر تنفيذ الطلب"},status);
 }
});