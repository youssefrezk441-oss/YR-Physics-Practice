import{createClient}from'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.105.0/+esm';
export const sb=createClient('https://ltjdhconuiqblxfjzpzj.supabase.co','sb_publishable_-7SIdrqTmUibqpA7mXXrgg_SHz9EJRr',{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
export async function identity(action,payload={}){const{data,error}=await sb.functions.invoke('student-identity',{body:{action,...payload}});if(error||data?.error)throw new Error(data?.message||error?.message||'تعذر تنفيذ الطلب');return data}
export const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function message(text,ok=false){const el=$('message');el.className=`accountMsg ${ok?'ok':'err'}`;el.textContent=text;el.classList.remove('hidden')}
