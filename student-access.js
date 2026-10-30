import {sb} from "./student-identity-api.js";
const $=id=>document.getElementById(id);
const tabButtons=[...document.querySelectorAll("[data-access-tab]")];
const panels={login:$("loginPane"),register:$("signupPane")};
const normalizedCode=value=>String(value||"").trim().toUpperCase().replace(/\s+/g,"");
const emailForCode=code=>code.toLowerCase()+"@students.yrphysicspractice.com";
function chooseTab(tab,{replaceUrl=true,focus=false}={}){
  const next=tab==="login"?"login":"register";
  panels.login.hidden=next!=="login";
  panels.register.hidden=next!=="register";
  panels.login.classList.toggle("hidden",next!=="login");
  panels.register.classList.toggle("hidden",next!=="register");
  for(const button of tabButtons){
    const chosen=button.dataset.accessTab===next;
    button.setAttribute("aria-selected",String(chosen));
    button.tabIndex=chosen?0:-1;
  }
  if(replaceUrl){
    const url=new URL(location.href);
    url.searchParams.set("tab",next);
    history.replaceState(null,"",url.pathname+url.search+url.hash);
  }
  if(focus)(next==="login"?$("accessStudentCode"):$("firstName")).focus({preventScroll:true});
}
tabButtons.forEach(button=>{
  button.addEventListener("click",()=>chooseTab(button.dataset.accessTab,{focus:true}));
  button.addEventListener("keydown",event=>{
    if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;
    event.preventDefault();
    let dest="login";
    if(event.key==="Home")dest="login";
    else if(event.key==="End")dest="register";
    else dest=button.dataset.accessTab==="login"?"register":"login";
    chooseTab(dest,{focus:false});
    document.querySelector('[data-access-tab="'+dest+'"]')?.focus();
  });
});
document.querySelectorAll("[data-switch-to]").forEach(a=>a.addEventListener("click",event=>{
  event.preventDefault();chooseTab(a.dataset.switchTo,{focus:true});
}));
$("accessTogglePassword").onclick=()=>{
  const input=$("accessPassword");input.type=input.type==="password"?"text":"password";
  $("accessTogglePassword").textContent=input.type==="password"?"إظهار":"إخفاء";
  $("accessTogglePassword").setAttribute("aria-label",input.type==="password"?"إظهار كلمة المرور":"إخفاء كلمة المرور");
};
function inform(message,success=false){
  const box=$("loginMessage");
  box.textContent=message;
  box.classList.remove("hidden");
  box.classList.toggle("success",success);
}
$("accessLoginForm").addEventListener("submit",async(event)=>{
  event.preventDefault();
  const button=$("accessLoginBtn");
  if(button.disabled)return;
  const code=normalizedCode($("accessStudentCode").value);
  const password=$("accessPassword").value;
  if(!code||!password){inform("اكتب كود الطالب وكلمة المرور.");return}
  button.disabled=true;
  button.textContent="جارٍ تسجيل الدخول…";
  $("loginMessage").classList.add("hidden");
  try{
    const {data,error}=await sb.auth.signInWithPassword({email:emailForCode(code),password});
    if(error||!data?.user)throw Error("كود الطالب أو كلمة المرور غير صحيحة.");
    if(data.user.app_metadata?.role==="admin"){
      location.replace("admin-home.html");
      return;
    }
    inform("تم تسجيل الدخول. جارٍ تجهيز حسابك…",true);
    try{
      const {identity}=await import("./student-identity-api.js");
      const status=await identity("me");
      if(status.enforcement && status.profile?.is_active &&
         Number(status.profile.profile_schema_version||0)<Number(status.required_profile_schema_version||1)){
        location.replace("student-complete-profile.html");return;
      }
    }catch(checkError){console.warn("Profile completion service unavailable",checkError)}
    location.replace("student.html");
  }catch(error){
    inform(error.message||"تعذر تسجيل الدخول. حاول مرة أخرى.");
    button.disabled=false;
    button.textContent="الدخول إلى منصتي ←";
  }
});
const initial=new URLSearchParams(location.search).get("tab")==="login"?"login":"register";
chooseTab(initial,{replaceUrl:false});
