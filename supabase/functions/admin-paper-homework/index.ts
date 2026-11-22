import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.105.0";
import postgres from "npm:postgres@3.4.7";
import { loadHomeworkAnalytics } from "../_shared/paper-homework-analytics.ts";
import { PaperHomeworkError } from "../_shared/paper-homework-core.ts";
import { readWorkshopJson, WorkshopRequestError } from "../_shared/workshop-security.ts";

const URL=Deno.env.get("SUPABASE_URL")??"";
const KEYS=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")??"{}");
const KEY=KEYS.default??Deno.env.get("SUPABASE_ANON_KEY")??"";
const DB=Deno.env.get("SUPABASE_DB_URL")??"";
const auth=createClient(URL,KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const sql=postgres(DB,{prepare:false,max:3,idle_timeout:20});
const origins=new Set(["https://youssefrezk441-oss.github.io","http://127.0.0.1:8000","http://localhost:8000"]);
const text=(value:unknown,max=200)=>String(value??"").normalize("NFKC").trim().slice(0,max);
function headers(req:Request){const origin=req.headers.get("origin")??"";return{"Access-Control-Allow-Origin":origins.has(origin)?origin:"https://youssefrezk441-oss.github.io","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Cache-Control":"no-store","Content-Type":"application/json; charset=utf-8","Vary":"Origin"}}
const respond=(req:Request,value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:headers(req)});
async function requireAdmin(req:Request){const token=(req.headers.get("authorization")??"").replace(/^Bearer\s+/,"");if(!token)return null;const{data,error}=await auth.auth.getUser(token);if(error||!data.user)return null;const[permission]=await sql`select public.admin_access_level('students', ${data.user.id}::uuid) as level`;return permission?.level&&permission.level!=="none"?{user:data.user,level:permission.level}:null}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: headers(req) });
  if (req.method !== "POST") return respond(req, { error: "method_not_allowed" }, 405);
  let action = "";
  try {
    const admin = await requireAdmin(req);
    if (!admin) return respond(req, { error: "unauthorized", message: "لا توجد صلاحية إدارية." }, 401);
    const body = await readWorkshopJson(req, 32 * 1024);
    action = text(body.action, 40);
    return respond(req, await loadHomeworkAnalytics(sql, action, body, admin.level));
  } catch (error) {
    if (error instanceof WorkshopRequestError || error instanceof PaperHomeworkError) {
      return respond(req, { error: error.code, message: error.message }, error.status);
    }
    console.error("admin-paper-homework", action, error instanceof Error ? error.message : error);
    return respond(req, { error: "server_error", message: "تعذر تحميل التقرير." }, 500);
  }
});
