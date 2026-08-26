const toolbar=document.querySelector('.top .toolbar');
if(toolbar&&document.documentElement.dataset.adminAccess==='edit'&&!toolbar.querySelector('[data-quick-review-link]')){
  const a=document.createElement('a');
  a.href='./reviews-quick.html';
  a.className='link permissionEditOnly quick';
  a.dataset.quickReviewLink='1';
  a.textContent='⚡ التصحيح السريع';
  a.style.cssText='background:#ecfdf3;color:#067647;border:1px solid #a7f3d0;border-radius:10px;padding:8px 11px;';
  toolbar.insertBefore(a,toolbar.firstChild);
}
