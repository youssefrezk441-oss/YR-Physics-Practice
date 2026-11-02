import {sb} from "./student-identity-api.js";
const $=id=>document.getElementById(id);
const escapeHtml=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const n=v=>Number.isFinite(Number(v))?Number(v):0;
const fmt=v=>Number(v||0).toLocaleString("ar-EG",{maximumFractionDigits:1});
const percent=(a,b)=>b>0?100*a/b:null;
const pct=v=>v==null?"—":Math.round(v)+"%";
const date=v=>v?new Date(v).toLocaleString("ar-EG",{dateStyle:"short",timeStyle:"short"}):"—";
const badge=(label,cl="off")=>'<span class="mini '+cl+'">'+escapeHtml(label)+'</span>';
const key=(slug,id,part)=>slug+"|"+id+"|"+part;
let raw=null,tab="overview",filtered=[],scopedAttempts=[],scopedStudents=[],scopedParts=[],answersMap=new Map(),partIndex=new Map(),byAttempt=new Map();
const modeLabel={learn:"ورشة تعلّم",mastery:"تدريبات إتقان",exam:"امتحان"};
const chapters={1:"الفصل الأول — القياس",2:"الفصل الثاني — الحركة",3:"الفصل الثالث — القوة"};
const setMessage=(s,isError=false)=>{$("message").textContent=s;$("message").style.color=isError?"#a32c48":"#42618b"};
const el=(tag,className,text)=>{const x=document.createElement(tag);if(className)x.className=className;if(text!=null)x.textContent=String(text);return x};
function metric(label,value,help=""){
 return '<div class="stat"><strong>'+escapeHtml(value)+'</strong><span>'+escapeHtml(label)+'</span>'+(help?'<br><small>'+escapeHtml(help)+'</small>':'')+'</div>';
}
function rowBar(label,detail,value){
 const w=value==null?0:Math.max(0,Math.min(100,value));
 return '<div class="rowline"><div class="rowlabel">'+escapeHtml(label)+(detail?'<small>'+escapeHtml(detail)+'</small>':'')+'</div><div class="bar"><i class="'+(w<50?"warn":"")+'" style="width:'+w+'%"></i></div><div class="pct">'+pct(value)+'</div></div>';
}
function table(head,rows){
 return '<div class="scroll"><table><thead><tr>'+head.map(h=>'<th>'+escapeHtml(h)+'</th>').join("")+'</tr></thead><tbody>'+(rows.length?rows.join(""):'<tr><td colspan="'+head.length+'" class="empty">لا توجد بيانات مطابقة للفلاتر الحالية.</td></tr>')+'</tbody></table></div>';
}
function filters(){
 const group=$("group").value,chapter=$("chapter").value,kind=$("kind").value,activity=$("activity").value;
 const search=$("search").value.trim().toLocaleLowerCase("ar-EG");
 scopedStudents=raw.students.filter(s=>(group==="all"||s.group_code===group)&&(!search||(s.full_name||"").toLocaleLowerCase("ar-EG").includes(search)||(s.student_code||"").toLocaleLowerCase("ar-EG").includes(search)));
 const studentIds=new Set(scopedStudents.map(s=>s.user_id));
 filtered=raw.activities.filter(a=>(chapter==="all"||String(a.chapter)===chapter)&&(kind==="all"||a.mode===kind)&&(activity==="all"||a.slug===activity));
 const slugs=new Set(filtered.map(a=>a.slug));
 scopedAttempts=raw.attempts.filter(a=>studentIds.has(a.user_id)&&slugs.has(a.activity_slug));
 scopedParts=raw.parts.filter(p=>slugs.has(p.activity_slug));
 partIndex=new Map(scopedParts.map(p=>[key(p.activity_slug,p.bank_id,p.part_key),p]));
 const ids=new Set(scopedAttempts.map(a=>a.id));
 answersMap=new Map();
 byAttempt=new Map();
 for(const e of raw.answers)if(ids.has(e.attempt_id)){
   answersMap.set(e.attempt_id+"|"+e.bank_id+"|"+e.part_key,e);
   if(!byAttempt.has(e.attempt_id))byAttempt.set(e.attempt_id,[]);
   byAttempt.get(e.attempt_id).push(e);
 }
}
function matchParts(a){return scopedParts.filter(p=>p.activity_slug===a.slug)}
function progress(a){
 const all=matchParts(a),current=byAttempt.get(a.id)||[],lookup=new Map(current.map(x=>[x.bank_id+"|"+x.part_key,x]));
 let earned=0,max=0,pending=0,essayPending=0,mcqAward=0,mcqPossible=0,first=0,answered=0;
 for(const p of all){
   max+=n(p.max_points);
   const e=lookup.get(p.bank_id+"|"+p.part_key);
   if(!e)continue;
   answered++;
   if(e.awarded_points===null||e.awarded_points===undefined){
     pending++;
     if(p.essay)essayPending++;
   }else{
     earned+=n(e.awarded_points);
     if(!p.essay){
       mcqAward+=n(e.awarded_points);mcqPossible+=n(p.max_points);
       if(Number(e.revision)===1 && n(e.awarded_points)>=n(p.max_points))first++;
     }
   }
 }
 return {answered,planned:all.length,earned,max,pending,essayPending,mcqPossible,mcqAward,first,
  finalPercent:a.state==="submitted"&&pending===0?percent(earned,max):null,
  mcqPercent:percent(mcqAward,mcqPossible)};
}
function refreshActivityOptions(){
 const prev=$("activity").value,ch=$("chapter").value,kind=$("kind").value;
 const activities=raw.activities.filter(a=>(ch==="all"||String(a.chapter)===ch)&&(kind==="all"||a.mode===kind));
 $("activity").replaceChildren(new Option("كل الأنشطة","all"),...activities.map(a=>new Option(a.title,a.slug)));
 $("activity").value=activities.some(a=>a.slug===prev)?prev:"all";
}
function detailsForStudent(id){
 const s=raw.students.find(x=>x.user_id===id);
 if(!s)return;
 const attempts=scopedAttempts.filter(a=>a.user_id===id);
 const activityMap=new Map(filtered.map(a=>[a.slug,a]));
 const rows=attempts.sort((a,b)=>String(b.started_at).localeCompare(String(a.started_at))).map(a=>{
  const p=progress(a),activity=activityMap.get(a.activity_slug);
  const status=a.state==="submitted"?badge("تم التسليم","ok"):badge("قيد الحل","pending");
  const grade=a.state!=="submitted"?"لا توجد درجة نهائية":p.pending?"مراجعة مطلوبة ("+p.essayPending+" مقالي)":pct(p.finalPercent);
  return '<tr><td class="wrap">'+escapeHtml(activity?.title||a.activity_slug)+'</td><td>'+status+'</td><td>'+fmt(p.answered)+' / '+fmt(p.planned)+'</td><td>'+grade+'</td><td>'+pct(p.mcqPercent)+'</td><td>'+date(a.submitted_at||a.started_at)+'</td></tr>';
 });
 const box=$("detail");
 box.hidden=false;box.replaceChildren();
 const h=el("h2","",s.full_name||s.student_code);box.append(h);
 box.append(el("p","sub","المجموعة: "+s.group_code+" · كود الطالب: "+(s.student_code||"غير محدد")+" · "+(s.student_active?"حساب نشط":"حساب غير نشط")));
 const wrapper=el("div");wrapper.innerHTML=table(["النشاط","الحالة","الأجزاء المجابة","النتيجة النهائية","دقة الاختيار المصحح","آخر نشاط"],rows);
 box.append(wrapper);
 const close=el("button","btn outline","إغلاق التفاصيل");close.type="button";close.addEventListener("click",()=>{box.hidden=true});box.append(close);
 box.scrollIntoView({behavior:"smooth",block:"start"});
}
function buildView(){
 filters();
 const eligible=scopedStudents.filter(s=>s.student_active===true&&s.group_active===true),allowed=new Set(eligible.map(s=>s.user_id));
 const activeAttempts=scopedAttempts.filter(a=>allowed.has(a.user_id));
 const started=new Set(activeAttempts.map(a=>a.user_id)),submittedAttempts=activeAttempts.filter(a=>a.state==="submitted");
 const submittedUsers=new Set(submittedAttempts.map(a=>a.user_id));
 const results=scopedAttempts.map(a=>({attempt:a,progress:progress(a)}));
 const pending=results.filter(x=>x.attempt.state==="submitted").reduce((sum,x)=>sum+x.progress.essayPending,0);
 const final=results.filter(x=>x.progress.finalPercent!==null);
 $("stats").innerHTML=metric("طلاب أزهر نشطون",fmt(eligible.length))+
  metric("بدأوا الحل",fmt(started.size),pct(percent(started.size,eligible.length))+" من الطلاب")+
  metric("سلّموا نشاطًا",fmt(submittedUsers.size),fmt(submittedAttempts.length)+" تسليمًا")+
  metric("أجزاء مقالية بانتظار المراجعة",fmt(pending))+
  metric("محاولات بنتيجة نهائية",fmt(final.length),fmt(scopedAttempts.length)+" محاولة إجمالًا");
 const wrap=$("mainContent");
 if(tab==="overview"){
   const groups=["N2-B","K2-B"];
   const activityRows=filtered.map(a=>{
    const its=activeAttempts.filter(at=>at.activity_slug===a.slug);
    const done=its.filter(at=>at.state==="submitted");
    const ps=its.map(at=>progress(at));const graded=ps.filter(p=>p.finalPercent!=null);
    const avg=graded.length?graded.reduce((v,p)=>v+p.finalPercent,0)/graded.length:null;
    return '<tr><td class="wrap">'+escapeHtml(a.title)+'</td><td>'+escapeHtml(modeLabel[a.mode])+'</td><td>'+fmt(its.length)+'</td><td>'+fmt(done.length)+'</td><td>'+fmt(ps.filter(p=>p.essayPending).reduce((s,p)=>s+p.essayPending,0))+'</td><td>'+pct(avg)+'</td></tr>';
   });
   let chart='<div class="two"><section><h3>مشاركة المجموعات</h3>';
   for(const g of groups){const ss=eligible.filter(s=>s.group_code===g),ids=new Set(ss.map(s=>s.user_id)),p=new Set(activeAttempts.filter(a=>ids.has(a.user_id)).map(a=>a.user_id));chart+=rowBar(g,p.size+" من "+ss.length+" طالبًا نشطًا",percent(p.size,ss.length))}
   chart+='</section><section><h3>التسليم بحسب الفصل</h3>';
   for(const c of [1,2,3]){const slugs=filtered.filter(a=>a.chapter===c).map(a=>a.slug),n=activeAttempts.filter(a=>slugs.includes(a.activity_slug)&&a.state==="submitted").length,total=activeAttempts.filter(a=>slugs.includes(a.activity_slug)).length;chart+=rowBar(chapters[c],n+" تسليم من "+total+" محاولة",percent(n,total))}
   chart+='</section></div>';
   wrap.innerHTML='<h2>نظرة عامة على التفاعل</h2><p class="sub">متوسط الدرجات يُحسب فقط من الأنشطة المسلَّمة المكتملة التصحيح، ولا يخلط الإجابات المقالية المعلقة بالصفر.</p>'+chart+'<h3 style="margin-top:18px">حالة كل ورشة وتدريب وامتحان</h3>'+table(["النشاط","النوع","بدأ","سلّم","مقالي معلق","متوسط النتائج النهائية"],activityRows);
 }else if(tab==="students"){
   const rows=scopedStudents.map(s=>{
    const att=scopedAttempts.filter(a=>a.user_id===s.user_id),sum=att.map(progress),finals=sum.filter(p=>p.finalPercent!=null);
    const avg=finals.length?finals.reduce((v,p)=>v+p.finalPercent,0)/finals.length:null;
    const pend=sum.reduce((x,p)=>x+p.essayPending,0);
    return {s,att,avg,pend,submitted:att.filter(a=>a.state==="submitted").length};
   }).sort((a,b)=>b.submitted-a.submitted||b.att.length-a.att.length||a.s.full_name.localeCompare(b.s.full_name,"ar")).map(o=>
    '<tr class="clickable" tabindex="0" data-student="'+escapeHtml(o.s.user_id)+'"><td class="wrap">'+escapeHtml(o.s.full_name)+'</td><td>'+escapeHtml(o.s.student_code||"—")+'</td><td>'+escapeHtml(o.s.group_code)+'</td><td>'+badge(o.s.student_active?"نشط":"موقوف",o.s.student_active?"ok":"off")+'</td><td>'+fmt(o.att.length)+'</td><td>'+fmt(o.submitted)+'</td><td>'+fmt(o.pend)+'</td><td>'+pct(o.avg)+'</td></tr>');
   wrap.innerHTML='<h2>سجل الطلاب</h2><p class="sub">اضغط على الطالب لعرض تفاصيل كل نشاط وحالة إجاباته. متوسط النتيجة يعرض الأنشطة المسلَّمة المكتملة التصحيح فقط.</p>'+table(["اسم الطالب","كود","المجموعة","الحساب","بدأ","سلّم","مقالي معلق","متوسط النهائي"],rows);
   for(const tr of wrap.querySelectorAll("[data-student]")){
    const open=()=>detailsForStudent(tr.dataset.student);
    tr.addEventListener("click",open);
    tr.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();open()}});
   }
 }else if(tab==="questions"||tab==="skills"){
   const questions=new Map(),skills=new Map();
   for(const p of scopedParts){
    const questionId=p.activity_slug+"|"+p.bank_id;
    if(!questions.has(questionId))questions.set(questionId,{slug:p.activity_slug,id:p.bank_id,skill:p.skill_ref,seen:new Set(),graded:0,earned:0,max:0,pending:0,mcq:0,first:0});
    if(!skills.has(p.skill_ref))skills.set(p.skill_ref,{skill:p.skill_ref,graded:0,earned:0,max:0,pending:0,answers:0});
   }
   for(const at of scopedAttempts){
    const events=byAttempt.get(at.id)||[];
    for(const e of events){
     const p=partIndex.get(key(at.activity_slug,e.bank_id,e.part_key));if(!p)continue;
     const q=questions.get(at.activity_slug+"|"+e.bank_id),s=skills.get(p.skill_ref);q.seen.add(at.user_id);s.answers++;
     if(e.awarded_points==null){if(p.essay){q.pending++;s.pending++}continue}
     q.graded++;q.earned+=n(e.awarded_points);q.max+=n(p.max_points);
     s.graded++;s.earned+=n(e.awarded_points);s.max+=n(p.max_points);
     if(!p.essay){q.mcq++;if(e.revision===1&&n(e.awarded_points)>=n(p.max_points))q.first++}
    }
   }
   if(tab==="questions"){
     const rows=[...questions.values()].sort((a,b)=>(a.max?a.earned/a.max:1)-(b.max?b.earned/b.max:1)||b.seen.size-a.seen.size).map(q=>
       '<tr><td>'+escapeHtml(q.id)+'</td><td class="wrap">'+escapeHtml(raw.activities.find(a=>a.slug===q.slug)?.title||q.slug)+'</td><td>'+escapeHtml(q.skill)+'</td><td>'+fmt(q.seen.size)+'</td><td>'+fmt(q.graded)+'</td><td>'+fmt(q.pending)+'</td><td>'+pct(percent(q.earned,q.max))+'</td><td>'+fmt(q.first)+' / '+fmt(q.mcq)+'</td></tr>');
     wrap.innerHTML='<h2>تحليل الأسئلة</h2><p class="sub">النتيجة مبنية على أجزاء الإجابات المصححة، وليس جميع الطلاب المسجلين. المقالي المعلّق منفصل؛ والصحيح من أول محاولة يُقاس في الاختيار المصحح.</p>'+
       table(["رقم السؤال","النشاط","المهارة","طلاب أجابوا","أجزاء صُحّحت","مقالي ينتظر","نسبة الدرجة المصححة","اختيار صحيح من أول مرة"],rows);
   }else{
     const rows=[...skills.values()].sort((a,b)=>(a.max?a.earned/a.max:1)-(b.max?b.earned/b.max:1)||b.answers-a.answers).map(s=>{
       const ratio=percent(s.earned,s.max);
       const confidence=s.graded<3?badge("عينة محدودة","pending"):ratio<60?badge("تحتاج مراجعة","error"):badge("مستوى جيد","ok");
       return '<tr><td>'+escapeHtml(s.skill)+'</td><td>'+fmt(s.answers)+'</td><td>'+fmt(s.graded)+'</td><td>'+fmt(s.pending)+'</td><td>'+pct(ratio)+'</td><td>'+confidence+'</td></tr>';
     });
     wrap.innerHTML='<h2>المهارات ونقاط الضعف</h2><p class="sub">يظهر التصنيف «عينة محدودة» لأقل من 3 أجزاء مصححة، ولا يُعتبر ذلك حكمًا على أداء الطالب. رموز المهارات من بنك أسئلة الأزهر المعتمد.</p>'+
       table(["رمز المهارة","أجزاء مجابة","أجزاء مصححة","بانتظار التصحيح","معدل الدرجة","التقدير"],rows);
   }
 }else{
   const codes=[...new Set(scopedStudents.map(s=>s.group_code))].sort();
   const rows=codes.map(code=>{
     const members=scopedStudents.filter(s=>s.group_code===code),active=members.filter(s=>s.student_active&&s.group_active),ids=new Set(active.map(s=>s.user_id));
     const att=scopedAttempts.filter(a=>ids.has(a.user_id)),part=new Set(att.map(a=>a.user_id));
     const done=att.filter(a=>a.state==="submitted"),result=done.map(progress).filter(p=>p.finalPercent!=null),avg=result.length?result.reduce((x,p)=>x+p.finalPercent,0)/result.length:null;
     return '<tr><td>'+escapeHtml(code)+'</td><td>'+fmt(active.length)+'</td><td>'+fmt(part.size)+'</td><td>'+pct(percent(part.size,active.length))+'</td><td>'+fmt(done.length)+'</td><td>'+pct(avg)+'</td></tr>';
   });
   wrap.innerHTML='<h2>مقارنة مجموعتي الأزهر</h2><p class="sub">المقارنة مبنية على أعداد الطلاب النشطين ومشاركتهم في نفس الأنشطة المختارة. لا تدخل مجموعات البكالوريا في النتائج.</p>'+
     table(["المجموعة","طلاب نشطون","شاركوا","نسبة المشاركة","عمليات تسليم","متوسط النهائي"],rows);
 }
}
function exportCsv(){
 filters();
 const output=[["الطالب","كود الطالب","المجموعة","نشط","أنشطة بدأها","أنشطة سلمها","مقالي معلق","متوسط النتيجة النهائية"]];
 for(const s of scopedStudents){
   const rows=scopedAttempts.filter(a=>a.user_id===s.user_id),data=rows.map(progress),finish=data.filter(p=>p.finalPercent!=null);
   output.push([s.full_name,s.student_code,s.group_code,s.student_active?"نعم":"لا",rows.length,rows.filter(a=>a.state==="submitted").length,data.reduce((x,p)=>x+p.essayPending,0),finish.length?Math.round(finish.reduce((v,p)=>v+p.finalPercent,0)/finish.length*10)/10:""]);
 }
 const csv="\ufeff"+output.map(row=>row.map(c=>'"'+String(c??"").replaceAll('"','""')+'"').join(",")).join("\r\n");
 const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
 const a=el("a");a.href=url;a.download="YR-G2-Azhar-Analytics.csv";document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function load(){
 $("refresh").disabled=true;setMessage("جارٍ تحميل التحليلات الحقيقية من الخادم…");
 try{
  const {data,error}=await sb.functions.invoke("admin-grade2-azhar-analytics",{body:{action:"snapshot"}});
  if(error||!data?.ok)throw Error(data?.message||error?.message||"تعذر تحميل الإحصاءات");
  if(!["students","activities","parts","attempts","answers"].every(k=>Array.isArray(data[k])))throw Error("استجابة غير مكتملة من الخادم");
  raw=data;
  $("dashboard").hidden=false;$("access").hidden=true;
  const selected=$("group").value;
  $("group").replaceChildren(new Option("جميع مجموعات الأزهر","all"),...[...new Set(raw.students.map(s=>s.group_code))].sort().map(code=>new Option(code,code)));
  $("group").value=[...$("group").options].some(x=>x.value===selected)?selected:"all";
  refreshActivityOptions();render();
  setMessage("تم جلب البيانات الحقيقية — آخر تحديث: "+date(data.generated_at)+" · "+fmt(data.activities.length)+" أنشطة منشورة.");
 }catch(e){
  setMessage(e.message,true);
  if(/owner|403|401|admin|authorized|صلاحية|سجل الدخول/i.test(e.message)){$("dashboard").hidden=true;$("access").hidden=false}
 }finally{$("refresh").disabled=false}
}
function render(){$("detail").hidden=true;buildView()}
for(const id of ["group","activity","search"])$(id).addEventListener(id==="search"?"input":"change",()=>{if(raw)render()});
for(const id of ["chapter","kind"])$(id).addEventListener("change",()=>{if(raw){refreshActivityOptions();render()}});
$("refresh").addEventListener("click",load);$("csv").addEventListener("click",exportCsv);
for(const b of document.querySelectorAll("[data-tab]"))b.addEventListener("click",()=>{
 tab=b.dataset.tab;for(const btn of document.querySelectorAll("[data-tab]"))btn.setAttribute("aria-selected",String(btn===b));if(raw)render();
});
$("loginForm").addEventListener("submit",async e=>{
 e.preventDefault();const btn=e.currentTarget.querySelector("button");btn.disabled=true;
 try{
  const {error}=await sb.auth.signInWithPassword({email:$("email").value.trim(),password:$("password").value});
  $("password").value="";if(error)throw error;
  await load();
 }catch(err){setMessage("تعذر تسجيل الدخول: "+err.message,true)}finally{btn.disabled=false}
});
(async()=>{
 const {data}=await sb.auth.getSession();
 if(!data.session){$("access").hidden=false;setMessage("سجل الدخول بحساب صاحب الإدارة.");return}
 await load();
})();