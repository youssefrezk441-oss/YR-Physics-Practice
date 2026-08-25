const page=(location.pathname.split('/').pop()||'').toLowerCase();
if(page==='student-ledger-admin.html'){
  const KEY='yrLedgerCycleMode';
  const mode=()=>localStorage.getItem(KEY)==='current'?'current':'foundation';
  const nativeFetch=globalThis.fetch.bind(globalThis);
  let lastCycles=null;

  globalThis.fetch=async function(input,init={}){
    const url=typeof input==='string'?input:(input instanceof Request?input.url:String(input));
    if(!url.includes('/functions/v1/admin-student-ledger'))return nativeFetch(input,init);
    let body={};
    try{
      const raw=init?.body!=null?String(init.body):(input instanceof Request?await input.clone().text():'');
      if(raw)body=JSON.parse(raw);
    }catch{body={}}
    body.cycle_mode=mode();
    let response;
    if(input instanceof Request){
      const headers=new Headers(input.headers);headers.set('Content-Type','application/json');
      response=await nativeFetch(new Request(input,{method:init.method||input.method,headers,body:JSON.stringify(body)}));
    }else{
      const headers=new Headers(init?.headers||{});headers.set('Content-Type','application/json');
      response=await nativeFetch(input,{...init,headers,body:JSON.stringify(body)});
    }
    try{
      const d=await response.clone().json();
      if(d?.cycles){lastCycles=d.cycles;setTimeout(renderCycleInfo,0)}
    }catch{}
    return response;
  };

  function ensureStyle(){
    if(document.getElementById('ledgerCycleStyle'))return;
    const s=document.createElement('style');s.id='ledgerCycleStyle';s.textContent=`
      .ledgerCycleCard{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;border:1px solid #c7d7fe;background:linear-gradient(135deg,#f8faff,#eef4ff);border-radius:17px;padding:14px 16px;margin-bottom:14px}.ledgerCycleMain{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.ledgerCycleMain label{font-size:12px;font-weight:950;color:#344054}.ledgerCycleMain select{min-width:280px;border:1px solid #b8c5e0;border-radius:11px;padding:10px 12px;background:#fff;color:#172033;font:inherit;font-weight:900}.ledgerCycleInfo{font-size:11px;color:#475467;line-height:1.7}.ledgerCycleInfo b{color:#000073}.ledgerCycleBadge{display:inline-block;padding:5px 8px;border-radius:999px;background:#fff;border:1px solid #d0d5dd;font-size:10px;font-weight:900;margin-inline-start:5px}@media(max-width:650px){.ledgerCycleCard{align-items:stretch}.ledgerCycleMain{width:100%}.ledgerCycleMain select{width:100%;min-width:0}}
    `;document.head.appendChild(s);
  }
  function renderCycleInfo(){
    const info=document.getElementById('ledgerCycleInfo');if(!info)return;
    const g3=lastCycles?.grade3?.title||'لا توجد دورة';
    const g2=lastCycles?.grade2?.title||'لا توجد دورة';
    info.innerHTML=`<b>تالتة:</b> ${escapeHtml(g3)} <span class="ledgerCycleBadge">${mode()==='current'?'الحالية':'التأسيسي'}</span> · <b>تانية:</b> ${escapeHtml(g2)}`;
  }
  function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
  function init(){
    ensureStyle();
    const msg=document.getElementById('msg');if(!msg||document.getElementById('ledgerCycleCard'))return;
    const box=document.createElement('div');box.id='ledgerCycleCard';box.className='ledgerCycleCard';
    box.innerHTML=`<div class="ledgerCycleMain"><label for="ledgerCycleMode">دورة التقييم المعروضة</label><select id="ledgerCycleMode"><option value="foundation">🧰 الكورس التأسيسي</option><option value="current">🟢 دورة التقييم الحالية</option></select></div><div><div id="ledgerCycleInfo" class="ledgerCycleInfo">جاري تحديد الدورة المستخدمة لكل صف...</div><div class="ledgerCycleInfo">كل الحضور والواجب والكويزات وتدريبات المنصة والشامل والاستعداد تُقرأ من نفس الدورة المختارة.</div></div>`;
    msg.insertAdjacentElement('afterend',box);
    const sel=document.getElementById('ledgerCycleMode');sel.value=mode();
    sel.onchange=()=>{localStorage.setItem(KEY,sel.value);location.reload()};
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
}
