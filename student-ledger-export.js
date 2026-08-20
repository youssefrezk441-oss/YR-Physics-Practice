function el(id){return document.getElementById(id)}
function currentSortText(){
  const btn=[...document.querySelectorAll('.sortBtn')].find(b=>String(b.querySelector('.sortArrow')?.textContent||'').trim());
  if(!btn)return 'بدون ترتيب';
  const arrow=String(btn.querySelector('.sortArrow')?.textContent||'').trim();
  const label=String(btn.querySelector('span')?.textContent||'').trim();
  return `${label} ${arrow}`.trim();
}
function currentFilterSummary(){
  const parts=[];
  const search=el('search')?.value?.trim();if(search)parts.push(`بحث: ${search}`);
  const fields=[['grade','الصف'],['center','السنتر'],['group','المجموعة'],['active','النشاط'],['decision','التقييم'],['quick','فلتر سريع']];
  for(const [id,label] of fields){
    const node=el(id);if(!node?.value)continue;
    const text=node.options?.[node.selectedIndex]?.text||node.value;
    parts.push(`${label}: ${text}`);
  }
  parts.push(`الترتيب: ${currentSortText()}`);
  return parts.join(' · ')||'كل الطلاب';
}
function ensurePrintStyle(){
  if(el('ledgerPrintStyle'))return;
  const style=document.createElement('style');style.id='ledgerPrintStyle';style.textContent=`
.printHeader{display:none}
@media print{
  @page{size:A3 landscape;margin:8mm}
  *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
  body{background:#fff!important}
  .wrap{max-width:none!important;padding:0!important}
  .top .toolbar,.filtersCard,.open,.details{display:none!important}
  .top{margin-bottom:8px!important}.brand p{display:none!important}
  .printHeader{display:flex!important;justify-content:space-between;gap:12px;align-items:flex-end;margin:0 0 8px;padding:8px 0;border-bottom:1px solid #d0d5dd;font-size:10px;color:#475467}
  .summary{grid-template-columns:repeat(6,1fr)!important;gap:5px!important;margin-bottom:7px!important}
  .summaryCard{min-height:0!important;padding:7px!important;border-radius:8px!important;box-shadow:none!important;transform:none!important}
  .summaryCard span{font-size:8px!important}.summaryCard b{font-size:17px!important;margin-top:2px!important}
  .tableWrap{box-shadow:none!important;border-radius:0!important;overflow:visible!important;border:1px solid #98a2b3!important}
  .head,.row{min-width:0!important;grid-template-columns:120px 68px minmax(150px,1.4fr) 78px 86px 72px 62px 86px 92px 100px 112px 88px 80px 92px minmax(150px,1.2fr)!important;gap:4px!important;padding:5px 6px!important}
  .head{position:static!important;font-size:7px!important}.sortBtn{font-size:7px!important;padding:1px!important}.sortArrow{display:none!important}
  .row{font-size:7.5px!important;break-inside:avoid;page-break-inside:avoid}
  .name{font-size:8px!important}.metric b{font-size:9px!important}.metric span,.small{font-size:6.5px!important}.pill,.decision,.delta,.actionTag{font-size:6.5px!important;padding:3px 4px!important}
}`;
  document.head.appendChild(style);
}
function ensurePrintHeader(){
  let h=el('printHeader');if(h)return h;
  h=document.createElement('div');h.id='printHeader';h.className='printHeader';
  h.innerHTML='<div><b>سجل الطلاب الشامل — تقرير القرار</b><div id="printFilters"></div></div><div id="printDate"></div>';
  const msg=el('msg');msg?.insertAdjacentElement('afterend',h);return h;
}
function exportVisiblePdf(){
  ensurePrintStyle();ensurePrintHeader();
  const pf=el('printFilters'),pd=el('printDate');
  if(pf)pf.textContent=currentFilterSummary();
  if(pd)pd.textContent='تاريخ التصدير: '+new Date().toLocaleString('ar-EG',{dateStyle:'medium',timeStyle:'short'});
  window.print();
}
function initLedgerExport(){
  if(!location.pathname.endsWith('student-ledger-admin.html'))return;
  ensurePrintStyle();ensurePrintHeader();
  document.querySelector('.card .filters')?.closest('.card')?.classList.add('filtersCard');
  if(el('exportPdf'))return;
  const refresh=el('refresh'),toolbar=refresh?.parentElement;if(!refresh||!toolbar)return;
  const btn=document.createElement('button');btn.id='exportPdf';btn.type='button';btn.className='btn secondary';btn.textContent='تصدير PDF';btn.title='تصدير نفس التقرير الظاهر بعد الفلاتر والترتيب';btn.addEventListener('click',exportVisiblePdf);
  toolbar.insertBefore(btn,refresh);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initLedgerExport,{once:true});else initLedgerExport();
