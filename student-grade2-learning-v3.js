/* Grade 2 chapter-based learning & mastery — secure discovery adapter.
 * No scores, answer keys or student data are stored here.
 * New activities are linked only after the authenticated unified-workshop ping
 * confirms they are published and eligible for this student. */
import { sb } from "./student-identity-api.js";
const CHAPTERS={
 "1":{name:"القياس الفيزيائي",topics:["القياس","وحدات القياس","صيغة الأبعاد","أخطاء القياس"]},
 "2":{name:"الحركة في خط مستقيم",topics:["المسافة والإزاحة","السرعة","العجلة","المنحنيات البيانية"]},
 "3":{name:"القوة والحركة",topics:["القصور الذاتي","قوانين نيوتن","القوة والعجلة","كمية الحركة"]}
};
const SLUGS={
 "1":{learn:"g2-azhar-ch01-learn",mastery:"g2-azhar-ch01-mastery",exam:"g2-azhar-ch01-exam"},
 "2":{learn:"g2-azhar-ch02-learn",mastery:"g2-azhar-ch02-mastery",exam:"g2-azhar-ch02-exam"},
 "3":{learn:"g2-azhar-ch03-learn",mastery:"g2-azhar-ch03-mastery",exam:"g2-azhar-ch03-exam",cumulative:"g2-azhar-chapters-1-3-exam"}
};
const existingInMotion=[
 ["openB2Lesson1Workshop","ورشة الدرس الأول — السرعة النسبية","ورشة الدرس المنشورة لحسابك"],
 ["openB2Lesson2Workshop","ورشة الدرس الثاني — المقذوفات الأفقية","ورشة الدرس المنشورة لحسابك"],
 ["openB2Lesson1Trainings","تدريبات الدرس الأول","التدريبات المتاحة من المنصة"]
];
let cache=null,inFlight=null;
function el(tag,cls,value){const e=document.createElement(tag);if(cls)e.className=cls;if(value!==undefined)e.textContent=value;return e}
function section(n,title,desc){const s=el("section","yrG2Stage");const h=el("div","yrG2StageHead");h.append(el("span","yrG2Number",n),el("div","yrG2StageTitle"));h.lastChild.append(el("h3","",title),el("p","",desc));const body=el("div","yrG2StageBody");s.append(h,body);return{s,body}}
function pending(label){const e=el("div","yrG2Pending");e.append(el("span","","⌛"),el("span","",label),el("small","",""));e.lastChild.textContent="قيد الإعداد";return e}
function action(label,detail,click){const b=el("button","yrWorkspaceItem yrG2Action");b.type="button";b.append(el("span","yrWorkspaceItemIcon","▤"),el("span",""),el("span","","‹"));b.children[1].append(el("strong","",label),el("small","",detail));b.addEventListener("click",click);return b}
async function published(){
 if(cache&&Date.now()-cache.at<45000)return cache.slugs;
 if(inFlight)return inFlight;
 inFlight=(async()=>{
  try{
   const{data:{session}}=await sb.auth.getSession();
   if(!session?.user)return new Set();
   const{data,error}=await sb.functions.invoke("unified-workshop",{body:{action:"ping"}});
   if(error||!data?.ok||!Array.isArray(data.workshops))return new Set();
   const result=new Set(data.workshops.map(w=>String(w.slug||"")));
   cache={at:Date.now(),slugs:result};return result;
  }catch{return new Set()}finally{inFlight=null}
 })();
 return inFlight;
}
function safeLiveButton({container,slug,label,explain,signal}){
 const slot=pending("سيتاح بعد النشر واعتماد التصحيح");
 container.append(slot);
 published().then(slugs=>{
  if(!slot.isConnected||signal.aborted||!slugs.has(slug))return;
  slot.replaceWith(action(label,explain,()=>{window.location.href="./workshop.html?workshop="+encodeURIComponent(slug)}));
 });
}
export function syncGrade2Tabs(tabs,second){
 if(!tabs)return;
 tabs.classList.remove("hidden");tabs.classList.toggle("yrG2Chapters",!!second);
 let third=tabs.querySelector('[data-yr-chapter="3"]');
 if(second&&!third){third=el("button","","الفصل الثالث");third.type="button";third.setAttribute("role","tab");third.dataset.yrChapter="3";third.dataset.yrPanel="learning";third.setAttribute("aria-selected","false");tabs.append(third)}
 if(!second&&third)third.remove();
}
let controller=null;
export function renderGrade2Chapter({box,chapter,source}){
 controller?.abort();controller=new AbortController();const signal=controller.signal;
 const c=CHAPTERS[chapter]||CHAPTERS["1"],sl=SLUGS[chapter]||SLUGS["1"];
 const hero=el("header","yrG2Hero");hero.append(el("span","yrG2Kicker","رحلتك من الفهم إلى الإتقان"),el("h3","",c.name),el("p","","الفصل "+({"1":"الأول","2":"الثاني","3":"الثالث"}[chapter])));
 const topics=el("div","yrG2Topics");c.topics.forEach(t=>topics.append(el("span","",t)));hero.append(topics);box.append(hero);
 const a=section("01","ورشة التعلّم","تدريب مفتوح، تسجيل المحاولة الأولى، ثم تلميحات ومراجعة الأخطاء.");
 safeLiveButton({container:a.body,slug:sl.learn,label:"ورشة الفصل — تدريب مفتوح",explain:"ابدأ الورشة المنشورة لهذا الفصل",signal});
 if(chapter==="2"){
  const ready=existingInMotion.filter(([id])=>!!source(id));
  if(ready.length){const heading=el("h4","yrG2Subheading","ورش الدروس المتاحة بالفعل");a.body.append(heading);
   for(const[id,title,desc]of ready)a.body.append(action(title,desc,()=>source(id)?.click()));
  }
 }
 box.append(a.s);
 const b=section("02","تدريبات الإتقان","تدرّب على المهارات المستهدفة مع قياس حلّك المستقل قبل أي مساعدة.");
 safeLiveButton({container:b.body,slug:sl.mastery,label:"تدريبات إتقان الفصل",explain:"أسئلة مخصصة لقياس المهارات",signal});box.append(b.s);
 const d=section("03","اختبار الإتقان","اختبار مستقل، لا تظهر أسئلته أو نتيجته النهائية قبل اعتماد التصحيح.");
 safeLiveButton({container:d.body,slug:sl.exam,label:"اختبار إتقان الفصل",explain:"محاولة رسمية عند فتح الاختبار",signal});box.append(d.s);
 if(chapter==="3"){const extra=section("★","اختبار الإتقان الشامل","تقييم تراكمي للفصول الثلاثة بعد اجتياز مراحل التعلّم.");safeLiveButton({container:extra.body,slug:sl.cumulative,label:"اختبار الفصول الثلاثة",explain:"اختبار تراكمي عند النشر",signal});box.append(extra.s)}
 if(chapter==="1"&&source("openReferences"))box.append(action("مراجع شرح الحصص","المراجع المتاحة لحسابك",()=>source("openReferences")?.click()));
 box.append(el("p","yrG2Notice","الأنشطة غير المنشورة لا يمكن فتحها، والدرجات ومفاتيح الإجابة لا تُخزن على هذه الصفحة."));
}
