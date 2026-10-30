/* Guard every standalone student training page, including visits through saved direct links.
   Uses the same Supabase Auth session and server-owned completion status as the login portal. */
import { sb, identity } from "./student-identity-api.js";
const done=()=>{document.documentElement.removeAttribute("data-yr-profile-pending");document.getElementById("yrProfileGateError")?.remove()};
let checking=null,lastChecked=0,redirecting=false;
const allowed=()=>{done();return true};
function redirect(file){if(redirecting)return;redirecting=true;location.replace("./"+file)}
function showError(){
  done();
  let note=document.getElementById("yrProfileGateError");
  if(!note){
    note=document.createElement("div");
    note.id="yrProfileGateError";note.setAttribute("role","alert");
    Object.assign(note.style,{position:"fixed",inset:"0",zIndex:"2147483647",background:"#f4f8f4",color:"#174a3a",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"28px",textAlign:"center",font:"700 18px/1.9 Tahoma,Arial,sans-serif"});
    const title=document.createElement("p");title.textContent="تعذر التأكد من اكتمال بيانات حسابك حاليًا.";
    const retry=document.createElement("button");retry.type="button";retry.textContent="إعادة المحاولة";
    Object.assign(retry.style,{padding:"12px 25px",border:"0",borderRadius:"10px",background:"#12644f",color:"white",cursor:"pointer",font:"inherit"});
    retry.addEventListener("click",()=>{note.remove();document.documentElement.setAttribute("data-yr-profile-pending","");void check(true)});
    const home=document.createElement("a");home.href="./student.html";home.textContent="العودة إلى منصة الطالب";
    home.style.cssText="margin-top:14px;color:#145b47;font-size:15px";
    note.append(title,retry,home);document.body.append(note);
  }
}
async function check(force=false){
  if(redirecting||checking)return checking;
  if(!force&&Date.now()-lastChecked<5000)return;
  checking=(async()=>{
    try{
      const {data:{session}}=await sb.auth.getSession();
      if(!session?.user){redirect("student-register.html?tab=login");return}
      if(session.user.app_metadata?.role==="admin"){allowed();return}
      const state=await identity("me");
      if(state.review&&!state.review.legacy_account&&state.review.status!=="approved"){
        redirect("student.html");return
      }
      if(state.enforcement&&state.profile?.is_active&&Number(state.profile.profile_schema_version||0)<Number(state.required_profile_schema_version||1)){
        redirect("student-complete-profile.html");return
      }
      allowed();
      lastChecked=Date.now();
    }catch(error){console.warn("Student profile completion guard unavailable",error);showError()}
    finally{checking=null}
  })();
  return checking;
}
function returned(){
  if(document.visibilityState==="hidden"||redirecting)return;
  void check();
}
document.addEventListener("visibilitychange",returned);
window.addEventListener("pageshow",e=>{if(e.persisted)returned()});
window.addEventListener("focus",returned);
void check(true);
