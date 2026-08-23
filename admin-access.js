import './honor-cycle-selector.js';
export async function loadAdminAccess(sb){
  const{data:{session}}=await sb.auth.getSession();
  if(!session?.user||session.user.app_metadata?.role!=='admin')throw new Error('admin_required');
  const{data,error}=await sb.functions.invoke('admin-manager',{body:{action:'me'}});
  if(error)throw new Error(error.message||'تعذر التحقق من الصلاحيات');
  if(data?.error)throw new Error(data.message||data.error);
  return{session,user:session.user,profile:data.profile,permissions:data.permissions||{},isOwner:!!data.profile?.is_owner};
}
export function accessLevel(ctx,section){return ctx?.isOwner?'edit':(ctx?.permissions?.[section]||'none')}
export function canView(ctx,section){const x=accessLevel(ctx,section);return x==='view'||x==='edit'}
export function canEdit(ctx,section){return accessLevel(ctx,section)==='edit'}
export function levelArabic(level){return level==='edit'?'تعديل':level==='view'?'مشاهدة فقط':'بدون صلاحية'}
export function denyMessage(){return 'ليس لديك صلاحية لفتح هذا القسم.'}
if(location.pathname.endsWith('student-ledger-admin.html'))import('./student-ledger-export.js').catch(e=>console.warn('ledger export',e));
