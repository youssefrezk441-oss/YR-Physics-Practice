import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

if(process.env.E2E_ALLOW_WRITES!=='synthetic-e2e-only'||process.env.E2E_TARGET!=='local'||
   process.env.E2E_SUPABASE_URL!=='http://127.0.0.1:58000'||
   !process.env.E2E_DB_CONTAINER?.startsWith('yr-l2-e2e-'))
 throw Error('This E2E test is restricted to disposable local GoTrue/Postgres only');
const base=process.env.E2E_SUPABASE_URL;
const slug='third-secondary-term-2-lesson-2-book-homework';
const wc='80ec3431-e15c-47b0-ab3c-5637387e2cfa';
const ver='8bfb32a7-9beb-401d-92fa-b6811b751c26';
const track='11111111-1111-4111-8111-000000000001';
const secret=process.env.E2E_SERVICE_ROLE_KEY;
const parts=['11111111-1111-4111-8111-000000000011','11111111-1111-4111-8111-000000000012','11111111-1111-4111-8111-000000000013','11111111-1111-4111-8111-000000000014','11111111-1111-4111-8111-000000000015'];
const questions=parts.map((_,i)=>'11111111-1111-4111-8111-'+String(101+i).padStart(12,'0'));
const answers=['د','ب','أ',null,null];
function query(sql){
 const a=spawnSync('docker',['exec','-i',process.env.E2E_DB_CONTAINER,'psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-At'],{input:sql,encoding:'utf8'});
 if(a.status!==0)throw Error('Local SQL failed:\n'+a.stderr+'\n'+a.stdout);
 return a.stdout.trim();
}
async function req(path,{body,token,admin=false}={}){
 const r=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json',apikey:'synthetic-anon',...(admin?{authorization:'Bearer '+secret}:token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body??{})});
 const text=await r.text();let data;try{data=JSON.parse(text)}catch{data={raw:text}};
 return {status:r.status,data};
}
const hw=(action,payload={},token)=>req('/functions/v1/paper-homework',{token,body:{action,workshop_slug:slug,...payload}});
const mx=(action,payload={},token)=>req('/functions/v1/student-ch2-mistakes',{token,body:{action,...payload}});
const expectOk=(r,where)=>{assert.equal(r.status,200,where+' '+JSON.stringify(r));assert.equal(r.data.ok,true,where+' '+JSON.stringify(r.data));return r.data};
const rid=()=>randomUUID();
const studentMail='isolated-student-'+rid()+'@example.invalid';
const password='SyntheticL2StudentPass!2026';
const user=await req('/auth/v1/admin/users',{admin:true,body:{email:studentMail,password,email_confirm:true,app_metadata:{role:'student'}}});
assert.equal(user.status,200,JSON.stringify(user));
assert.match(user.data.id,/^[0-9a-f-]{36}$/);
const uid=user.data.id;
const login=await req('/auth/v1/token?grant_type=password',{body:{email:studentMail,password}});
assert.equal(login.status,200,JSON.stringify(login));
const token=login.data.access_token;
assert.ok(token);
const unauth=await hw('ping'); assert.equal(unauth.status,401,'Anonymous must not see student homework');
const options=JSON.stringify(['أ','ب','ج','د'].map(value=>({value,label:'الاختيار '+value})));
const q=v=>"'"+v.replaceAll("'","''")+"'";
const hashes=['a','b','c','d','e'];
let seed=`
INSERT INTO public.student_groups(group_code,grade_level,center_name) VALUES ('SYN-L2-A','3 ثانوي','Synthetic');
INSERT INTO public.student_profiles(user_id,student_code,full_name,grade_level,group_code,center_name,is_active) VALUES ('${uid}'::uuid,'SYN-L2-0001','طالب فيزياء تجريبي','3 ثانوي','SYN-L2-A','Synthetic',true);
INSERT INTO private.workshop_definitions(id,slug,title,grade_level,academic_term,lecture_no,status) VALUES ('${wc}','${slug}','واجب الدرس الثاني — تجريبي','الصف الثالث الثانوي','second',2,'draft');
INSERT INTO private.workshop_versions(id,workshop_id,version_no,content_sha256,source_label,status,validation_report)
 VALUES ('${ver}','${wc}',1,repeat('a',64),'Synthetic source keys only','validated','{}'::jsonb);
UPDATE private.workshop_definitions SET active_version_id='${ver}' WHERE id='${wc}';
INSERT INTO private.workshop_tracks(id,version_id,track_key,title,mode,sort_order,policy)
 VALUES ('${track}','${ver}','home','منزلي','final_submit',1,'{"allow_unanswered":true}'::jsonb);
INSERT INTO private.workshop_skills(version_id,skill_ref,name,sort_order)
 VALUES ('${ver}','L2-SYN','مراجعة انتقال الخطأ',1);
`;
for(let i=0;i<questions.length;i++){
 const text=i<3?'mcq':'text';
 const config=i>=3?'{"essay_self_review":true}':'{}';
 seed+=`
INSERT INTO private.workshop_questions(id,version_id,question_ref,source_ref,source_kind,question_kind,title,image_path,image_sha256,skill_ref,difficulty)
 VALUES ('${questions[i]}','${ver}','EXAM-L02-HW-Q${String(i+1).padStart(3,'0')}','${i+1}','original_bank_image','image','سؤال ${i+1}', 'assets/workshops/ch2-l2-book-homework/EXAM-L02-HW-Q${String(i+1).padStart(3,'0')}.jpg',repeat('${hashes[i]}',64),'L2-SYN','medium');
INSERT INTO private.workshop_track_questions(version_id,track_id,question_id,sort_order) VALUES ('${ver}','${track}','${questions[i]}',${i+1});
INSERT INTO private.workshop_question_parts(id,version_id,question_id,part_key,label,input_type,options_public,public_config,sort_order)
 VALUES ('${parts[i]}','${ver}','${questions[i]}','main','الإجابة','${text}',${q(i<3?options:'[]')}::jsonb,${q(config)}::jsonb,1);
INSERT INTO private.workshop_part_key_versions(part_id,version_no,answer_spec,display_answer,explanation,content_sha256,change_reason,source_kind)
 VALUES ('${parts[i]}',1,${q(i<3?JSON.stringify({option:answers[i]}):'{}')}::jsonb,${q(i<3?answers[i]:'إجابة مقالية معتمدة تجريبيًا')},'حل افتراضي للاختبار فقط',repeat('${hashes[i]}',64),'Synthetic reference approved for local E2E','initial_import');
INSERT INTO private.workshop_part_key_activations(part_id,key_version_id,activation_kind,activation_reason)
 SELECT '${parts[i]}',id,'initial_import','Synthetic private local activation' FROM private.workshop_part_key_versions WHERE part_id='${parts[i]}';
`;
}
seed+=`
INSERT INTO private.homework_delivery_policies(workshop_id,enabled,notes) VALUES ('${wc}',false,'Synthetic initially closed in isolated test');
INSERT INTO private.ch2_mistake_source_policies(workshop_id,enabled,source_contract,notes) VALUES ('${wc}',true,'paper_homework_capture_v1','Synthetic mistake evidence enabled');
`;
query(seed);
let r=await hw('ping',{},token);
assert.equal(r.status,404,'Draft homework must be unavailable to student');
query(`UPDATE private.workshop_versions SET status='published',published_at=now() WHERE id='${ver}';
UPDATE private.workshop_definitions SET status='published' WHERE id='${wc}';
UPDATE private.homework_delivery_policies SET enabled=true,enabled_at=now() WHERE workshop_id='${wc}';`);
expectOk(await hw('ping',{},token),'published ping');
const initial=expectOk(await hw('load',{},token),'load');
assert.equal(initial.parts.length,5);
assert.equal(initial.drafts.length,0);
for(const row of initial.parts){assert.equal(JSON.stringify(row).includes('answer_spec'),false,'No answer key before submit');assert.equal(JSON.stringify(row).includes('display_answer'),false,'No model answer before submit');}
const fill=async(i,state,answer)=>expectOk(await hw('save_answer',{request_id:rid(),part_id:parts[i],expected_revision:0,answer_state:state,answer},token),'save part '+i);
await fill(0,'answered',{raw:'د'});  // correct MCQ
await fill(1,'answered',{raw:'ج'});  // incorrect MCQ, correct key is ب
await fill(2,'unanswered',null);
await fill(3,'answered',{text:'محاولة مقالية مستقلة في الواجب',image_ids:[]});
await fill(4,'unanswered',null);
const resumed=expectOk(await hw('load',{},token),'resume');
assert.equal(resumed.drafts.length,5,'Draft answers were not restored');
const stale=await hw('save_answer',{request_id:rid(),part_id:parts[1],expected_revision:0,answer_state:'answered',answer:{raw:'ب'}},token);
assert.equal(stale.status,409,'Stale revision must fail closed');
const submitId=rid();
const submitted=expectOk(await hw('submit',{request_id:submitId},token),'atomic submit');
assert.equal(submitted.submission.answered_parts,3);
assert.equal(submitted.submission.unanswered_parts,2);
assert.equal(submitted.submission.mcq_score,1);
assert.equal(submitted.submission.mcq_max_score,3);
assert.equal(submitted.submission.answers.length,5);
const replay=expectOk(await hw('submit',{request_id:submitId},token),'idempotent replay');
assert.equal(replay.submission.id,submitted.submission.id,'Duplicate submission recorded');
assert.equal((await hw('save_answer',{request_id:rid(),part_id:parts[1],expected_revision:1,answer_state:'answered',answer:{raw:'ب'}},token)).status,409,'No edits after submit');
const status=expectOk(await hw('submission_status',{},token),'submission status');
assert.equal(status.submission.id,submitted.submission.id);
const essay=status.submission.answers.find(a=>a.part_id===parts[3]);
assert.ok(essay?.id);
expectOk(await hw('self_review',{request_id:rid(),submission_answer_id:essay.id,assessment:'partial'},token),'essay review');
const mistakes=expectOk(await mx('list',{},token),'mistake list');
const wrong=mistakes.items.filter(x=>x.kind==='mistake');
assert.equal(wrong.length,2,'Exactly wrong MCQ and partial essay become actionable mistakes');
const wrongMCQ=wrong.find(x=>x.evidence_kind==='paper_homework_wrong');
const wrongEssay=wrong.find(x=>x.evidence_kind==='paper_homework_essay_self_review');
assert.ok(wrongMCQ&&wrongEssay);
assert.ok(!wrong.some(x=>[parts[0],parts[2],parts[4]].includes(x.part_id)));
assert.ok(mistakes.items.some(x=>x.kind==='incomplete'),'Unanswered questions remain in a separate category');
expectOk(await mx('mark_reviewed',{request_id:rid(),mistake_ref:wrongMCQ.mistake_ref},token),'mark reviewed');
let after=expectOk(await mx('list',{},token),'reviewed status');
assert.equal(after.items.find(x=>x.mistake_ref===wrongMCQ.mistake_ref).status,'reviewed','Review must not mean mastery');
const incorrectRetry=expectOk(await mx('attempt_mastery',{request_id:rid(),mistake_ref:wrongMCQ.mistake_ref,answer:'أ'},token),'incorrect mastery retry');
assert.equal(incorrectRetry.correct,false);
const correctRetry=expectOk(await mx('attempt_mastery',{request_id:rid(),mistake_ref:wrongMCQ.mistake_ref,answer:'ب'},token),'correct mastery retry');
assert.equal(correctRetry.correct,true);
const essayRetry=expectOk(await mx('begin_essay_mastery',{request_id:rid(),mistake_ref:wrongEssay.mistake_ref,answer:{text:'محاولة جديدة مستقلة',image_ids:[]}},token),'essay retry');
assert.ok(essayRetry.retry_id);
expectOk(await mx('assess_essay_mastery',{request_id:rid(),mistake_ref:wrongEssay.mistake_ref,retry_id:essayRetry.retry_id,assessment:'correct'},token),'essay mastery');
after=expectOk(await mx('list',{},token),'final mastery state');
assert.equal(after.items.find(x=>x.mistake_ref===wrongMCQ.mistake_ref).status,'mastered');
assert.equal(after.items.find(x=>x.mistake_ref===wrongEssay.mistake_ref).status,'mastered');
assert.equal(query(`SELECT COUNT(*) FROM private.homework_submissions WHERE workshop_id='${wc}';`),'1');
assert.equal(query(`SELECT COUNT(*) FROM private.ch2_paper_homework_mistake_evidence WHERE workshop_id='${wc}';`),'2');
assert.equal(query(`SELECT COUNT(*) FROM private.homework_mutation_receipts WHERE user_id='${uid}';`),'7');
console.log('PASS isolated E2E: auth, gated access, save, resume, revision conflict, submit, idempotency, immutable grades, essay review, automatic mistakes, two independent mastery paths, unanswered separation.');
