import {syncGrade2Tabs,renderGrade2Chapter,isSecondSecondaryBaccalaureate} from "./student-grade2-learning-v3.js";
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
 "openUnifiedL1Workshop","openLecture1Homework","openChapterMistakes","openCh2Mistakes",
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
 return /الصف الثالث الثانوي|third.secondary|3_secondary/i.test(labels);
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
function makeEntry(id,title,detail,symbol="▤"){
 const el=source(id);if(!el)return null;
 const b=document.createElement("button");
 b.className="yrWorkspaceItem";b.type="button";b.dataset.yrSource=id;
 const ico=document.createElement("span");ico.className="yrWorkspaceItemIcon";ico.textContent=symbol;
 const body=document.createElement("span");
 const strong=document.createElement("strong");strong.textContent=title||titleFrom(el,id);
 const small=document.createElement("small");small.textContent=detail||detailFrom(el,"افتح المحتوى المتاح لحسابك");
 body.append(strong,small);
 const arrow=document.createElement("span");arrow.setAttribute("aria-hidden","true");arrow.textContent="‹";
 b.append(ico,body,arrow);
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
function displayChapterTabs(area){
 document.querySelectorAll('[data-yr-panel="'+area+'"] [data-yr-chapter]').forEach(()=>{});
 document.querySelectorAll('[data-yr-panel="'+area+'"][data-yr-chapter]').forEach(b=>{
  const yes=b.dataset.yrChapter===chapters[area];
  b.setAttribute("aria-selected",String(yes));b.tabIndex=yes?0:-1;
 });
}
function refreshLearning(){
 const box=$("yrLearningContent");if(!box)return;
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
  found+=collect(box,"ورش الفصل الثاني",[
   ["openUnifiedL1Workshop",null,null,"⚡"],
   ["openLecture1Homework",null,null,"▤"]
  ]);
  if(!found && source("openSecondTermWorkshops")){
   found+=collect(box,"الفصل الثاني",[
    ["openSecondTermWorkshops","فتح ورش الفصل الثاني","الورش المنشورة والمتاحة لحسابك","▤"]
   ]);
  }
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
function homeNext(){
 const home=$("dashboardView");if(!home||!home.classList.contains("hidden")&&document.querySelector(".yrHomeNext")===null){
  // Rendering is idempotent; no fake progress or guessed latest assessment.
 }
 let region=$("yrHomeNext");if(!home)return;
 if(!region){
  region=document.createElement("section");region.id="yrHomeNext";region.className="yrHomeNext";
  home.querySelector(".yrDashboardHero")?.insertAdjacentElement("afterend",region);
 }
 const candidates=[
  "openUnifiedL1Workshop","openLecture1Homework","openLecture6Workshop",
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
});
document.addEventListener("yr:honor-editions-ready",e=>{
 honorEditionCatalog=e.detail;honorCatalogFailure=false;
 if(!$("yrAchievementsView")?.classList.contains("hidden"))renderHonorEditionCards();
});
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
