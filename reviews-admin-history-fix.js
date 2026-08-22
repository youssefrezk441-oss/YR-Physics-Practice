import{createClient}from'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.105.0/+esm';

if((location.pathname.split('/').pop()||'').toLowerCase()==='reviews-admin.html'){
  const sb=createClient('https://ltjdhconuiqblxfjzpzj.supabase.co','sb_publishable_-7SIdrqTmUibqpA7mXXrgg_SHz9EJRr',{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  const reviewedStates=['correct','incorrect','partial'];
  let reviewTimes=new Map(),stats=null,refreshTimer=null,applying=false;
  const fmt=v=>v?new Date(v).toLocaleString('ar-EG',{dateStyle:'medium',timeStyle:'short'}):'—';
  const idOf=row=>row.querySelector('.open')?.dataset?.id||'';

  function setText(el,value){const s=String(value??'');if(el&&el.textContent!==s)el.textContent=s}

  function applyStats(){
    if(!stats)return;
    const cards=[...document.querySelectorAll('#stats .stat')];
    if(cards.length<4)return;
    setText(cards[0].querySelector('b'),stats.pending_total??0);
    setText(cards[1].querySelector('b'),stats.precutoff_pending??0);
    setText(cards[2].querySelector('b'),stats.pending_attempts??0);
    setText(cards[3].querySelector('b'),stats.reviewed_total??0);
    const label=cards[3].querySelector('.small');
    if(label&&stats.last_reviewed_at)label.title='آخر مراجعة: '+fmt(stats.last_reviewed_at);
  }

  function applyReviewedOrder(){
    if(document.getElementById('mode')?.value!=='reviewed')return;
    const box=document.getElementById('rows');if(!box)return;
    const rows=[...box.querySelectorAll('.reviewrow')];if(rows.length<2)return;
    const desired=[...rows].sort((a,b)=>{
      const ta=Date.parse(reviewTimes.get(idOf(a))||0)||0;
      const tb=Date.parse(reviewTimes.get(idOf(b))||0)||0;
      return tb-ta;
    });
    const current=rows.map(idOf).join('|'),next=desired.map(idOf).join('|');
    if(current!==next){applying=true;desired.forEach(r=>box.appendChild(r));applying=false}
    desired.forEach(row=>{
      const t=reviewTimes.get(idOf(row));if(!t)return;
      const side=row.children[1];const timeEl=side?.querySelector('.muted.small');
      if(timeEl)setText(timeEl,'مراجعة: '+fmt(t));
    });
  }

  function applyAll(){applyStats();applyReviewedOrder()}

  async function refreshMeta(){
    try{
      const [s,r]=await Promise.all([
        sb.rpc('admin_short_text_review_stats'),
        sb.from('admin_short_text_reviews').select('response_id,reviewed_at').in('grading_status',reviewedStates).order('reviewed_at',{ascending:false,nullsFirst:false}).limit(500)
      ]);
      if(s.error)throw s.error;if(r.error)throw r.error;
      stats=s.data||null;reviewTimes=new Map((r.data||[]).map(x=>[String(x.response_id),x.reviewed_at]));
      applyAll();
    }catch(e){console.warn('essay review history fix',e)}
  }

  function scheduleRefresh(ms=120){clearTimeout(refreshTimer);refreshTimer=setTimeout(refreshMeta,ms)}
  function init(){
    const mode=document.getElementById('mode'),refresh=document.getElementById('refresh'),save=document.getElementById('save');
    mode?.addEventListener('change',()=>setTimeout(()=>{applyReviewedOrder();scheduleRefresh(40)},0));
    refresh?.addEventListener('click',()=>scheduleRefresh(350));
    save?.addEventListener('click',()=>scheduleRefresh(700));
    const obs=new MutationObserver(()=>{if(!applying)setTimeout(applyAll,0)});
    const rows=document.getElementById('rows'),statBox=document.getElementById('stats');
    if(rows)obs.observe(rows,{childList:true,subtree:true});
    if(statBox)obs.observe(statBox,{childList:true,subtree:true,characterData:true});
    scheduleRefresh(250);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
}
