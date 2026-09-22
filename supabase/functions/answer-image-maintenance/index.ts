import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.105.0";
import postgres from "npm:postgres@3.4.7";

const BUCKET="answer-images";
const LIMIT_BYTES=700*1024*1024;
const PRESSURE_FREE_BYTES=300*1024*1024;
const KEEP_DAYS=7;
const C={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const j=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...C,"Content-Type":"application/json; charset=utf-8"}});
const url=Deno.env.get("SUPABASE_URL")??"";
const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const db=Deno.env.get("SUPABASE_DB_URL")??"";
const sb=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
const sql=postgres(db,{prepare:false,max:1,idle_timeout:10});

async function removeRows(rows:any[],reason:string){
 let files=0,bytes=0;
 for(let i=0;i<rows.length;i+=100){
  const batch=rows.slice(i,i+100),paths=batch.map((r:any)=>String(r.object_path));
  const {error}=await sb.storage.from(BUCKET).remove(paths);
  if(error)throw new Error(`storage_remove_failed: ${error.message}`);
  const ids=batch.map((r:any)=>String(r.id));
  await sql`update public.response_answer_images set deleted_at=now(),deletion_reason=${reason} where id=any(${ids}::uuid[]) and deleted_at is null`;
  files+=batch.length;bytes+=batch.reduce((a:number,r:any)=>a+Number(r.size_bytes||0),0);
 }
 return{files,bytes};
}

Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:C});
 if(req.method!=='POST')return j({error:'method_not_allowed'},405);
 const supplied=req.headers.get('x-maintenance-token')??'';
 if(!supplied)return j({error:'unauthorized'},401);
 try{
  const [auth]=await sql`select exists(select 1 from vault.decrypted_secrets where name='yr_answer_image_maintenance_token' and decrypted_secret=${supplied}) allowed`;
  if(!auth?.allowed)return j({error:'unauthorized'},401);
  const [before]=await sql`select coalesce(sum(size_bytes),0)::bigint active_bytes,count(*)::int active_files from public.response_answer_images where deleted_at is null`;
  let oldFiles=0,oldBytes=0,pressureFiles=0,pressureBytes=0;

  const expired=await sql`
    select id,object_path,size_bytes
    from public.response_answer_images
    where deleted_at is null
      and keep_image=false
      and clarity_status<>'needs_manual'
      and graded_at is not null
      and graded_at<=now()-interval '7 days'
    order by graded_at asc,uploaded_at asc`;
  if(expired.length){const r=await removeRows(expired,'retention_7_days_after_grading');oldFiles=r.files;oldBytes=r.bytes;}

  const [mid]=await sql`select coalesce(sum(size_bytes),0)::bigint active_bytes from public.response_answer_images where deleted_at is null`;
  if(Number(mid.active_bytes)>=LIMIT_BYTES){
   const candidates=await sql`
     select id,object_path,size_bytes
     from public.response_answer_images
     where deleted_at is null
       and keep_image=false
       and clarity_status<>'needs_manual'
       and graded_at is not null
       and graded_at<=now()-interval '7 days'
     order by graded_at asc,uploaded_at asc`;
   const picked:any[]=[];let target=0;
   for(const r of candidates){picked.push(r);target+=Number(r.size_bytes||0);if(target>=PRESSURE_FREE_BYTES)break;}
   if(picked.length){const r=await removeRows(picked,'pressure_700mb_free_300mb_after_retention');pressureFiles=r.files;pressureBytes=r.bytes;}
  }

  const [after]=await sql`select coalesce(sum(size_bytes),0)::bigint active_bytes,count(*)::int active_files from public.response_answer_images where deleted_at is null`;
  const totalFiles=oldFiles+pressureFiles,totalBytes=oldBytes+pressureBytes;
  await sql`insert into private.answer_image_cleanup_runs(trigger_type,bytes_before,bytes_after,files_deleted,bytes_deleted,old_files_deleted,pressure_files_deleted,note) values('edge_maintenance',${Number(before.active_bytes)},${Number(after.active_bytes)},${totalFiles},${totalBytes},${oldFiles},${pressureFiles},'never delete before 7 days after grading; ungraded, manual-review and pinned images are exempt')`;
  return j({ok:true,policy:{retention_days_after_grading:KEEP_DAYS,limit_mib:700,pressure_free_mib:300,never_delete_before_retention:true,ungraded_exempt:true,manual_review_exempt:true,pinned_exempt:true},before:{files:Number(before.active_files),bytes:Number(before.active_bytes)},deleted:{files:totalFiles,bytes:totalBytes,expired_files:oldFiles,pressure_files:pressureFiles},after:{files:Number(after.active_files),bytes:Number(after.active_bytes)}});
 }catch(e){console.error('answer-image-maintenance',e);return j({error:'maintenance_failed'},500);}
});
