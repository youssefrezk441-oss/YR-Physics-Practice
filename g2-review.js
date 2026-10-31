import {sb} from "./student-identity-api.js";
const items=document.getElementById("items"),status=document.getElementById("message");
const el=(tag,value)=>{const n=document.createElement(tag);if(value!==undefined)n.textContent=String(value);return n};
async function call(action,fields={}){
 const {data,error}=await sb.functions.invoke("grade2-mastery",{body:{action,...fields}});
 if(error||data?.error)throw Error(data?.message||error?.message||"تعذر الاتصال");
 return data;
}
const tell=message=>{status.textContent=message};
async function showImage(id,card){
 try{
  const {url}=await call("review_image",{image_id:id});const u=new URL(url);
  if(u.protocol!=="https:"||!u.hostname.endsWith(".supabase.co"))throw Error("رابط الصورة مرفوض");
  const img=el("img");img.src=u.href;img.alt="صورة حل الطالب";card.append(img);
 }catch(e){tell(e.message)}
}
async function criteriaForm(event,slot){
 const d=await call("rubric",{event_id:event});const form=el("form"),vals=new Map();
 for(const c of d.criteria){
  const label=el("label",(c.label||c.criterion_id)+" — من "+c.points);
  const input=el("input");input.type="number";input.min="0";input.max=String(c.points);input.step="0.25";input.required=true;input.value="0";
  label.append(input);form.append(label);vals.set(c.criterion_id,input);
 }
 const note=el("textarea");note.placeholder="سبب الدرجة أو ملاحظتك العلمية — إلزامي";note.required=true;form.append(note);
 const button=el("button","اعتماد التصحيح");button.type="submit";button.className="primary";form.append(button);
 form.addEventListener("submit",async e=>{
  e.preventDefault();const points={};
  for(const [id,input] of vals)points[id]=Number(input.value);
  button.disabled=true;
  try{
   const result=await call("review",{event_id:event,criteria_points:points,reason:note.value});
   tell("تم اعتماد "+result.decision.awarded_points+" من "+result.decision.max_points+" مع الاحتفاظ بتاريخ المراجعات");
  }catch(err){tell(err.message)}finally{button.disabled=false}
 });
 slot.replaceChildren(form);
}
(async()=>{
 try{
  const {items:queue}=await call("review_queue");
  for(const item of queue||[]){
   const card=el("section");card.className="g2ReviewCard";
   card.append(el("h2",item.activity_slug+" | "+item.bank_id+" | "+item.part_key));
   card.append(el("p","الدرجة الحالية: "+(item.current_score??"لم تعتمد")));
   const payload=el("pre",JSON.stringify(item.answer_payload,null,2));payload.dir="auto";card.append(payload);
   for(const id of item.image_ids||[]){
    const button=el("button","فتح صورة الحل");button.type="button";
    button.addEventListener("click",()=>showImage(id,card));card.append(button);
   }
   const holder=el("div"),open=el("button","بنود ومعايير التصحيح");open.type="button";
   open.addEventListener("click",async()=>{
    open.disabled=true;try{await criteriaForm(item.id,holder)}catch(e){tell(e.message);open.disabled=false}
   });card.append(open,holder);items.append(card);
  }
  if(!(queue||[]).length)tell("لا توجد إجابات بانتظار المراجعة حاليًا.");
 }catch(err){tell("تعذر فتح المراجعة: "+err.message)}
})();