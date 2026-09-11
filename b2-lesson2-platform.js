(()=>{
  const FN='b2-lesson2-workshop';
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const style=document.createElement('style');
  style.textContent=`.l2PlatformGate{position:fixed;inset:0;z-index:10060;display:grid;place-items:center;background:#f2f4f5;color:#16324f;padding:20px;font-family:Tahoma,Arial,sans-serif}.l2PlatformGateBox{background:#fff;border:1px solid #d9dfe2;border-radius:16px;box-shadow:0 14px 38px rgba(22,50,79,.10);padding:24px;max-width:520px;text-align:center;line-height:1.8;font-weight:800}body.l2PlatformPending>.shell,body.l2PlatformPending>.img-modal{visibility:hidden}`;
  document.head.appendChild(style);
  document.body.classList.add('l2PlatformPending');
  const gate=document.createElement('div');
  gate.className='l2PlatformGate';gate.id='l2PlatformGate';
  gate.innerHTML='<div class="l2PlatformGateBox">جاري التحقق من صلاحية الدخول إلى الورشة...</div>';
  document.body.prepend(gate);

  function deny(msg){
    document.body.classList.remove('l2PlatformPending');
    gate.innerHTML='<div class="l2PlatformGateBox" style="color:#8a423d"><b>تعذر فتح الورشة.</b><br>'+esc(msg||'هذه الورشة غير متاحة لهذا الحساب.')+'<br><br><a href="student.html" style="color:#3166a8">العودة إلى المنصة</a></div>';
    document.querySelector('.shell')?.remove();
  }

  (async()=>{
    try{
      const base=await (await fetch('./student-base.html',{cache:'no-store'})).text();
      const m=base.match(/const URL='([^']+)',KEY='([^']+)'/);
      if(!m) throw new Error('تعذر تهيئة اتصال المنصة.');
      const mod=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.105.0/+esm');
      const sb=mod.createClient(m[1],m[2],{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
      const {data:{session}}=await sb.auth.getSession();
      if(!session) throw new Error('سجل الدخول إلى المنصة أولًا.');

      async function call(body){
        const {data,error}=await sb.functions.invoke(FN,{body});
        if(error){
          let msg=error.message||'تعذر الاتصال بخدمة الورشة.';
          try{if(error.context&&typeof error.context.json==='function'){const p=await error.context.json();msg=p?.message||p?.error||msg}}catch{}
          throw new Error(msg);
        }
        if(data?.error) throw new Error(data.message||data.error);
        return data;
      }

      await call({action:'ping'});
      const loaded=await call({action:'load'});
      state={answers:{},checked:{},correct:{}};
      for(const r of (loaded.responses||[])){
        state.answers[r.question_id]=r.answer_payload;
        state.checked[r.question_id]=true;
        if(r.is_correct===true||r.is_correct===false) state.correct[r.question_id]=r.is_correct;
      }
      save();render();
      document.body.classList.remove('l2PlatformPending');gate.remove();

      $('checkBtn').onclick=async()=>{
        const q=qs()[index],ans=collect(q),fb=$('feedback');
        if(!nonempty(ans)){fb.className='feedback bad';fb.textContent='اكتب إجابتك أولًا.';return}
        const btn=$('checkBtn');btn.disabled=true;
        try{
          state.answers[q.id]=ans;save();
          const res=await call({action:'save',question_id:q.id,answer:ans});
          state.checked[q.id]=true;
          if(res.is_correct===true||res.is_correct===false)state.correct[q.id]=res.is_correct;else delete state.correct[q.id];
          save();
          fb.className='feedback '+(res.is_correct===true?'good':res.is_correct===false?'bad':'saved');
          fb.textContent=res.message||'تم تسجيل الإجابة.';
          renderFigure(q,true);updateStats();renderGrid();renderSidebar();buildPrint();
        }catch(e){fb.className='feedback bad';fb.textContent=e.message||'تعذر حفظ الإجابة الآن.'}finally{btn.disabled=false}
      };

      $('clearBtn').onclick=async()=>{
        const q=qs()[index],btn=$('clearBtn');btn.disabled=true;
        try{await call({action:'clear',question_id:q.id});delete state.answers[q.id];delete state.checked[q.id];delete state.correct[q.id];save();render()}
        catch(e){const fb=$('feedback');fb.className='feedback bad';fb.textContent=e.message||'تعذر مسح الإجابة الآن.'}finally{btn.disabled=false}
      };

      $('resetBtn').onclick=async()=>{
        if(!confirm('هل تريد مسح كل إجابات ورشة الدرس الثاني؟'))return;
        const btn=$('resetBtn');btn.disabled=true;
        try{await call({action:'reset'});state={answers:{},checked:{},correct:{}};save();skillFilter='ALL';index=0;render()}
        catch(e){alert(e.message||'تعذر إعادة المحاولة الآن.')}finally{btn.disabled=false}
      };
    }catch(e){deny(e.message||'هذه الورشة غير متاحة لهذا الحساب.')}
  })();
})();
