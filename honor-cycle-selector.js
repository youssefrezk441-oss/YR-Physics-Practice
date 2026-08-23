const page=(location.pathname.split('/').pop()||'').toLowerCase();
if(page==='admin-honor.html'){
  const KEY={grade3:'yrHonorCycleGrade3',grade2:'yrHonorCycleGrade2'};
  const ACTIVE='yrHonorActiveGrade';
  const nativeFetch=globalThis.fetch.bind(globalThis);
  let catalogs={grade2:[],grade3:[]},loaded=false;
  const selected=g=>localStorage.getItem(KEY[g])||'';
  const currentGrade=()=>document.querySelector('.tab.active')?.dataset?.grade||sessionStorage.getItem(ACTIVE)||'grade3';

  async function patchedFetch(input,init={}){
    const url=typeof input==='string'?input:(input instanceof Request?input.url:String(input));
    if(!url.includes('/functions/v1/student-honor-board'))return nativeFetch(input,init);
    let body={};
    try{
      const raw=init?.body!=null?String(init.body):(input instanceof Request?await input.clone().text():'');
      if(raw)body=JSON.parse(raw);
    }catch{body={}}
    body.cycles={...(body.cycles||{}),grade3:selected('grade3')||undefined,grade2:selected('grade2')||undefined};
    let response;
    if(input instanceof Request){
      const headers=new Headers(input.headers);headers.set('Content-Type','application/json');
      const req=new Request(input,{method:init.method||input.method,headers,body:JSON.stringify(body)});
      response=await nativeFetch(req);
    }else{
      const headers=new Headers(init?.headers||{});headers.set('Content-Type','application/json');
      response=await nativeFetch(input,{...init,headers,body:JSON.stringify(body)});
    }
    try{
      const data=await response.clone().json();
      if(data?.available_cycles){
        catalogs=data.available_cycles;
        for(const g of ['grade3','grade2']){
          const actual=data?.grades?.[g]?.cycle?.id;
          const valid=(catalogs[g]||[]).some(x=>String(x.id)===String(selected(g)));
          if(actual&&!valid)localStorage.setItem(KEY[g],String(actual));
        }
        loaded=true;setTimeout(renderPicker,0);setTimeout(restoreActiveGrade,50);
      }
    }catch{}
    return response;
  }
  globalThis.fetch=patchedFetch;

  function ensureStyle(){
    if(document.getElementById('honorCycleStyle'))return;
    const s=document.createElement('style');s.id='honorCycleStyle';s.textContent=`
      .honorCyclePicker{position:relative;z-index:2;margin-top:14px;display:flex;align-items:center;gap:9px;flex-wrap:wrap;background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.16);padding:10px 12px;border-radius:14px}.honorCyclePicker label{font-size:12px;font-weight:900;color:#dbe4ff}.honorCyclePicker select{min-width:min(470px,100%);max-width:100%;border:1px solid rgba(255,255,255,.22);background:#fff;color:#172033;border-radius:10px;padding:9px 11px;font:inherit;font-weight:800}.honorCycleState{font-size:11px;font-weight:900;border-radius:999px;padding:6px 9px}.honorCycleState.live{background:#dcfae6;color:#067647}.honorCycleState.archived{background:#fff3cd;color:#7a4d00}@media(max-width:600px){.honorCyclePicker{align-items:stretch}.honorCyclePicker select{width:100%;min-width:0}}
    `;document.head.appendChild(s);
  }
  function labelFor(c){return `${c.archived?'📦 مؤرشفة':'🟢 Live'} — ${c.title}${c.code?` · ${c.code}`:''}`}
  function renderPicker(){
    if(!loaded)return;ensureStyle();
    const arena=document.querySelector('.arena'),tabs=arena?.querySelector('.tabs');if(!arena||!tabs)return;
    let box=document.getElementById('honorCyclePicker');
    if(!box){box=document.createElement('div');box.id='honorCyclePicker';box.className='honorCyclePicker';box.innerHTML='<label for="honorCycleSelect">الدورة</label><select id="honorCycleSelect"></select><span id="honorCycleState" class="honorCycleState"></span>';tabs.insertAdjacentElement('afterend',box)}
    const g=currentGrade(),list=catalogs[g]||[],sel=document.getElementById('honorCycleSelect'),state=document.getElementById('honorCycleState');
    const wanted=selected(g);sel.innerHTML=list.map(c=>`<option value="${String(c.id).replace(/"/g,'&quot;')}">${labelFor(c)}</option>`).join('');
    if(list.some(c=>String(c.id)===String(wanted)))sel.value=wanted;else if(list[0])sel.value=String(list[0].id);
    const c=list.find(x=>String(x.id)===String(sel.value));
    if(state){state.textContent=c?.archived?'نسخة ثابتة':'تتحدث تلقائيًا';state.className='honorCycleState '+(c?.archived?'archived':'live')}
    sel.onchange=()=>{localStorage.setItem(KEY[g],sel.value);sessionStorage.setItem(ACTIVE,g);location.reload()};
  }
  function restoreActiveGrade(){
    const g=sessionStorage.getItem(ACTIVE);if(!g)return;
    const btn=document.querySelector(`.tab[data-grade="${g}"]`);if(btn&&!btn.classList.contains('active'))btn.click();
    setTimeout(renderPicker,0);
  }
  function init(){ensureStyle();document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>{const g=b.dataset.grade||'grade3';sessionStorage.setItem(ACTIVE,g);setTimeout(renderPicker,0)}));setTimeout(renderPicker,100)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
}
