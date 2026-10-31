import {sb} from "./student-identity-api.js";
const $=s=>document.getElementById(s),msg=s=>$("message").textContent=s;
let missing=[],all=[];
async function call(action,extra={}){const{data,error}=await sb.functions.invoke("grade2-mastery",{body:{action,...extra}});
 if(error||data?.error)throw Error(data?.message||error?.message||"تعذر الاتصال");return data;}
async function refresh(){
 const {images}=await call("owner_image_manifest");all=images;missing=images.filter(x=>!x.uploaded);
 $("status").textContent="تم رفع "+(images.length-missing.length)+" من "+images.length+" صورة أصلية";
 $("progress").max=images.length;$("progress").value=images.length-missing.length;
 $("upload").disabled=!missing.length||!$("zip").files?.length;
 $("prepare").disabled=missing.length>0||images.length!==94;
}
$("refresh").addEventListener("click",()=>refresh().catch(e=>msg(e.message)));
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
 try{const d=await call("owner_prepare_image_catalog");msg("تم تجهيز "+d.activities_prepared+" ورش و"+d.photos+" صورة و"+d.mcq_parts+" مفتاح اختيار. تظل أنشطة المسودات مغلقة إلى حين اكتمال الصلاحيات واختبارات التشغيل.");}
 catch(e){msg(e.message)}finally{$("prepare").disabled=false}
});
refresh().catch(e=>msg(e.message));