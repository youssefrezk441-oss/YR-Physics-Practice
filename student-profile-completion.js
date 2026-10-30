import {sb, identity, $} from "./student-identity-api.js";

/* This wizard intentionally shares the public registration's visual structure,
   but never calls submit_registration or creates a new account. */
const form=$("form"), panels=[...document.querySelectorAll(".step-panel")],
  markers=[...document.querySelectorAll("[data-step-marker]")];
const get=name=>form.elements.namedItem(name);
let me=null,config=null,groups=[],current=0,busy=false,enabled=false;
const clean=s=>String(s??"").normalize("NFKC").trim().replace(/\s+/g," ");
const latin=s=>String(s??"").replace(/[٠-٩]/g,x=>String("٠١٢٣٤٥٦٧٨٩".indexOf(x))).replace(/[۰-۹]/g,x=>String("۰۱۲۳۴۵۶۷۸۹".indexOf(x)));
const phone=s=>latin(s).replace(/[\s\-()]/g,"");
const validPhone=s=>/^(?:01[0125]\d{8}|201[0125]\d{8}|\+201[0125]\d{8})$/.test(phone(s));
function error(text){const b=$("message");b.textContent=text;b.className="accountMsg err";b.classList.remove("hidden");b.scrollIntoView({block:"nearest",behavior:"smooth"})}
function notice(text,isError=false){const b=$("profileLockedMessage");b.textContent=text;b.classList.toggle("error",isError);b.classList.remove("hidden")}
function parts(name){const all=clean(name).split(" ").filter(Boolean);if(all.length<4)return [all[0]||"",all[1]||"",all[2]||"",all.slice(3).join(" ")];return [all[0],all[1],all[2],all.slice(3).join(" ")]}
function fullname(){return ["first_name","second_name","third_name","fourth_name"].map(n=>clean(get(n).value)).join(" ")}
function gradeMatch(g,grade){const actual=clean(g.grade_level);return grade.includes("الثاني") ? actual.includes("الثاني") || actual.startsWith("2") : grade.includes("الثالث") && (actual.includes("الثالث")||actual.startsWith("3"))}
function locationMatch(g,place){
  const code=String(g.group_code??"").toUpperCase(),center=clean(g.center_name).toLowerCase().replace(/\s+/g,"");
  if(!place||place==="غير ذلك"||place==="خصوصي")return true;
  if(place==="ناهيا")return code.startsWith("N")||center.includes("ناهيا");
  if(place==="كفر حكيم")return code.startsWith("K")||center.includes("كفرحكيم");
  return true;
}
function refreshGroups(desired){
 const select=get("group_code"),grade=get("grade_level").value,where=get("attendance_location").value,
  system=get("education_system").value;
 const choice=desired??select.value;
 const isSecond=grade==="الصف الثاني الثانوي";
 const regular=where==="ناهيا"||where==="كفر حكيم";
 const mapped=isSecond&&regular&&["أزهري","بكالوريا","عام"].includes(system)
   ? `${where==="ناهيا"?"N":"K"}2-${system==="أزهري"?"B":"A"}` : "";
 select.replaceChildren(new Option("اختر المجموعة",""));
 const compatible=groups.filter(g=>gradeMatch(g,grade)&&locationMatch(g,where));
 const filtered=isSecond&&regular&&!system ? []
  : mapped ? compatible.filter(g=>g.group_code===mapped) : compatible;
 for(const g of filtered)select.add(new Option(g.group_code+(g.center_name?" — "+g.center_name:""),g.group_code));
 const currentGroup=clean(me?.profile?.group_code);
 if(!mapped && !(isSecond&&regular) && currentGroup&&!filtered.some(g=>g.group_code===currentGroup))
   select.add(new Option(currentGroup+" — مجموعتك الحالية",currentGroup));
 if(mapped&&filtered.length===1)select.value=mapped;
 else if(choice&&[...select.options].some(o=>o.value===choice))select.value=choice;
 select.disabled=!grade||select.options.length===1;
 $("groupHint").textContent=isSecond&&regular&&!system
  ? "اختر النظام التعليمي ليتم تحديد المجموعة تلقائيًا."
  : mapped ? "تم تحديد المجموعة تلقائيًا. إذا كانت مختلفة عن مجموعتك الحالية، سيُرسل طلب تعديل للإدارة."
  : "تغيير الصف أو المجموعة يحتاج مراجعة الإدارة، ومش هيغيّر مجموعتك الحالية تلقائيًا.";
}
function review(){
 const list=[
  ["كود الطالب — ثابت",me?.profile?.student_code],
  ["الاسم الرباعي",fullname()],
  ["الصف الدراسي",get("grade_level").value],
  ["النظام التعليمي",get("education_system").value],
  ["مكان الحضور",get("attendance_location").value],
  ["المجموعة المطلوبة",get("group_code").value],
  ["منطقة السكن",get("residence_area").value||"غير محددة"],
  ["هاتف الطالب",phone(get("student_phone").value)],
  ["هاتف ولي الأمر",phone(get("guardian_phone").value)],
  ["كلمة المرور", $("changePassword").checked?"تغيير اختياري":"بدون تغيير"]
 ];
 const box=$("review");box.replaceChildren();
 for(const [name,value] of list){const div=document.createElement("div"),a=document.createElement("small"),b=document.createElement("strong");div.className="reviewRow";a.textContent=name;b.textContent=value||"—";div.append(a,b);box.append(div)}
}
function controls(){
 panels.forEach((p,i)=>p.hidden=i!==current);
 markers.forEach((m,i)=>{m.classList.toggle("active",i===current);m.classList.toggle("done",i<current);m.querySelector(".stepCircle").textContent=i<current?"✓":String(i+1)});
 $("prev").hidden=current===0;$("next").hidden=current===3;$("submitBtn").hidden=current!==3;
 for(const id of ["prev","next","submitBtn"])$(id).disabled=!enabled||busy;
}
function step(n){current=n;controls();if(n===3)review();form.scrollIntoView({block:"start",behavior:"smooth"})}
function validate(n){
 const panel=panels[n];
 if(n===0){const names=["first_name","second_name","third_name","fourth_name"];for(const key of names){
  const el=get(key);el.setCustomValidity(/^[\p{L}\p{M}\s.'’-]+$/u.test(clean(el.value))?"":"اكتب الاسم بالحروف فقط.");
 }if(fullname().length<8||fullname().length>160)get("first_name").setCustomValidity("تأكد من الاسم الرباعي كاملًا.");
 }
 if(n===1&&(!get("group_code").value||get("group_code").disabled)){error("حدد المجموعة المناسبة أو تواصل مع الإدارة.");return false}
 if(n===2){for(const field of ["student_phone","guardian_phone"]){get(field).setCustomValidity(validPhone(get(field).value)?"":"اكتب رقمًا مصريًا صحيحًا يبدأ 010 أو 011 أو 012 أو 015.");}
  const change=$("changePassword").checked;
  if(change){
   const p=get("new_password").value;
   get("new_password").setCustomValidity(p.length>=10&&/[\p{L}]/u.test(p)&&/[0-9٠-٩]/.test(p)?"":"كلمة المرور الجديدة تحتاج 10 أحرف على الأقل تشمل حروفًا وأرقامًا.");
   get("new_password_confirm").setCustomValidity(p===get("new_password_confirm").value?"":"كلمتا المرور غير متطابقتين.");
  }
 }
 for(const el of panel.querySelectorAll("input,select")){if(!el.disabled&&!el.checkValidity()){el.reportValidity();el.focus();return false}}
 return true;
}
function prefill(result){
 me=result;const p=result.profile||{},d=result.details||{};
 $("fixedStudentCode").value=p.student_code||"—";
 const p4=parts(p.full_name||"");["first_name","second_name","third_name","fourth_name"].forEach((n,i)=>get(n).value=p4[i]);
 const gradeStored=clean(p.grade_level);
 const codeForGrade=clean(p.group_code || p.student_code).toUpperCase();
 const inferredGrade=gradeStored.includes("الثاني")||/^\w*2[-\d]/.test(codeForGrade)?"الصف الثاني الثانوي"
   :gradeStored.includes("الثالث")||gradeStored.startsWith("3")||/^\w*3[-\d]/.test(codeForGrade)?"الصف الثالث الثانوي":"";
 get("grade_level").value=inferredGrade;
 get("education_system").value=d.education_system||"";
 get("attendance_location").value=d.attendance_location||({"ذا فرست - ناهيا":"ناهيا","المستقبل - كفر حكيم":"كفر حكيم"}[p.center_name]||"");
 get("residence_area").value=d.residence_area||"";
 get("student_phone").value=p.student_phone||"";
 get("guardian_phone").value=p.guardian_phone||"";
 refreshGroups(p.group_code);
 $("profileLoading").classList.add("hidden");$("wizard").classList.remove("hidden");enabled=true;controls();
 if(result.pending_change)notice("فيه طلب تعديل بيانات قيد مراجعة الإدارة. تقدر تحدّث أرقام تواصلك حاليًا.");
}
for(const name of ["grade_level","attendance_location","education_system"]){get(name).addEventListener("change",()=>refreshGroups())}
for(const input of form.querySelectorAll("input,select"))input.addEventListener("input",()=>input.setCustomValidity?.(""));
$("changePassword").addEventListener("change",()=>{const yes=$("changePassword").checked;
 $("passwordChangeFields").classList.toggle("hidden",!yes);
 for(const n of ["current_password","new_password","new_password_confirm"]){const el=get(n);el.required=yes;if(!yes){el.value="";el.setCustomValidity("")}}
});
$("next").addEventListener("click",()=>{if(enabled&&!busy&&validate(current)&&current<3)step(current+1)});
$("prev").addEventListener("click",()=>{if(!busy&&current>0)step(current-1)});
form.addEventListener("submit",async(e)=>{
 e.preventDefault();if(!enabled||busy)return;
 for(let i=0;i<4;i++){if(i!==current)step(i);if(!validate(i))return}
 const fields=Object.fromEntries(new FormData(form));
 if(fields.privacy!=="on"){error("اقرأ إشعار الخصوصية ووافق على تحديث البيانات قبل الحفظ.");return}
 busy=true;controls();$("message").classList.add("hidden");
 try{
   const payload={full_name:fullname(),grade_level:fields.grade_level,education_system:fields.education_system,
    attendance_location:fields.attendance_location,group_code:fields.group_code,residence_area:fields.residence_area,
    student_phone:phone(fields.student_phone),guardian_phone:phone(fields.guardian_phone),
    privacy_accepted:true,privacy_notice_version:config.privacy_notice_version};
   const result=await identity("complete_profile_v2",payload);
   if($("changePassword").checked){
    try{await identity("change_password",{current_password:get("current_password").value,new_password:get("new_password").value})}
    catch(passErr){
     error("تم حفظ البيانات، لكن تعذر تغيير كلمة المرور: "+passErr.message+" — يمكنك إعادة المحاولة من نفس الصفحة.");
     return;
    }
   }
   $("wizard").classList.add("hidden");$("receipt").classList.remove("hidden");
   $("profileSaveNotice").textContent=result.pending_change?"تم حفظ بيانات التواصل، وإرسال طلب تعديل بيانات الدراسة أو الاسم إلى الإدارة. يمكنك متابعة دروسك بالمجموعة الحالية.":"تم حفظ بياناتك ويمكنك متابعة تدريباتك.";
 }catch(ex){error(ex.message||"تعذر حفظ البيانات. حاول مرة أخرى.")}
 finally{busy=false;controls()}
});
controls();
try{
 const {data:{session}}=await sb.auth.getSession();
 if(!session?.user){location.replace("student-register.html?tab=login");}
 else{
  const [profile,cfg]=await Promise.all([identity("me"),identity("config")]);
  config=cfg;groups=profile.groups||cfg.groups||[];
  if(!cfg.profile_update_enabled){$("profileLoading").classList.add("hidden");notice("تحديث بيانات الطلاب غير مفعل بعد. يمكن دخول المنصة، وسيتم تفعيل نموذج التحديث بعد اختبار النظام.",true);
    const link=document.createElement("a");link.href="student.html";link.className="accountBtn secondary";link.textContent="العودة إلى المنصة";$("profileLockedMessage").append(document.createTextNode(" "),link);
  }else prefill(profile);
 }
}catch(ex){$("profileLoading").classList.add("hidden");notice("تعذر تحميل بيانات الحساب: "+(ex?.message||"اتصال غير متاح")+". أعد تحميل الصفحة أو تواصل مع الإدارة.",true)}
