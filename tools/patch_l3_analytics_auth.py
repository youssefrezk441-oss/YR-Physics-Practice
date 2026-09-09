from pathlib import Path

p=Path('admin-l3-workshop-analytics.html')
s=p.read_text(encoding='utf-8')

old1="import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm';"
new1="import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.105.0/+esm';"
old2="const sb=createClient(SUPABASE_URL,SUPABASE_KEY);"
new2="const sb=createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});"
old3="""async function call(action,extra={}){\n  const {data,error}=await sb.functions.invoke(FN,{body:{action,...filters(),...extra}});\n  if(error) throw error;\n  if(data?.error) throw new Error(data.message||data.error);\n  return data;\n}"""
new3="""async function call(action,extra={}){\n  const {data:{session}}=await sb.auth.getSession();\n  if(!session?.access_token) throw new Error('missing_admin_session');\n  const {data,error}=await sb.functions.invoke(FN,{\n    body:{action,...filters(),...extra},\n    headers:{Authorization:`Bearer ${session.access_token}`}\n  });\n  if(error) throw error;\n  if(data?.error) throw new Error(data.message||data.error);\n  return data;\n}"""

for old in (old1,old2,old3):
    if s.count(old)!=1:
        raise SystemExit(f'Expected exactly one anchor, found {s.count(old)}')

s=s.replace(old1,new1,1).replace(old2,new2,1).replace(old3,new3,1)
p.write_text(s,encoding='utf-8')
print('Patched analytics auth/session handling only.')
