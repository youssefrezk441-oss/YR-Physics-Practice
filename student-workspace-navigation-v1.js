import {mountStudentInbox} from "./beiny-beinak-entry.js";
import {syncGrade2Tabs,renderGrade2Chapter,isSecondSecondaryBaccalaureate} from "./student-grade2-learning-v3.js";
import {sb} from "./student-identity-api.js";
/* YR student workspace — navigation adapter for the real compiled student app.
 * Uses original eligible launcher buttons; never creates bypass URLs or changes grades.
 * Chapter 1/2 mistakes and workshops remain independent; Honor editions use real server-owned assessment cycles and frozen snapshots. */
const g2Style=document.createElement("link");g2Style.rel="stylesheet";g2Style.href="./student-grade2-learning-v3.css";document.head.append(g2Style);
const $=id=>document.getElementById(id);
const areas={home:"dashboardView",learning:"yrLearnView",review:"yrReviewView",achievements:"yrAchievementsView",account:"yrAccountView"};
const chapters={learning:"1",review:"1"};
const availableSources=[
 "openFirstTermWorkshops","openSecondTermWorkshops",
 "openLecture3Workshop","openLecture4Workshop","openLecture5Workshop","openLecture6Workshop",
 "openUnifiedL1Workshop","openLecture1Homework","openLesson1Review35","openBookRemainder","openLesson2BookHomework","openLecture5BookHomework","openCh2Lecture5Workshop","openChapterMistakes","openCh2Mistakes",
 "openB2Lesson1Workshop","openB2Lesson2Workshop","openB2Lesson1Trainings","openChapterTrainings",
 "openFoundationTrainings","openCompleted","openHonor","openIndicators","openReferences"
];
let lastArea="home",moreOpen=false,refreshQueued=false;
function source(id){
 // Legacy baccalaureate launchers must never surface on the Azhar learning path.
 if(["openB2Lesson1Workshop","openB2Lesson2Workshop","openB2Lesson1Trainings"].includes(id)
    &&!isSecondSecondaryBaccalaureate())return null;
 const el=$(id);
 return el&&!el.disabled&&!el.classList.contains("hidden")?el:null;
}
function canThirdGrade(){
 const labels=[...document.querySelectorAll("#studentProfileMeta span")].map(x=>x.textContent||"").join(" ");
 return /الصف الثالث الثانوي|(?:^|\s)3 ثانوي(?:\s|$)|third.secondary|3_secondary/i.test(labels);
}
function canSecondGrade(){
 const labels=[...document.querySelectorAll("#studentProfileMeta span")].map(x=>x.textContent||"").join(" ");
 return /الصف الثاني الثانوي|second.secondary|2_secondary/i.test(labels);
}
function titleFrom(el,fallback){
 return el?.querySelector("h3")?.textContent?.trim()||fallback;
}
function detailFrom(el,fallback){
 return el?.querySelector("p")?.textContent?.trim()||fallback||"";
}
function fillEntry(entry,title,detail,symbol){
 entry.className="yrWorkspaceItem";
 const icon=document.createElement("span");icon.className="yrWorkspaceItemIcon";icon.textContent=symbol;
 icon.setAttribute("aria-hidden","true");
 const body=document.createElement("span");
 const strong=document.createElement("strong");strong.textContent=title;
 body.append(strong);
 if(detail){
  const small=document.createElement("small");small.textContent=detail;body.append(small);
 }
 const arrow=document.createElement("span");arrow.setAttribute("aria-hidden","true");arrow.textContent="‹";
 entry.append(icon,body,arrow);
}
const dualWorkshops={
 "openUnifiedL1Workshop":"third-secondary-term-2-lecture-1",
 "openCh2Lecture5Workshop":"third-secondary-term-2-lecture-5"
};
const workshopStatusCache=new Map();
function readWorkshopStatus(slug){
 const prior=workshopStatusCache.get(slug),now=Date.now();
 if(prior&&now-prior.at<30000)return prior.promise;
 const promise=sb.functions.invoke("unified-workshop",{body:{action:"track_status",workshop_slug:slug}})
   .then(({data,error})=>{if(error||!data?.ok)throw Error("تعذر الاستعلام");return data.tracks||[]});
 workshopStatusCache.set(slug,{at:now,promise});
 return promise;
}
function makeWorkshopPair(id,original,slug){
 const card=document.createElement("section");card.className="yrWorkspaceItem yrWorkshopPair";card.dataset.yrWorkshopSource=id;
 const head=document.createElement("div");head.className="yrWorkshopPairHead";
 const icon=document.createElement("span");icon.className="yrWorkspaceItemIcon";icon.textContent="🧲";icon.setAttribute("aria-hidden","true");
 const body=document.createElement("div"),title=document.createElement("strong"),subtitle=document.createElement("small");
 title.textContent=titleFrom(original,"ورشة المحاضرة");subtitle.textContent="قسمان مستقلان في الحل والتسليم.";
 body.append(title,subtitle);head.append(icon,body);card.append(head);
 const actions=document.createElement("div");actions.className="yrWorkshopPairActions";
 const statusElements=new Map();
 for(const part of [
   {key:"class",name:"ورشة الحصة",detail:"حل وتصحيح فوري · بدون تسليم"},
   {key:"home",name:"ورشة الواجب",detail:"مسودة محفوظة ثم تسليم نهائي"}
 ]){
   const button=document.createElement("button");button.type="button";button.className="yrWorkshopPairButton";button.dataset.track=part.key;
   const name=document.createElement("b"),hint=document.createElement("small"),status=document.createElement("span");
   name.textContent=part.name;hint.textContent=part.detail;status.className="yrWorkshopPairStatus";status.textContent="جارٍ تحميل الحالة…";
   statusElements.set(part.key,status);button.append(name,hint,status);
   button.addEventListener("click",()=>{
     if(!source(id))return;
     window.location.href="./workshop.html?workshop="+encodeURIComponent(slug)+"&track="+part.key;
   });
   actions.append(button);
 }
 card.append(actions);
 readWorkshopStatus(slug).then(tracks=>{
   if(!card.isConnected)return;
   for(const track of tracks){
     const status=statusElements.get(track.track_key);if(!status)continue;
     const total=Number(track.total_parts||0),attempted=Number(track.attempted_parts||0),saved=Number(track.saved_parts||0);
     status.textContent=track.mode==="interactive"?
       (total&&attempted>=total?"تمت محاولة جميع الأجزاء":"تمت محاولة "+attempted+" من "+total):
       track.submitted_at?"تم التسليم النهائي":
       total&&saved>=total?"كل الإجابات محفوظة · لم تُسلّم":
       saved?"مسودة "+saved+" من "+total+" · لم تُسلّم":"لم يبدأ الواجب";
   }
 }).catch(()=>{if(card.isConnected)for(const status of statusElements.values())status.textContent="تعذر قراءة الحالة";});
 return card;
}
function makeEntry(id,title,detail,symbol="▤"){
 const el=source(id);if(!el)return null;
 if(dualWorkshops[id])return makeWorkshopPair(id,el,dualWorkshops[id]);
 const b=document.createElement("button");
 b.type="button";b.dataset.yrSource=id;
 fillEntry(b,title||titleFrom(el,id),detail||detailFrom(el,"افتح المحتوى المتاح لحسابك"),symbol);
 b.addEventListener("click",()=>{
  const target=source(id);
  if(!target){refresh();return}
  target.click();
 });
 return b;
}
function h3(text){
 const heading=document.createElement("h3");heading.className="yrWorkspaceSectionTitle";
 heading.textContent=text;return heading;
}
function empty(message){
 const e=document.createElement("div");e.className="yrWorkspaceEmpty";e.textContent=message;return e;
}
function collect(container,heading,defs){
 const items=defs.map(([id,label,detail,icon])=>makeEntry(id,label,detail,icon)).filter(Boolean);
 if(items.length){container.append(h3(heading),...items);return items.length}
 return 0;
}
function collectChapterGroup(container,{key,title,detail,icon,entries,extra},openGroups){
 const items=entries.map(entry=>makeEntry(...entry)).filter(Boolean);
 if(!items.length)return 0;
 const group=document.createElement("details");
 group.dataset.yrChapterGroup=key;
 group.open=openGroups.has(key);
 const summary=document.createElement("summary");
 fillEntry(summary,title,detail,icon);
 const list=document.createElement("div");list.className="yrWorkspaceItems";
 list.append(...items);
 if(extra)list.append(extra);
 group.append(summary,list);container.append(group);
 return items.length;
}
function displayChapterTabs(area){
 document.querySelectorAll('[data-yr-panel="'+area+'"] [data-yr-chapter]').forEach(()=>{});
 document.querySelectorAll('[data-yr-panel="'+area+'"][data-yr-chapter]').forEach(b=>{
  const yes=b.dataset.yrChapter===chapters[area];
  b.setAttribute("aria-selected",String(yes));b.tabIndex=yes?0:-1;
 });
}
function refreshLearning(){
 const box=$("yrLearningContent");if(!box)return;
 const openGroups=new Set(Array.from(box.querySelectorAll("details[data-yr-chapter-group][open]"),group=>group.dataset.yrChapterGroup));
 box.replaceChildren();
 const second=canSecondGrade(),third=canThirdGrade();
 syncGrade2Tabs($("yrLearnView")?.querySelector(".yrChapterTabs"),second);
 const heading=$("yrLearnView")?.querySelector(".yrWorkspacePageHead p");
 if(heading)heading.textContent=second
  ?"اختار الفصل، وبعدها ورشة التعلّم وتدريبات الإتقان واختبار الإتقان المتاح لحسابك."
  :"اختار الفصل، وبعدها الورشة أو التدريب المتاح لحسابك.";
 const ch=chapters.learning;
 let found=0;
 if(second){
  renderGrade2Chapter({box,chapter:ch,source});
  const foot=document.createElement("div");foot.className="yrWorkspaceCommon";
  const history=document.createElement("button");history.className="btn secondary";history.type="button";
  history.textContent="سجل محاولاتي — جميع الأنشطة";
  history.addEventListener("click",()=>{document.dispatchEvent(new CustomEvent("yr:history-chapter",{detail:{chapter:"all"}}));source("openCompleted")?.click()});
  foot.append(history);box.append(foot);displayChapterTabs("learning");return;
 }else if(!third){
  box.append(empty("جاري تحديد الصف الدراسي والأنشطة المتاحة لحسابك."));
  return;
 }
 if(!second){
 if(ch==="1"){
  if(canThirdGrade()){
   found+=collect(box,"ورش الفصل الأول",[
    ["openLecture3Workshop",null,null,"⚡"],
    ["openLecture4Workshop",null,null,"⚡"],
    ["openLecture5Workshop",null,null,"⚡"],
    ["openLecture6Workshop",null,null,"⚡"]
   ]);
   if(!found)found+=collect(box,"الفصل الأول",[
    ["openFirstTermWorkshops","افتح ورش الفصل الأول","الورش المنشورة والمتاحة لحسابك","▤"]
   ]);
   if(source("openChapterTrainings"))found+=collect(box,"تدريبات الفصل الأول",[
    ["openChapterTrainings",null,null,"▤"]
   ]);
  }
 }else if(third){
  const honor=document.createElement("button");honor.type="button";
  fillEntry(honor,"لوحة شرف الفصل الثاني","أول ١٠ مراكز ونجوم الكويزات ونجوم الصعود","🏆");
  honor.addEventListener("click",()=>window.yrWorkspaceOpenHonorCycle?.("grade3","CHAPTER2-2026-G3-01"));
  found+=collectChapterGroup(box,{
   key:"workshops",title:"ورش الفصل الثاني",icon:"🧲",extra:honor,
   entries:[
    ["openUnifiedL1Workshop",null,null,"⚡"],
    ["openCh2Lecture5Workshop",null,null,"🧲"],
    ["openLesson1Review35","مراجعة الدرس الأول — السلك المستقيم (35 سؤالًا)",null,"🧲"]
   ]
  },openGroups);
  found+=collectChapterGroup(box,{
   key:"homework",title:"واجبات الفصل الثاني",detail:"كتاب الامتحان",icon:"📘",
   entries:[
    ["openLecture1Homework",null,null,"📘"],
    ["openBookRemainder","استكمال أسئلة الدرس الأول — كتاب الامتحان (52 سؤالًا)",null,"📗"],
    ["openLesson2BookHomework","واجب الدرس الثاني كاملًا — كتاب الامتحان (115 سؤالًا)","الملف الدائري واللولبي — 95 اختيار و20 مقالي، مع انتقال الأخطاء إلى ورشة الإتقان.","📘"],
    ["openLecture5BookHomework",null,null,"📘"]
   ]
  },openGroups);
 }
 if(ch==="1"&&third){
  found+=collect(box,"مرجع الشرح",[
   ["openReferences","مراجع شرح الحصص","افتح المرجع المتاح لصفك من المصادر المنشورة بالفعل.","📖"]
  ]);
 }
 if(!found)box.append(empty("لا توجد ورش أو أنشطة منشورة ومتاحة لحسابك في هذا الفصل حاليًا."));
 if(ch==="1"){
  // Foundation is a separate course, not a mislabeled academic chapter.
  const note=document.createElement("p");note.className="yrWorkspaceCourseNote";
  note.textContent="تدريبات الكورس التأسيسي موجودة داخل قائمة تدريبات المنصة، وليست ضمن الفصل الأول.";
  box.append(note);
 }
 } // Grade-2 activities deliberately remain separate from grade-3 chapter assignments.
 const all=document.createElement("div");all.className="yrWorkspaceCommon";
 const openMenu=document.createElement("button");openMenu.type="button";openMenu.className="btn secondary";
 openMenu.textContent="تدريبات المنصة الأخرى";openMenu.addEventListener("click",()=>source("openTrainings")?.click());
 const history=document.createElement("button");history.type="button";history.className="btn secondary";
 history.textContent=second?"محاولاتي المكتملة — كل الأنشطة":"محاولاتي المكتملة — "+(chapters.learning==="1"?"الفصل الأول":chapters.learning==="2"?"الفصل الثاني":"الفصل "+chapters.learning);history.addEventListener("click",()=>{
  document.dispatchEvent(new CustomEvent("yr:history-chapter",{detail:{chapter:second?"all":chapters.learning}}));
  source("openCompleted")?.click();
 });
 all.append(openMenu,history);box.append(all);
 displayChapterTabs("learning");
}
function refreshReview(){
 const box=$("yrReviewContent");if(!box)return;
 box.replaceChildren();
 const second=canSecondGrade();
 $("yrReviewView")?.querySelector(".yrChapterTabs")?.classList.toggle("hidden",second);
 if(second){
  box.append(empty("مراجعة أخطاء الصف الثاني بحسب الفصل غير مفعّلة حاليًا. سجلاتك الأصلية محفوظة، ويمكنك الرجوع للتدريبات من قسم التعلّم."));
  return;
 }
 const which=chapters.review==="1"?"openChapterMistakes":"openCh2Mistakes";
 const where=chapters.review==="1"?"الأول":"الثاني";
 const n=collect(box,"مراجعة أخطاء الفصل "+where,[
  [which,"من الغلطة للإتقان — الفصل "+where,
    "أسئلة أخطائك المثبتة في الفصل "+where+" فقط، حسب البيانات المتاحة لحسابك.","◎"]
 ]);
 if(!n)box.append(empty("مراجعة أخطاء الفصل "+where+" غير متاحة لحسابك حاليًا، أو لم تُنشر بعد."));
 displayChapterTabs("review");
}
let honorEditionCatalog=null,honorCatalogLoading=false,honorCatalogFailure=false;
function renderHonorEditionCards(){
 const box=$("yrAchievementCycles");if(!box)return;
 box.replaceChildren();
 const data=honorEditionCatalog;
 if(!data){
  box.append(empty(honorCatalogFailure?"تعذر تحميل جولات التقييم الآن. افتح لوحة الشرف للمحاولة مجددًا.":"جاري تحميل جولات التقييم المتاحة لحسابك..."));return;
 }
 const all=data.available_cycles||{};
 const grade=data.profile?.grade_key;
 const keys=grade&&all[grade]?[grade]:Object.keys(all);
 const labels={grade3:"الصف الثالث الثانوي",grade2:"الصف الثاني — بكالوريا",grade2_azhar:"الصف الثاني — أزهر"};
 let count=0;
 for(const key of keys){
  for(const c of all[key]||[]){
   const btn=document.createElement("button");btn.type="button";btn.className="yrArchiveItem yrEditionButton";
   const title=document.createElement("strong");title.textContent=c.title||c.code||"جولة تقييم";
   const desc=document.createElement("span");desc.textContent=(labels[key]||"جولة تقييم")+" · "+(c.archived?"نسخة مؤرشفة وثابتة":c.status==="pending_review"?"دورة قيد التجهيز — لا يوجد ترتيب معتمد":"جولة تقييم جارية");
   btn.append(title,desc);
   btn.addEventListener("click",()=>window.yrWorkspaceOpenHonorCycle?.(key,c.id));
   box.append(btn);count++;
  }
 }
 if(!count)box.append(empty("لا توجد جولات تقييم مسجلة لهذا الحساب حاليًا."));
}
function refreshAchievements(){
 const box=$("yrAchievementCurrent");if(!box)return;
 box.replaceChildren();
 const n=collect(box,"لوحة الشرف",[
  ["openHonor","افتح لوحة الشرف",
   "الجولات المسجلة وإصداراتها المؤرشفة من محرك التقييم، مع فصل الصفوف والمسارات.","☆"]
 ]);
 if(!n)box.append(empty("لم تُنشر لوحة شرف متاحة لحسابك بعد."));
 if($("yrAchievementsView")?.classList.contains("hidden"))return;
 renderHonorEditionCards();
 if(honorEditionCatalog||honorCatalogLoading||honorCatalogFailure)return;
 if(typeof window.yrWorkspaceLoadHonorCatalog!=="function")return;
 honorCatalogLoading=true;
 window.yrWorkspaceLoadHonorCatalog().then(data=>{
  honorEditionCatalog=data;honorCatalogFailure=false;renderHonorEditionCards();
 }).catch(()=>{
  honorCatalogFailure=true;renderHonorEditionCards();
 }).finally(()=>{honorCatalogLoading=false});
}
let homeProgress=null,homeProgressRequest=null,homeProgressAt=0;
const chapter2Cycle="CHAPTER2-2026-G3-01";
const activityLaunchers={
 "third-secondary-term-2-lecture-1":"openUnifiedL1Workshop",
 "third-secondary-term-2-lecture-5":"openCh2Lecture5Workshop",
 "third-secondary-term-2-lesson-1-review-35":"openLesson1Review35",
 "third-secondary-term-2-lecture-1-homework":"openLecture1Homework",
 "third-secondary-term-2-lesson-1-book-remaining":"openBookRemainder",
 "third-secondary-term-2-lesson-2-book-homework":"openLesson2BookHomework",
 "third-secondary-term-2-lecture-5-book-homework":"openLecture5BookHomework"
};
const homeNumber=value=>Number(value||0).toLocaleString("ar-EG");
function requestHomeProgress(force=false){
 if(!canThirdGrade()||$("dashboardView")?.classList.contains("hidden")||homeProgressRequest)return;
 if(!force&&Date.now()-homeProgressAt<30000)return;
 if(typeof window.yrWorkspaceLoadHomeProgress!=="function")return;
 homeProgressRequest=window.yrWorkspaceLoadHomeProgress().then(result=>{
  homeProgress=result;
 }).catch(()=>{
  homeProgress={unavailable:true};
 }).finally(()=>{
  homeProgressAt=Date.now();
  homeProgressRequest=null;
  if(!$("dashboardView")?.classList.contains("hidden"))homeNext();
 });
}
function openPendingActivity(activity){
 const launch=activityLaunchers[activity.slug];
 if(activity.kind==="workshops"&&["class","home"].includes(activity.track)){
  if(launch&&!source(launch))return;
  window.location.href="./workshop.html?workshop="+encodeURIComponent(activity.slug)+"&track="+activity.track;
  return;
 }
 const target=launch?source(launch):null;
 if(target){target.click();return;}
 const route=activity.kind==="homework"?"lecture1-homework.html":"workshop.html";
 window.location.href=`./${route}?workshop=${encodeURIComponent(activity.slug)}`;
}
function renderChapter2Home(region){
 const {assessment:a,mistakes:m,unavailable}=homeProgress||{};
 const showDetails=()=>window.yrWorkspaceOpenHonorCycle("grade3",chapter2Cycle);
 const remaining=m?Number(m.remaining||0):0;
 const showingPending=region.querySelector(".yrHomePending")?.open??false;
 const pending=Array.isArray(a?.pending)?a.pending:null;
 const next=pending?.[0];
 let task;
 if(next){
  const dueTime=next.due_at?new Date(next.due_at).toLocaleString("ar-EG",{dateStyle:"medium",timeStyle:"short",timeZone:"Africa/Cairo"}):null;
  task={text:dueTime?`${next.title} · موعد التسليم ${dueTime}`:next.title,label:next.kind==="homework"?"افتح الواجب":next.track==="home"?"أكمل ورشة الواجب":next.track==="class"?"أكمل ورشة الحصة":"افتح الورشة",open:()=>openPendingActivity(next)};
 }else if(remaining&&source("openCh2Mistakes")){
  task={text:"راجع سؤالًا غلطت فيه وحاول تحلّه من جديد.",label:"كمّل تصحيح أخطائك",open:()=>source("openCh2Mistakes")?.click()};
 }else if(pending){
  task={text:"خلّصت كل واجبات وورش الفصل الثاني المتاحة ليك.",label:"عرض تفاصيل تقييمي",open:showDetails};
 }else{
  task={text:homeProgress?(unavailable?"تعذّر تحميل ملخص تقدّمك دلوقتي.":"شوف الأنشطة المتاحة في الفصل الثاني."):"جاري تحميل خطوتك الجاية…",label:"افتح أنشطة الفصل الثاني",open:()=>{chapters.learning="2";go("learning")}};
 }
 const text=document.createElement("div");
 const title=document.createElement("h2");
 title.className="yrHomeNextTitle";title.textContent="خطوتك الجاية";
 const copy=document.createElement("p");copy.textContent=task.text;
 text.append(title,copy);
 const button=document.createElement("button");button.type="button";button.textContent=task.label;
 button.addEventListener("click",task.open);
 region.replaceChildren(text,button);
 if(pending?.length){
  const bookCount=pending.filter(item=>item.kind==="homework").length;
  const classCount=pending.filter(item=>item.kind==="workshops"&&item.track==="class").length;
  const homeCount=pending.filter(item=>item.kind==="workshops"&&item.track==="home").length;
  const details=document.createElement("details");details.className="yrHomePending";details.open=showingPending;
  const summary=document.createElement("summary");
  summary.textContent=`المطلوب في الفصل الثاني · ورش الحصة ${homeNumber(classCount)} · ورش الواجب ${homeNumber(homeCount)} · واجبات الكتاب ${homeNumber(bookCount)}`;
  const list=document.createElement("ul");
  for(const activity of pending){
   const li=document.createElement("li"),link=document.createElement("button");
   link.type="button";link.className="yrHomeQuietButton";link.textContent=activity.title;
   link.addEventListener("click",()=>openPendingActivity(activity));li.append(link);list.append(li);
  }
  details.append(summary,list);region.append(details);
 }
 if(m&&source("openCh2Mistakes")){
  const row=document.createElement("div");row.className="yrHomeMastery";
  const caption=document.createElement("p");
  const total=Number(m.total_mistakes||0),manual=Number(m.self_reviewed||0);
  const corrected=Number(m.corrected||0);
  let line="لسه مفيش أخطاء مسجّلة في الفصل الثاني.";
  if(total&&remaining===0&&!manual)line="صحّحت كل أخطائك المسجّلة في الفصل الثاني.";
  else if(total)line=`صحّحت بنفسك ${homeNumber(corrected)} من ${homeNumber(total)} أخطاء مسجّلة${manual?`، وراجعت ${homeNumber(manual)} بالتقييم الذاتي`:""}.`;
  const heading=document.createElement("strong");heading.textContent="من الغلطة للإتقان";
  caption.append(heading,document.createTextNode(line));
  row.append(caption);
  if(task.label!=="كمّل تصحيح أخطائك"&&total){
   const review=document.createElement("button");review.type="button";review.className="yrHomeQuietButton";
   review.textContent="عرض أخطائي";review.addEventListener("click",()=>source("openCh2Mistakes")?.click());
   row.append(review);
  }
  region.append(row);
 }
 if(a?.attendance&&!a.ranked){
  const notes=[];
  if(!a.attendance.total)notes.push("سجل الحضور");
  if(a.classroom_homework.pending||!a.classroom_homework.total)notes.push("واجب الحصة");
  if(a.quizzes.pending)notes.push("درجات كويز");
  if(notes.length){
   const row=document.createElement("div");row.className="yrHomeAssessment";
   const copy=document.createElement("p");copy.textContent="تقييمك مستني تسجيل "+notes.join("، ")+".";
   row.append(copy);
   if(task.label!=="عرض تفاصيل تقييمي"){
    const details=document.createElement("button");details.type="button";details.className="yrHomeQuietButton";
    details.textContent="عرض تفاصيل تقييمي";details.addEventListener("click",showDetails);row.append(details);
   }
   region.append(row);
  }
 }
}
function homeNext(){
 const home=$("dashboardView");
 if(!home)return;
 let region=$("yrHomeNext");
 if(!region){
  region=document.createElement("section");region.id="yrHomeNext";region.className="yrHomeNext";
  home.querySelector(".yrDashboardHero")?.insertAdjacentElement("afterend",region);
 }
 if(canThirdGrade()){
  region.classList.add("yrHomeChapter2");
  renderChapter2Home(region);
  requestHomeProgress();
 }else{
  region.classList.remove("yrHomeChapter2");
  const candidates=[
   "openLesson2BookHomework","openUnifiedL1Workshop","openLecture1Homework","openLecture6Workshop",
   "openLecture5Workshop","openLecture4Workshop","openLecture3Workshop",
   "openB2Lesson2Workshop","openB2Lesson1Workshop"
  ];
  const id=candidates.find(i=>source(i));
  const target=id?$(id):null;
  const text=document.createElement("div");
  const h=document.createElement("div");h.className="yrHomeNextTitle";
  h.textContent=id?"تدريب متاح ليك":"ابدأ من التعلّم";
  const p=document.createElement("p");
  p.textContent=id?titleFrom(target,"افتح التدريب المناسب"): "اختار الفصل المطلوب وشوف الأنشطة المتاحة لحسابك.";
  text.append(h,p);
  const button=document.createElement("button");button.type="button";
  button.textContent=id?"فتح التدريب":"استعراض الفصول";
  button.addEventListener("click",()=>{if(id&&source(id))source(id).click();else go("learning")});
  region.replaceChildren(text,button);
 }
 // Keep existing indicator/history screens reachable after retiring the old home tiles.
 let progress=$("yrHomeProgress");
 if(!progress){
  progress=document.createElement("section");progress.id="yrHomeProgress";
  progress.className="yrWorkspaceItems";
  region.insertAdjacentElement("afterend",progress);
 }
 const progressContent=document.createDocumentFragment();
 progressContent.append(h3("أدائي وتقدّمي"));
 const indicators=makeEntry("openIndicators","مؤشراتي وتطوّر أدائي",
  "الحضور والواجب والكويزات وتدريبات المنصة من سجلاتك الفعلية.","📊");
 if(indicators)progressContent.append(indicators);
 const history=makeEntry("openCompleted","سجل المحاولات السابقة",
  "تصفح المحاولات بحسب الفصل، أو افتح غير المصنف إذا كانت البيانات القديمة ناقصة.","✓");
 if(history)progressContent.append(history);
 progress.replaceChildren(progressContent);
}
function refresh(){
 refreshLearning();refreshReview();refreshAchievements();homeNext();
}
function scheduledRefresh(){
 if(refreshQueued)return;refreshQueued=true;
 queueMicrotask(()=>{refreshQueued=false;refresh()});
}
function closeMore(){
 moreOpen=false;
 $("yrMobileMore")?.classList.add("hidden");
 const b=document.querySelector('.yrMobileNav [data-yr-go="more"]');
 b?.setAttribute("aria-expanded","false");
}
function toggleMore(){
 if(moreOpen){closeMore();return}
 moreOpen=true;
 $("yrMobileMore")?.classList.remove("hidden");
 const b=document.querySelector('.yrMobileNav [data-yr-go="more"]');
 b?.setAttribute("aria-expanded","true");
 $("yrMobileMore")?.querySelector(".yrMoreHead button")?.focus();
}
function updateActive(id){
 let area="home";
 if(["yrLearnView","trainingMenuView","trainingCoursesView","availableTrainingsView","completedTrainingsView","firstTermWorkshopsView","secondTermWorkshopsView","referencesView"].includes(id))area="learning";
 else if(id==="yrReviewView")area="review";
 else if(["yrAchievementsView","honorView"].includes(id))area="achievements";
 else if(id==="yrAccountView")area="account";
 else if(["indicatorsMenuView","commitmentView","classTestsView","assessmentCycleView","chapterJourneyView","platformIndicatorsView"].includes(id))area="home";
 else if(["practiceView","resultView","reviewView"].includes(id))area=lastArea==="learning"?"learning":"home";
 lastArea=area;
 document.querySelectorAll("[data-yr-go]").forEach(b=>{
  if(b.dataset.yrGo==="more"){
   b.setAttribute("aria-current",["achievements","account"].includes(area)?"page":"false");
  }else{
   b.setAttribute("aria-current",b.dataset.yrGo===area?"page":"false");
  }
 });
 document.body.classList.toggle("yrWorkspaceSolving",id==="practiceView");
}
function go(area){
 if(area==="more"){toggleMore();return}
 closeMore();
 const next=areas[area];if(!next)return;
 if(typeof window.yrWorkspaceShowOnly!=="function")return;
 refresh();
 window.yrWorkspaceShowOnly(next);
}
window.yrWorkspaceOpenChapter2Group=group=>{
 if(!canThirdGrade()||!["workshops","homework"].includes(group))return;
 chapters.learning="2";
 go("learning");
 const details=$("yrLearningContent")?.querySelector(`[data-yr-chapter-group="${group}"]`);
 if(details){
  details.open=true;
  details.querySelector("summary")?.focus();
 }
};
function visibleStudent(){
 return !$("userBar")?.classList.contains("hidden");
}
function updateReady(){
 const ready=visibleStudent();
 document.body.classList.toggle("yrWorkspaceReady",ready);
 if(ready)scheduledRefresh();
 else closeMore();
}
document.addEventListener("click",e=>{
 const action=e.target.closest("[data-yr-action]");
 if(action){
  if(action.dataset.yrAction==="close-more"){closeMore();return}
  if(action.dataset.yrAction==="theme"){$("themeBtn")?.click();return}
  if(action.dataset.yrAction==="logout"){$("logoutBtn")?.click();return}
 }
 const nav=e.target.closest("[data-yr-go]");
 if(nav){e.preventDefault();go(nav.dataset.yrGo)}
 const chapter=e.target.closest("[data-yr-chapter][data-yr-panel]");
 if(chapter){
  chapters[chapter.dataset.yrPanel]=chapter.dataset.yrChapter;
  scheduledRefresh();
 }
});
document.addEventListener("keydown",e=>{
 if(e.key==="Escape"&&moreOpen){closeMore();document.querySelector('.yrMobileNav [data-yr-go="more"]')?.focus()}
 const active=document.activeElement;
 if(!active?.matches?.("[data-yr-chapter][data-yr-panel]"))return;
 if(!["ArrowLeft","ArrowRight","Home","End"].includes(e.key))return;
 e.preventDefault();
 const tabs=[...document.querySelectorAll('[data-yr-panel="'+active.dataset.yrPanel+'"][data-yr-chapter]')].filter(el=>!el.hidden&&!el.classList.contains("hidden"));
 if(!tabs.length)return;
 const current=Math.max(0,tabs.indexOf(active));
 const target=e.key==="Home"?0:e.key==="End"?tabs.length-1:(current+(e.key==="ArrowLeft"?1:-1)+tabs.length)%tabs.length;
 const peer=tabs[target];if(peer){peer.click();peer.focus()}
});
document.addEventListener("yr:student-view",e=>{
 updateActive(e.detail?.id||"dashboardView");
 if(e.detail?.id==="yrAchievementsView")refreshAchievements();
 if(e.detail?.id==="dashboardView")homeNext();
});
document.addEventListener("yr:honor-editions-ready",e=>{
 honorEditionCatalog=e.detail;honorCatalogFailure=false;
 if(!$("yrAchievementsView")?.classList.contains("hidden"))renderHonorEditionCards();
});
window.addEventListener("pageshow",event=>{if(event.persisted)requestHomeProgress(true)});
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")requestHomeProgress()});
const user=$("userBar");
if(user)new MutationObserver(updateReady).observe(user,{attributes:true,attributeFilter:["class"]});
const meta=$("studentProfileMeta");
if(meta)new MutationObserver(scheduledRefresh).observe(meta,{childList:true,subtree:true,characterData:true});
for(const id of availableSources){
 const el=$(id);
 if(el)new MutationObserver(scheduledRefresh).observe(el,{attributes:true,attributeFilter:["class","disabled"]});
}
updateReady();
updateActive("dashboardView");

mountStudentInbox(sb);
