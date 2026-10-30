import {sb} from "./student-identity-api.js";
import {loadAdminAccess,canView} from "./admin-access.js";

const $=id=>document.getElementById(id);
const n=value=>Number(value||0);
const fmt=value=>Number(value||0).toLocaleString("ar-EG");
const percent=value=>Number.isFinite(Number(value))?Number(value).toFixed(1)+"%":"—";
const clean=s=>String(s??"");
const link=(path,slug)=>path+"?workshop="+encodeURIComponent(slug);
const state={catalog:null,rows:[],homeworks:[],active:"overview",loading:false};
function el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined&&text!==null)e.textContent=clean(text);if(cls)e.className=cls;return e}
function status(message){$("notice").textContent=message}
async function api(fn,action,body={}){
  const {data,error}=await sb.functions.invoke(fn,{body:{action,...body}});
  if(error){
    let detail=null;
    try{detail=await error.context?.clone()?.json()}catch(_){}
    throw Error(detail?.message||error.message||"تعذر الاتصال بالخادم");
  }
  if(data?.error||!data?.ok)throw Error(data?.message||data?.error||"تعذر جلب البيانات");
  return data;
}
const grade=()=>$("gradeFilter").value;
const group=()=>$("groupFilter").value.trim();
const cycle=()=>$("cycleFilter").value;
const tracks=()=>$("trackFilter").value==="all"?["class","home"]:[$("trackFilter").value];
function selected(arr){return arr.filter(w=>!grade()||w.grade_level===grade())}
function addTable(target,heads,entries){
  const box=$(target);box.replaceChildren();
  if(!entries.length){box.append(el("div","لا توجد بيانات منشورة أو مطابقة للفلاتر.","empty"));return}
  const table=el("table"),head=el("thead"),hrow=el("tr");
  for(const name of heads)hrow.append(el("th",name));
  head.append(hrow);table.append(head);
  const body=el("tbody");
  for(const values of entries){const tr=el("tr");for(const value of values){const td=el("td");if(value&&value.nodeType)td.append(value);else td.textContent=clean(value??"—");tr.append(td)}body.append(tr)}
  table.append(body);box.append(table);
}
function openLink(path,slug,title){
  const a=el("a",title);a.href=link(path,slug);return a;
}
function card(label,value,description){
  const div=el("div",null,"metric");div.append(el("span",label),el("b",value),el("small",description));return div;
}
function renderOverview(){
  const area=$("metrics");area.replaceChildren();
  const valid=state.rows.filter(r=>!r.error),home=state.homeworks.filter(r=>!r.error);
  const attempted=valid.reduce((sum,r)=>sum+n(r.data.attempted_parts),0);
  const weightedFirst=valid.reduce((sum,r)=>sum+n(r.data.attempted_parts)*n(r.data.first_attempt_rate)/100,0);
  const participation=valid.reduce((sum,r)=>sum+n(r.data.started_students),0);
  const submissions=home.reduce((sum,r)=>sum+n(r.data.submitted),0);
  const errorCount=state.rows.filter(r=>r.error).length+state.homeworks.filter(r=>r.error).length;
  area.append(
    card("ورش منشورة",selected(state.catalog.workshops).length,"قد تشمل الحصة والمنزلي"),
    card("واجبات منشورة",selected(state.catalog.homeworks).length,"ملفات واجبات مستقلة"),
    card("مشاركات في الورش",participation,"مجموع مشاركات الأقسام؛ ليست طلابًا فريدين"),
    card("تسليمات الواجب",submissions,"مجموع التسليمات عبر الواجبات"),
    card("أجزاء جُرّبت",attempted,"محاولات فعلية في الورش"),
    card("صحيح من أول محاولة",attempted?percent(weightedFirst*100/attempted):"—","متوسط مرجّح بالأجزاء المُجربة"),
    card("غير مجاب في الواجبات",home.reduce((sum,r)=>sum+n(r.data.unanswered),0),"لا يُحسب خطأ"),
    card("تعذّر تحميله",errorCount,"تحقق من السطور التي يظهر بها خطأ")
  );
  const workRows=state.rows.map(r=>{
    if(r.error)return [r.work.title,r.track==="home"?"المنزلي":"الحصة",r.error,"—","—","—",openLink("admin-workshop-analytics.html",r.work.slug,"التفاصيل")];
    const v=r.data;return [r.work.title,r.track==="home"?"المنزلي":"الحصة",fmt(v.started_students)+" / "+fmt(v.eligible_students),fmt(v.completed_students),percent(v.first_attempt_rate),percent(v.independent_mastery_rate),openLink("admin-workshop-analytics.html",r.work.slug,"عرض الطلاب والأسئلة")];
  });
  addTable("workshopTable",["الورشة","النوع","بدأوا / مؤهلون","أكملوا","صح أول مرة","إتقان مستقل","التفاصيل"],workRows);
  const homeworkRows=state.homeworks.map(r=>{
    if(r.error)return [r.work.title,r.error,"—","—","—","—",openLink("admin-paper-homework.html",r.work.slug,"التفاصيل")];
    const d=r.data;return [r.work.title,fmt(d.submitted)+" / "+fmt(d.eligible),fmt(d.unsubmitted),percent(d.average_mcq),fmt(d.unanswered),fmt(d.mistake_progress?.mastered),openLink("admin-paper-homework.html",r.work.slug,"الطلاب والإجابات")];
  });
  addTable("homeworkTable",["الواجب","سلّموا / مؤهلون","لم يسلّموا","متوسط MCQ","غير محلول","أخطاء أُتقنت","التفاصيل"],homeworkRows);
}
async function allSettledLimit(tasks,max=5){
  const out=new Array(tasks.length);
  let cursor=0;
  async function runner(){while(cursor<tasks.length){const i=cursor++;try{out[i]={ok:true,value:await tasks[i]()}}catch(error){out[i]={ok:false,error:error.message||"خطأ غير معروف"}}}}
  await Promise.all(Array.from({length:Math.min(max,tasks.length)},runner));
  return out;
}
async function refresh(){
  if(state.loading)return;
  state.loading=true;$("refresh").disabled=true;
  try{
    if(!state.catalog){status("جارٍ تحميل قائمة ورش الفصل الثاني وواجباته…");
      const data=await api("admin-unified-workshop","term2_catalog");
      state.catalog={workshops:data.workshops||[],homeworks:data.homeworks||[]};
      const grades=[...new Set([...state.catalog.workshops,...state.catalog.homeworks].map(x=>x.grade_level).filter(Boolean))];
      for(const g of grades)$("gradeFilter").add(new Option(g,g));
    }
    const currentWork=selected(state.catalog.workshops),currentHomework=selected(state.catalog.homeworks);
    const plans=currentWork.flatMap(work=>tracks().map(track=>({work,track})));
    status("تحميل تحليلات "+plans.length+" قسم ورشة و"+currentHomework.length+" واجب…");
    const workResults=await allSettledLimit(plans.map(({work,track})=>()=>api("admin-unified-workshop","overview",{workshop_slug:work.slug,track,group_code:group(),cycle_source:cycle()})));
    state.rows=plans.map((entry,i)=>({...entry,...(workResults[i].ok?{data:workResults[i].value.overview}:{error:workResults[i].error})}));
    const homeworkResults=await allSettledLimit(currentHomework.map(work=>()=>api("paper-homework","overview",{workshop_slug:work.slug,group_code:group()})));
    state.homeworks=currentHomework.map((work,i)=>({work,...(homeworkResults[i].ok?{data:homeworkResults[i].value.overview}:{error:homeworkResults[i].error})}));
    renderOverview();
    $("studentsTable").replaceChildren();$("questionsTable").replaceChildren();$("skillsTable").replaceChildren();
    status("آخر تحليل للورش والواجبات المنشورة. يتم تحميل تقارير الطلاب والأسئلة عند اختيارها؛ لا توجد بيانات تقديرية.");
  }catch(error){status("تعذر تحديث التقرير: "+error.message)}
  finally{state.loading=false;$("refresh").disabled=false}
}
async function loadStudents(){
  if(!state.catalog){status("جارٍ جلب قائمة الورش…");return}
  const btn=$("loadStudents");btn.disabled=true;status("جارٍ حساب أداء الطلاب في الورش والواجبات…");
  try{
    const plans=selected(state.catalog.workshops).flatMap(work=>tracks().map(track=>({work,track})));
    const home=selected(state.catalog.homeworks);
    const tasks=[
      ...plans.map(p=>()=>api("admin-unified-workshop","students",{workshop_slug:p.work.slug,track:p.track,group_code:group(),cycle_source:cycle()})),
      ...home.map(work=>()=>api("paper-homework","students",{workshop_slug:work.slug,group_code:group()}))
    ];
    const rs=await allSettledLimit(tasks);const entries=new Map();
    function record(r){const key=r.user_id;if(!key)return null;let x=entries.get(key);if(!x){x={name:r.full_name||"",code:r.student_code||"",group:r.group_code||"",attempted:0,first:0,mastered:0,assisted:0,hwSubmitted:0,hwMissing:0};entries.set(key,x)}return x}
    let failures=0;
    rs.forEach((result,i)=>{
      if(!result.ok){failures++;return}
      if(i<plans.length){for(const r of result.value.students||[]){if(group()&&r.group_code!==group())continue;const x=record(r);if(!x)continue;x.attempted+=n(r.attempted_parts);x.first+=n(r.first_correct_parts);x.mastered+=n(r.independently_mastered_parts);x.assisted+=n(r.assisted_parts)}}
      else{for(const r of result.value.students||[]){if(group()&&r.group_code!==group())continue;const x=record(r);if(!x)continue;if(r.submission_id)x.hwSubmitted++;else x.hwMissing++}}
    });
    const rows=[...entries.values()].filter(x=>x.attempted||x.hwSubmitted||x.hwMissing).sort((a,b)=>b.attempted-a.attempted||a.name.localeCompare(b.name,"ar"));
    addTable("studentsTable",["الطالب","المجموعة","أجزاء مجرّبة","صح أول مرة","إتقان مستقل","بمساعدة","واجبات مُسلّمة","واجبات لم تُسلّم"],rows.map(r=>[r.name+(r.code?" ("+r.code+")":""),r.group,fmt(r.attempted),fmt(r.first),fmt(r.mastered),fmt(r.assisted),fmt(r.hwSubmitted),fmt(r.hwMissing)]));
    status("تحليل "+rows.length+" طالب عبر الورش والواجبات."+(failures?" تعذّر تحميل "+failures+" مصدر؛ لا تعتبر الأرقام شاملة حتى إعادة المحاولة.":""));
  }catch(error){status(error.message)}finally{btn.disabled=false}
}
async function loadQuestions(){
  if(!state.catalog)return;
  const btn=$("loadQuestions");btn.disabled=true;status("جارٍ جلب الأخطاء والمهارات من الورش…");
  try{
    const plans=selected(state.catalog.workshops).flatMap(work=>tracks().map(track=>({work,track})));
    const actions=plans.flatMap(p=>["questions","skills"].map(action=>({p,action})));
    const rs=await allSettledLimit(actions.map(x=>()=>api("admin-unified-workshop",x.action,{workshop_slug:x.p.work.slug,track:x.p.track,group_code:group(),cycle_source:cycle()})));
    const questions=[],skills=[];let failed=0;
    rs.forEach((r,i)=>{
      if(!r.ok){failed++;return}
      const {p,action}=actions[i];
      for(const x of r.value[action]||[]) {
        const row={...x,work:p.work,track:p.track};
        if(action==="questions")questions.push(row);else skills.push(row);
      }
    });
    questions.sort((a,b)=>n(b.attempted_parts)-n(b.first_correct_parts)-(n(a.attempted_parts)-n(a.first_correct_parts)));
    skills.sort((a,b)=>n(b.first_wrong_parts)-n(a.first_wrong_parts));
    addTable("questionsTable",["الورشة","السؤال","المهارة","الأجزاء المُجربة","أخطاء أولى","التفاصيل"],questions.slice(0,100).map(q=>[q.work.title+" — "+(q.track==="home"?"المنزلي":"الحصة"),q.question_ref,q.skill_name||q.skill_ref,fmt(q.attempted_parts),fmt(n(q.attempted_parts)-n(q.first_correct_parts)),openLink("admin-workshop-analytics.html",q.work.slug,"افتح")]));
    addTable("skillsTable",["الورشة","المهارة","أجزاء مجرّبة","أخطاء أولى","بمساعدة"],skills.slice(0,100).map(x=>[x.work.title,x.name||x.skill_ref,fmt(x.attempted_parts),fmt(x.first_wrong_parts),fmt(x.assisted_parts)]));
    status("تم تحميل "+questions.length+" سؤال و"+skills.length+" مهارة."+(failed?" لم تُحمّل "+failed+" استجابة.":""));
  }catch(error){status(error.message)}finally{btn.disabled=false}
}
document.querySelectorAll("[data-tab]").forEach(button=>button.onclick=()=>{
 state.active=button.dataset.tab;document.querySelectorAll("[data-tab]").forEach(b=>b.setAttribute("aria-pressed",String(b===button)));
 for(const id of ["overview","students","questions"])$(id+"View").classList.toggle("hidden",id!==state.active);
});
$("refresh").onclick=refresh;
$("gradeFilter").onchange=refresh;$("trackFilter").onchange=refresh;$("cycleFilter").onchange=refresh;
$("groupFilter").onkeydown=e=>{if(e.key==="Enter")refresh()};
$("loadStudents").onclick=loadStudents;$("loadQuestions").onclick=loadQuestions;
try{
 const context=await loadAdminAccess(sb);
 if(!canView(context,"students"))throw Error("ليس لديك صلاحية مشاهدة تحليلات الطلاب.");
 await refresh();
}catch(error){status(error.message||"يتطلب الدخول بحساب إدارة. افتح لوحة الإدارة وسجّل الدخول أولًا.");}
