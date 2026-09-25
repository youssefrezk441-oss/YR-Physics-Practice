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
const MCQ_OPTIONS=['أ','ب','ج','د'];

const j=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...C,"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
const txt=(v:any,n=500)=>typeof v==='string'?v.trim().slice(0,n):String(v??'').trim().slice(0,n);
function canonGrade(v:any){const s=String(v??'').trim();if(s==='3 ثانوي'||s==='الصف الثالث الثانوي'||/^3(?:\D|$)/.test(s)||s.includes('الثالث'))return 'الصف الثالث الثانوي';return s}
function safeArray(v:any){if(Array.isArray(v))return v;if(typeof v==='string'){try{const p=JSON.parse(v);return Array.isArray(p)?p:[]}catch{return []}}return []}
function normDigits(v:any){const map:any={'٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9','۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9','٫':'.','٬':',','−':'-','–':'-','—':'-'};return String(v??'').replace(/[٠-٩۰-۹٫٬−–—]/g,c=>map[c]??c)}
function normText(v:any){return normDigits(v).replace(/ـ/g,'').replace(/\u00a0/g,' ').trim().replace(/\s+/g,' ')}
function normAr(v:any){return normText(v).toLowerCase().replace(/[إأآ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').replace(/[،,;؛:()]/g,' ').replace(/\s+/g,' ').trim()}
function normLetter(v:any){const s=normText(v).replace(/[\s.،,:;\-]/g,'');const m:any={'ا':'أ','أ':'أ','إ':'أ','آ':'أ','a':'أ','A':'أ','1':'أ','ب':'ب','b':'ب','B':'ب','2':'ب','ج':'ج','g':'ج','G':'ج','c':'ج','C':'ج','3':'ج','د':'د','d':'د','D':'د','4':'د'};return m[s]??m[s?.[0]]??s}
function parseNumber(v:any):number|null{if(typeof v==='number'&&Number.isFinite(v))return v;let s=normText(v).replace(/Ω|Ω|أوم|اوم/gi,'').replace(/\b(ohm|ohms|volt|volts|amp|amps|v|a)\b/gi,'').trim();s=s.replace(/(?<=\d),(?=\d)/g,'.').replace(/\s+/g,'');if(/^[+-]?\d+(?:\.\d+)?\/[+-]?\d+(?:\.\d+)?$/.test(s)){const [a,b]=s.split('/').map(Number);return b!==0?a/b:null}if(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s)){const n=Number(s);return Number.isFinite(n)?n:null}return null}
function parseRatioNumber(v:any):number|null{const direct=parseNumber(v);if(direct!==null)return direct;const s=normText(v).replace(/\s+/g,'');const m=s.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))[:：∶]([+-]?(?:\d+(?:\.\d*)?|\.\d+))$/);if(!m)return null;const a=Number(m[1]),b=Number(m[2]);return Number.isFinite(a)&&Number.isFinite(b)&&b!==0?a/b:null}
function normSymbolic(v:any){return normText(v).replace(/_/g,'').replace(/[×·*]/g,'').replace(/\s+/g,'').toLowerCase().replace(/[₀₁₂₃₄₅₆₇₈₉]/g,c=>'₀₁₂₃₄₅₆₇₈₉'.indexOf(c).toString())}
function ratioNumericTarget(canonical:string){const c=normSymbolic(canonical);if(!c.includes('='))return null;const right=c.split('=',2)[1];const m=right.match(/^([+-]?(?:\d+(?:\.\d+)?|\d+\/\d+))([a-z].*)$/);if(m){const n=parseNumber(m[1]);if(n!==null)return n}return parseNumber(right)}
function normalizeAttempt(mode:string,response:any){if(mode==='mcq')return normLetter(response);if(['numeric','multi_numeric'].includes(mode)){const n=parseNumber(response);return n===null?null:String(n)}if(mode==='multi_qualitative'||mode==='structured_text')return normAr(response);if(mode==='ratio'){const n=parseRatioNumber(response);return n===null?normSymbolic(response):String(n)}if(mode==='symbolic')return normSymbolic(response);return normText(response)}
function numericOk(response:any,spec:any){const x=parseNumber(response);if(x===null)return false;let target=spec?.value??spec?.decimal;if(target==null&&spec?.exact)target=parseNumber(spec.exact);if(target==null)return false;const tol=Math.max(0,Number(spec?.tolerance_abs??0));return Math.abs(x-Number(target))<=tol+1e-12}
function gradePart(mode:string,spec:any,response:any){
  if(mode==='mcq')return normLetter(response)===normLetter(spec?.option);
  if(mode==='numeric'||mode==='multi_numeric')return numericOk(response,spec);
  if(mode==='multi_qualitative'){const r=normAr(response);return safeArray(spec).some(a=>r===normAr(a))}
  if(mode==='structured_text')return normAr(response)===normAr(spec?.text);
  if(mode==='symbolic'){const r=normSymbolic(response);const allowed=safeArray(spec?.accepted_forms);if(spec?.canonical)allowed.unshift(spec.canonical);return allowed.some((x:any)=>r===normSymbolic(x))}
  if(mode==='ratio'){const c=String(spec?.canonical??'');const r=normSymbolic(response);if(r===normSymbolic(c))return true;const tgt=ratioNumericTarget(c);if(tgt!==null){const x=parseRatioNumber(response);if(x!==null&&Math.abs(x-tgt)<=1e-9)return true}if(c.includes('=')&&r===normSymbolic(c.split('=',2)[1]))return true;return false}
  return false;
}
function answerForPart(mode:string,key:any,partKey:string){const a=key?.accepted_answer??{};if(mode==='multi_numeric'||mode==='multi_qualitative')return a?.[partKey]??null;return a}
function displayPart(q:any,k:any,partKey:string,spec:any){const schema=q.answer_schema??{};const part=safeArray(schema.parts).find((p:any)=>String(p.key)===partKey);const label=part?.label?`${part.label}: `:'';if(q.grading_mode==='mcq')return k.display_answer;if(q.grading_mode==='multi_numeric')return `${label}${spec?.value??spec?.decimal??spec?.exact??''}${spec?.unit?` ${spec.unit}`:''}`;if(q.grading_mode==='multi_qualitative')return `${label}${safeArray(spec).join(' أو ')}`;if(q.grading_mode==='numeric')return k.display_answer;if(q.grading_mode==='structured_text')return String(spec?.text??k.display_answer);if(q.grading_mode==='symbolic'||q.grading_mode==='ratio')return String(spec?.canonical??k.display_answer);return k.display_answer}
function validPartKeys(q:any){const parts=safeArray(q?.answer_schema?.parts).map((p:any)=>String(p.key));return parts.length?parts:['main']}

