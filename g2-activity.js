import {sb} from "./student-identity-api.js";
const $=id=>document.getElementById(id);
const slug=new URLSearchParams(location.search).get("workshop")||"";
let questions=[],i=0,mode="learn",submitted=false,busy=false;
const values=new Map(),events=new Map();
const key=(q,p)=>q+":"+p;
function notice(s,ok=false){$("message").textContent=s;$("message").className=ok?"ok":"bad"}
async function call(action,args={}){
 const {data,error}=await sb.functions.invoke("grade2-mastery",{body:{action,workshop_slug:slug,...args}});
 if(error||data?.error)throw Error(data?.message||error?.message||"تعذر الاتصال بخدمة الورش");
 return data;
}
function node(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n}
function safeLink(s){try{const u=new URL(s);return u.protocol==="https:"&&u.hostname.endsWith(".supabase.co")?u.href:null}catch{return null}}
function renderPart(q,part){
 const wrapper=node("div","part");
 const label=node("label","",part.label||"الإجابة");wrapper.append(label);
 const k=key(q.id,part.key),current=values.get(k)||"";
 const type=part.input_type,inputs=[];
 if(type==="mcq"){
  for(const option of part.options||[]){
   const choice=node("label","choice");
   const radio=node("input");radio.type="radio";radio.name=k;radio.value=option.value;radio.checked=current===radio.value;radio.disabled=submitted;
   radio.addEventListener("change",()=>values.set(k,radio.value));
   choice.append(radio,document.createTextNode(option.label||option.value));inputs.push(radio);wrapper.append(choice);
  }
 }else{
  const text=node("textarea");text.placeholder="اكتب القانون والخطوات والتفسير؛ أو اختر صورة الحل ثم احفظ الإجابة";text.value=current;text.disabled=submitted;
  text.addEventListener("input",()=>values.set(k,text.value));inputs.push(text);wrapper.append(text);
 }
 const bar=node("div","actions"),save=node("button","","حفظ الإجابة"),info=node("small","small","");
 save.type="button";save.disabled=submitted;
 let uploadBtn=null,file=null;
 if(type!=="mcq"){
  file=node("input");file.type="file";file.accept="image/png,image/jpeg";file.setAttribute("aria-label","صورة الحل بخط اليد");file.disabled=submitted;
  uploadBtn=node("button","","رفع صورة الحل");uploadBtn.type="button";uploadBtn.disabled=submitted;
 }
 save.addEventListener("click",async()=>{
  if(busy||submitted)return;
  const val=values.get(k)||"",imageOnly=type!=="mcq"&&!String(val).trim()&&file?.files?.length>0;
  if(!String(val).trim()&&!imageOnly){notice("أدخل إجابتك أو اختر صورة الحل أولًا");return}
  busy=true;save.disabled=true;
  try{
   const answer=imageOnly?{image_only:true}:val;
   const res=await call("save",{bank_id:q.id,part_key:part.key,answer,request_id:crypto.randomUUID()});
   events.set(k,res.event_id);info.textContent="تم حفظ الإجابة"+(res.status==="graded"?" وتصحيح الاختيار":" — المقالي بانتظار المراجعة");
   notice("تم حفظ الإجابة على الخادم",true);
  }catch(err){notice(err.message)}finally{busy=false;save.disabled=submitted}
 });
 bar.append(save,info);
 if(file&&uploadBtn){
  uploadBtn.addEventListener("click",async()=>{
   if(busy||submitted)return;
   const selected=file.files?.[0],eid=events.get(k);
   if(!eid||!selected){notice("احفظ الإجابة أولًا، ثم اختر صورة");return}
   if(selected.size>4000000||!["image/png","image/jpeg"].includes(selected.type)){notice("يسمح فقط بصورة PNG أو JPG حتى 4 ميجابايت");return}
   busy=true;uploadBtn.disabled=true;
   try{
    const raw=new Uint8Array(await selected.arrayBuffer());let encoded="";
    for(let n=0;n<raw.length;n+=8192)encoded+=String.fromCharCode(...raw.subarray(n,n+8192));
    await call("upload",{event_id:eid,mime_type:selected.type,image_base64:btoa(encoded)});
    info.textContent="تم رفع صورة الحل وحفظها";notice("وصلت الصورة إلى التخزين الخاص",true);
   }catch(err){notice(err.message)}finally{busy=false;uploadBtn.disabled=submitted}
  });
  bar.append(file,uploadBtn);
 }
 wrapper.append(bar);return wrapper;
}
function draw(){
 if(!questions.length){notice("الورشة لا تحتوي أسئلة منشورة حاليًا");return}
 const q=questions[i];
 $("count").textContent="السؤال "+(i+1)+" من "+questions.length;
 $("state").textContent=submitted?"تم التسليم — التصحيح قد يكون قيد المراجعة":mode==="learn"?"تدريب مفتوح":"تقييم المحاولة الأولى";
 const img=$("questionImage"),u=safeLink(q.image_url);
 img.hidden=!u;if(u)img.src=u;else img.removeAttribute("src");
 $("questionText").textContent=q.prompt||"";
 $("parts").replaceChildren(...(q.parts||[]).map(p=>renderPart(q,p)));
 $("previous").disabled=i===0;$("next").disabled=i===questions.length-1;$("finish").disabled=submitted;
}
$("previous").addEventListener("click",()=>{if(i>0){i--;draw()}});
$("next").addEventListener("click",()=>{if(i<questions.length-1){i++;draw()}});
$("finish").addEventListener("click",async()=>{
 if(busy||submitted||!confirm("تسليم النشاط الآن؟ لن تستطيع تغيير الإجابات بعد التسليم."))return;
 busy=true;$("finish").disabled=true;
 try{await call("submit");submitted=true;notice("تم تسليم النشاط. المقالي يُراجع قبل نشر درجته النهائية.",true);draw()}
 catch(err){notice(err.message)}finally{busy=false;$("finish").disabled=submitted}
});
(async()=>{
 try{
  if(!/^g2-azhar-(?:ch0[123]-(?:learn|mastery|exam)|chapters-1-3-exam)$/.test(slug))throw Error("رابط غير صالح");
  const result=await call("load");questions=result.questions||[];mode=result.activity.mode;submitted=result.submitted===true;
  for(const row of result.answers||[]){const k=key(row.bank_id,row.part_key);values.set(k,row.answer?.choice??row.answer?.text??"");if(row.event_id)events.set(k,row.event_id)}
  $("title").textContent=result.activity.title;
  $("subtitle").textContent=mode==="learn"?"ورشة تدريب مفتوح":mode==="mastery"?"تدريبات الإتقان المستقلة":"اختبار الإتقان";
  $("activity").hidden=false;draw();
 }catch(err){notice(err.message||"الورشة غير متاحة لحسابك")}
})();