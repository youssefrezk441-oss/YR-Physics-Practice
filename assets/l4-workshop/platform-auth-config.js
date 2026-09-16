// Public client configuration used by the existing YR Physics Practice platform.
// Safe for frontend use: this is the publishable key, NOT a service-role secret.
export const SUPABASE_URL = 'https://ltjdhconuiqblxfjzpzj.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_-7SIdrqTmUibqpA7mXXrgg_SHz9EJRr';
export const L4_WORKSHOP_FUNCTION = 'lecture4-workshop';

// Expected platform behavior:
// 1) createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}})
// 2) const { data:{session} } = await sb.auth.getSession()
// 3) if (!session) redirect to student.html
// 4) do NOT determine grade/role only in the browser; the Edge Function enforces authorization server-side.