async function requireAllowed(req:Request){
  const h=req.headers.get('Authorization')??'';if(!h.startsWith('Bearer '))return null;
  const {data,error}=await authClient.auth.getUser(h.slice(7));if(error||!data.user)return null;
  const u=data.user;const role=u.app_metadata?.role;
  if(role==='admin')return {user:u,role,profile:{full_name:u.user_metadata?.display_name??'معاينة الإدارة',grade_level:'الصف الثالث الثانوي',is_active:true}};
  if(role!=='student')return null;
  const [p]=await sql`select sp.student_code,sp.full_name,sp.grade_level,sp.group_code,sp.center_name,sp.is_active,sg.grade_level as group_grade from public.student_profiles sp left join public.student_groups sg on sg.group_code=sp.group_code where sp.user_id=${u.id}::uuid limit 1`;
  if(!p?.is_active)return null;const grade=canonGrade(p.group_grade??p.grade_level);
  if(grade!=='الصف الثالث الثانوي')return {denied:true,user:u,role,profile:{...p,grade_level:grade}};
  return {user:u,role,profile:{...p,grade_level:grade}};
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C});
  if(req.method!=='POST')return j({error:'method_not_allowed'},405);
  const a=await requireAllowed(req);if(!a)return j({error:'unauthorized',message:'يجب تسجيل الدخول بحساب طالب نشط.'},401);if(a.denied)return j({error:'grade_not_allowed',message:'هذه الورشة متاحة لطلاب الصف الثالث الثانوي فقط.'},403);
  let body:any={};try{body=await req.json()}catch{return j({error:'invalid_json'},400)}
  const action=txt(body?.action,40),uid=a.user.id;
  try{
    if(action==='ping')return j({ok:true,profile:{student_code:a.profile.student_code??null,full_name:a.profile.full_name??null,grade_level:a.profile.grade_level},role:a.role});
    if(action==='list'){
      const track=body?.track==='class'?'class':'home';
      const qs=await sql`select bank_no,question_id,skill,skill_name,subskill,subskill_name,track,sort_order,grading_mode,question_type,image_path,image_width,image_height,answer_schema from public.l4_workshop_questions where active=true and track=${track} order by sort_order,bank_no`;
      const progress=a.role==='admin'?[]:await sql`select bank_no,part_key,attempts_count,tried_answers,first_attempt_correct,mastered,revealed,last_answer from public.l4_workshop_progress where user_id=${uid}::uuid and bank_no in (select bank_no from public.l4_workshop_questions where active=true and track=${track}) order by bank_no,part_key`;
      return j({ok:true,track,questions:qs,progress});
    }
    if(action==='attempt'){
      if(a.role==='admin')return j({error:'admin_read_only',message:'معاينة الإدارة لا تسجل محاولات.'},403);
      const bankNo=Number(body?.bank_no),partKey=txt(body?.part_key||'main',50);
      if(!Number.isInteger(bankNo))return j({error:'invalid_question'},400);
      const [q]=await sql`select bank_no,grading_mode,answer_schema from public.l4_workshop_questions where bank_no=${bankNo} and active=true limit 1`;
      if(!q)return j({error:'question_not_found'},404);
      if(!validPartKeys(q).includes(partKey))return j({error:'invalid_part'},400);
      const [k]=await sql`select answer_key,display_answer from private.l4_workshop_keys where bank_no=${bankNo} and verified=true limit 1`;
      if(!k)return j({error:'key_not_found'},500);
      const mode=String(q.grading_mode),spec=answerForPart(mode,k.answer_key,partKey);
      if(spec==null)return j({error:'invalid_part'},400);
      const normalized=normalizeAttempt(mode,body?.answer);
      if(normalized==null||normalized==='')return j({error:'invalid_answer',message:mode.includes('numeric')?'اكتب قيمة رقمية صحيحة.':'اكتب إجابة صالحة.'},400);
      const correct=gradePart(mode,spec,body?.answer);
      const outcome=await sql.begin(async tx=>{
        await tx`select pg_advisory_xact_lock(hashtextextended(${`${uid}:${bankNo}:${partKey}`},0))`;
        const [old]=await tx`select bank_no,part_key,attempts_count,tried_answers,first_attempt_correct,mastered,revealed,last_answer from public.l4_workshop_progress where user_id=${uid}::uuid and bank_no=${bankNo} and part_key=${partKey} for update`;
        const attempts=Number(old?.attempts_count??0),tried=safeArray(old?.tried_answers).map(String);
        if(old?.mastered)return {ok:true,already_mastered:true,correct:true,mastered:true,revealed:false,assisted:false,attempts_count:attempts,can_reveal:false,progress:old};
        if(old?.revealed)return {ok:true,already_revealed:true,correct:false,mastered:false,revealed:true,assisted:true,attempts_count:attempts,can_reveal:false,display_answer:displayPart(q,k,partKey,spec),progress:old};
        if(mode!=='mcq'&&attempts>=3)return {ok:true,locked:true,correct:false,mastered:false,revealed:false,assisted:false,attempts_count:attempts,can_reveal:true,message:'تم استنفاد 3 محاولات مختلفة. يمكنك إظهار الإجابة.',progress:old};
        if(tried.includes(String(normalized)))return {ok:true,duplicate:true,correct:false,mastered:false,revealed:false,assisted:false,attempts_count:attempts,can_reveal:mode!=='mcq'&&attempts>=3,message:'هذه الإجابة جربتها من قبل ولن تُحسب محاولة جديدة.',progress:old};
        const nextAttempts=attempts+1,newTried=[...tried,String(normalized)];
        let autoAssisted=false,autoDisplay=null;
        if(!correct&&mode==='mcq'){
          const correctOption=normLetter(spec?.option),wrong=MCQ_OPTIONS.filter(x=>x!==correctOption);
          const distinctWrong=new Set(newTried.map(normLetter).filter(x=>wrong.includes(x)));
          if(wrong.length&&distinctWrong.size>=wrong.length){autoAssisted=true;autoDisplay=displayPart(q,k,partKey,spec)}
        }
        const lastAnswer={raw:body?.answer,normalized};
        const [progress]=await tx`insert into public.l4_workshop_progress(user_id,bank_no,part_key,attempts_count,tried_answers,first_attempt_correct,mastered,revealed,last_answer,updated_at) values(${uid}::uuid,${bankNo},${partKey},${nextAttempts},${tx.json(newTried)},${nextAttempts===1?correct:old?.first_attempt_correct??false},${correct},${autoAssisted},${tx.json(lastAnswer)},now()) on conflict(user_id,bank_no,part_key) do update set attempts_count=excluded.attempts_count,tried_answers=excluded.tried_answers,first_attempt_correct=coalesce(public.l4_workshop_progress.first_attempt_correct,excluded.first_attempt_correct),mastered=(public.l4_workshop_progress.mastered or excluded.mastered),revealed=(public.l4_workshop_progress.revealed or excluded.revealed),last_answer=excluded.last_answer,updated_at=now() returning bank_no,part_key,attempts_count,tried_answers,first_attempt_correct,mastered,revealed,last_answer`;
        await tx`insert into public.l4_workshop_events(user_id,bank_no,part_key,event_type,attempt_no,answer_json,is_correct) values(${uid}::uuid,${bankNo},${partKey},'attempt',${nextAttempts},${tx.json(lastAnswer)},${correct})`;
        if(autoAssisted)await tx`insert into public.l4_workshop_events(user_id,bank_no,part_key,event_type,attempt_no,answer_json,is_correct) values(${uid}::uuid,${bankNo},${partKey},'reveal',null,null,null) on conflict do nothing`;
        if(correct)return {ok:true,correct:true,mastered:true,revealed:false,assisted:false,attempts_count:nextAttempts,can_reveal:false,message:'إجابة صحيحة.',progress};
        if(autoAssisted)return {ok:true,correct:false,mastered:false,revealed:true,assisted:true,attempts_count:nextAttempts,can_reveal:false,display_answer:autoDisplay,message:`بعد استبعاد جميع البدائل الخاطئة، الإجابة الصحيحة هي: ${autoDisplay}. سُجلت كتعلّم بمساعدة.`,progress};
        return {ok:true,correct:false,mastered:false,revealed:false,assisted:false,attempts_count:nextAttempts,can_reveal:mode!=='mcq'&&nextAttempts>=3,message:mode!=='mcq'&&nextAttempts>=3?'ليست صحيحة. يمكنك الآن إظهار الإجابة.':'ليست صحيحة. راجع فكرتك وحاول مرة أخرى.',progress};
      });
      return j(outcome);
    }
    if(action==='reveal'){
      if(a.role==='admin')return j({error:'admin_read_only'},403);
      const bankNo=Number(body?.bank_no),partKey=txt(body?.part_key||'main',50);
      const [q]=await sql`select bank_no,grading_mode,answer_schema from public.l4_workshop_questions where bank_no=${bankNo} and active=true limit 1`;
      if(!q||!validPartKeys(q).includes(partKey))return j({error:'question_not_found'},404);
      if(q.grading_mode==='mcq')return j({error:'reveal_not_applicable',message:'في الأسئلة الاختيارية تظهر الإجابة تلقائيًا بعد استبعاد جميع البدائل الخاطئة.'},403);
      const [k]=await sql`select answer_key,display_answer from private.l4_workshop_keys where bank_no=${bankNo} and verified=true limit 1`;
      if(!k)return j({error:'key_not_found'},500);
      const spec=answerForPart(q.grading_mode,k.answer_key,partKey),display=displayPart(q,k,partKey,spec);
      const outcome=await sql.begin(async tx=>{
        await tx`select pg_advisory_xact_lock(hashtextextended(${`${uid}:${bankNo}:${partKey}`},0))`;
        const [current]=await tx`select bank_no,part_key,attempts_count,tried_answers,first_attempt_correct,mastered,revealed,last_answer from public.l4_workshop_progress where user_id=${uid}::uuid and bank_no=${bankNo} and part_key=${partKey} for update`;
        if(current?.mastered)return {status:200,body:{ok:true,mastered:true,revealed:false,assisted:false,message:'تم إتقان هذا المطلوب بالفعل.',progress:current}};
        if(current?.revealed)return {status:200,body:{ok:true,already_revealed:true,mastered:false,revealed:true,assisted:true,display_answer:display,progress:current}};
        if(Number(current?.attempts_count??0)<3)return {status:403,body:{error:'reveal_not_allowed',message:'يتاح إظهار الإجابة بعد 3 محاولات مختلفة.'}};
        const [progress]=await tx`update public.l4_workshop_progress set revealed=true,updated_at=now() where user_id=${uid}::uuid and bank_no=${bankNo} and part_key=${partKey} returning bank_no,part_key,attempts_count,tried_answers,first_attempt_correct,mastered,revealed,last_answer`;
        await tx`insert into public.l4_workshop_events(user_id,bank_no,part_key,event_type,attempt_no,answer_json,is_correct) values(${uid}::uuid,${bankNo},${partKey},'reveal',null,null,null) on conflict do nothing`;
        return {status:200,body:{ok:true,mastered:false,revealed:true,assisted:true,display_answer:display,progress}};
      });
      return j(outcome.body,outcome.status);
    }
    if(action==='summary'){
      const [s]=await sql`select count(*)::int question_parts,count(*) filter(where mastered)::int mastered_parts,count(*) filter(where revealed)::int revealed_parts,count(*) filter(where first_attempt_correct=true)::int first_correct_parts,coalesce(sum(attempts_count),0)::int attempts from public.l4_workshop_progress where user_id=${uid}::uuid`;
      return j({ok:true,summary:s??{}});
    }
    return j({error:'unknown_action'},400);
  }catch(e){console.error('lecture4-workshop',e);return j({error:'server_error',message:'تعذر تنفيذ العملية الآن.'},500)}
});
