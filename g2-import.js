import {sb} from "./student-identity-api.js";
const $=s=>document.getElementById(s),msg=s=>$("message").textContent=s;
let missing=[],all=[];
async function call(action,extra={}){
 const{data,error}=await sb.functions.invoke("grade2-mastery",{body:{action,...extra}});
 if(error||data?.error){
  let body=null;try{body=await error?.context?.json?.()}catch{}
  const status=error?.context?.status;
  if(status===403&&(body?.error==="owner_only"||body?.message?.includes("صاحب")))
   throw Error("الحساب الحالي ليس حساب صاحب الإدارة (403). استخدم استمارة تسجيل دخول الإدارة الموجودة أعلى الصفحة.");
  if(status===401)throw Error("الجلسة غير صالحة أو منتهية. سجل الدخول بحساب الإدارة مرة أخرى.");
  throw Error(body?.message||data?.message||error?.message||"تعذر الاتصال بالخدمة");
 }
 return data;
}
async function refresh(){
 const {images}=await call("owner_image_manifest");all=images;missing=images.filter(x=>!x.uploaded);
 $("ownerLogin").hidden=true;$("ownerLoginMessage").textContent="تم التأكد من صلاحية حساب الإدارة.";
 $("status").textContent="تم رفع "+(images.length-missing.length)+" من "+images.length+" صورة أصلية";
 $("progress").max=images.length;$("progress").value=images.length-missing.length;
 $("upload").disabled=!missing.length||!$("zip").files?.length;
 $("prepare").disabled=missing.length>0||images.length!==94;
}
$("refresh").addEventListener("click",()=>refresh().catch(e=>{msg(e.message);$("ownerLogin").hidden=false}));
$("zip").addEventListener("change",()=>{$("upload").disabled=!missing.length||!$("zip").files?.length});
$("upload").addEventListener("click",async()=>{
 if(!window.JSZip){msg("تعذر تحميل قارئ ZIP، تأكد من الاتصال بالإنترنت");return}
 const input=$("zip").files?.[0];if(!input)return;
 $("upload").disabled=true;$("prepare").disabled=true;
 try{
  if(input.size>30000000)throw Error("الملف كبير للغاية");
  msg("جارٍ فتح الحزمة والتحقق من أسماء الملفات...");
  const zip=await JSZip.loadAsync(input);const files=Object.keys(zip.files);
  if(all.length!==94)throw Error("فهرس الأسئلة الموجود على الخادم غير مكتمل");
  let completed=all.length-missing.length;
  for(const item of missing){
   const suffix="/"+item.slug+"/assets/grade2/"+item.slug+"/"+item.id+".png";
   const entries=files.filter(name=>name.endsWith(suffix));
   if(entries.length!==1)throw Error("الصورة غير موجودة أو مكررة: "+item.id);
   const bytes=await zip.file(entries[0]).async("uint8array");
   let chars="";for(let k=0;k<bytes.length;k+=8192)chars+=String.fromCharCode(...bytes.subarray(k,k+8192));
   await call("owner_upload_question_image",{workshop_slug:item.slug,bank_id:item.id,mime_type:"image/png",image_base64:btoa(chars)});
   completed++;$("progress").value=completed;msg("تم التحقق من "+completed+" / "+all.length+" — "+item.id);
  }
  await refresh();msg("اكتمل استيراد الصور والتحقق من بصماتها. اضغط تجهيز المسودات.");
 }catch(e){msg("توقف الاستيراد: "+e.message+"؛ يمكنك إعادة المحاولة دون فقد الصور المستلمة");await refresh().catch(()=>{})}
 finally{$("upload").disabled=!missing.length||!$("zip").files?.length}
});
$("prepare").addEventListener("click",async()=>{
 $("prepare").disabled=true;
 try{const d=await call("owner_prepare_image_catalog");prepared=true;$("launch").disabled=false;msg("تم تجهيز "+d.activities_prepared+" ورش و"+d.photos+" صورة و"+d.mcq_parts+" مفتاح اختيار. اختر مجموعات الطلاب ثم اضغط فتح الورش.");}
 catch(e){msg(e.message)}finally{$("prepare").disabled=false}
});
refresh().catch(e=>{msg(e.message);$("ownerLogin").hidden=false;$("status").textContent="يجب الدخول بحساب الإدارة أولًا";});
let prepared=false;
async function groups(){
 const d=await call("owner_group_catalog"),region=$("groups");region.replaceChildren();
 for(const group of d.groups||[]){
  const label=document.createElement("label");label.className="choice";
  const input=document.createElement("input");input.type="checkbox";input.value=group.code;input.name="g2-cohort";
  label.append(input,document.createTextNode(group.code+(group.center?" — "+group.center:"")));
  region.append(label);
 }
 if(!region.children.length)msg("لا توجد مجموعات صف ثانٍ يمكن السماح لها؛ لا تفتح الورشة قبل تعيين مجموعات صحيحة.");
}
$("launch").addEventListener("click",async()=>{
 const selected=[...document.querySelectorAll('input[name="g2-cohort"]:checked')].map(x=>x.value);
 if(!prepared||!selected.length){msg("أكمل تجهيز الأسئلة واختر مجموعة واحدة على الأقل");return}
 if(!confirm("هل تريد فتح الورش الست للمجموعات المحددة كتجربة فعلية؟ التصحيح الآلي للاختيار فقط، والمقالي ينتظر مراجعتك."))return;
 $("launch").disabled=true;
 try{
  const d=await call("owner_launch_pilot",{group_codes:selected,confirm_provisional:true});
  msg("تم فتح "+d.published.length+" ورش للمجموعات المحددة. يمكن للطلاب الوصول الآن من التعلّم؛ اختبارات الإتقان الرسمية ما زالت مغلقة.");
 }catch(e){msg(e.message);$("launch").disabled=false}
});
groups().catch(e=>msg(e.message));

$("ownerLoginForm").addEventListener("submit",async event=>{
 event.preventDefault();
 const email=$("ownerEmail").value.trim(),password=$("ownerPassword").value;
 if(!email||!password)return;
 $("ownerSignIn").disabled=true;
 $("ownerLoginMessage").textContent="جارٍ تسجيل الدخول والتحقق من صلاحية الإدارة...";
 try{
  const {error}=await sb.auth.signInWithPassword({email,password});
  if(error)throw Error("تعذر تسجيل الدخول: "+error.message);
  $("ownerPassword").value="";
  await refresh();
  await groups();
  msg("تم الدخول بحساب الإدارة. اختر ملف ZIP وارفع الصور الناقصة.");
 }catch(e){$("ownerLogin").hidden=false;$("ownerLoginMessage").textContent=e.message}
 finally{$("ownerSignIn").disabled=false}
});
