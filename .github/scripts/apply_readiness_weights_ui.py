from pathlib import Path

# Student page
p=Path('student.html')
s=p.read_text(encoding='utf-8')
helper=r'''
function assessmentReadinessCalc(d){
  const p=d.pre_comprehensive||{},c=d.cycle||{},w=c.weights||{};
  const num=v=>v==null?null:Number(v);
  const attendance=num(p.attendance?.rate),homework=num(p.homework?.rate),quizzes=num(p.quizzes?.score_ratio);
  const completion=num(p.platform?.completion_rate)??0;
  let quality=num(p.platform?.quality_ratio);
  if(quality==null&&Number(p.platform?.completed_trainings||0)===0)quality=0;
  const qW=num(w.quizzes)??40,plW=num(w.platform)??30,hW=num(w.homework)??20,aW=num(w.attendance)??10;
  const qualityW=(num(w.platform_quality)??60)/100,completionW=(num(w.platform_completion)??40)/100;
  const platformScore=quality==null?null:Math.round((quality*qualityW+completion*completionW+Number.EPSILON)*10)/10;
  const ready=Boolean(c.weights_approved)&&Boolean(p.data_complete)&&[attendance,homework,quizzes,platformScore].every(v=>v!=null&&Number.isFinite(v));
  const score=ready?Math.round((quizzes*qW/100+platformScore*plW/100+homework*hW/100+attendance*aW/100+Number.EPSILON)*10)/10:null;
  return{score,platformScore,attendance,homework,quizzes,completion,quality,qW,plW,hW,aW,qualityW:Math.round(qualityW*100),completionW:Math.round(completionW*100)};
}
function renderAssessmentReadiness(d){
  const box=$('assessmentBody');if(!box)return;const old=$('assessmentReadinessCard');if(old)old.remove();
  const r=assessmentReadinessCalc(d),p=d.pre_comprehensive||{};
  const pending=Number(p.pending_essay_answers||0),scoreText=r.score==null?'مبدئي':r.score+'%';
  const reason=r.score==null?(pending?`يوجد ${pending} إجابة مقالية قبل الشامل ما زالت تنتظر المراجعة.`:'البيانات المطلوبة لم تكتمل بعد.'):'مؤشر الاستعداد مكتمل لهذه الجولة.';
  const el=document.createElement('div');el.id='assessmentReadinessCard';el.className='card';el.style.cssText='border:1px solid #c7d2fe;background:linear-gradient(135deg,#f8faff,#eef2ff);padding:20px';
  el.innerHTML=`<div style="display:flex;justify-content:space-between;gap:16px;align-items:center;flex-wrap:wrap"><div><div style="font-weight:950;color:#000073">🎯 مؤشر الاستعداد قبل الشامل</div><div style="font-size:42px;font-weight:950;line-height:1.15;margin:7px 0;color:#000073">${scoreText}</div><div class="small muted">${esc(reason)}</div></div><div style="font-size:12px;line-height:1.9;background:#fff;border:1px solid #dbe4ff;border-radius:13px;padding:10px 13px"><b>40%</b> كويزات · <b>30%</b> منصة · <b>20%</b> واجب · <b>10%</b> حضور<br><span class="muted">داخل المنصة: ${r.qualityW}% جودة الأداء + ${r.completionW}% الإكمال</span></div></div><div class="assessmentGrid" style="margin-top:14px"><div class="assessmentMetric"><span>🧪 الكويزات · 40%</span><b>${r.quizzes==null?'—':r.quizzes+'%'}</b></div><div class="assessmentMetric"><span>🚀 المنصة · 30%</span><b>${r.platformScore==null?'—':r.platformScore+'%'}</b><div class="small muted">جودة ${r.quality==null?'—':r.quality+'%'} · إكمال ${r.completion}%</div></div><div class="assessmentMetric"><span>📚 الواجب · 20%</span><b>${r.homework==null?'—':r.homework+'%'}</b></div><div class="assessmentMetric"><span>📅 الحضور · 10%</span><b>${r.attendance==null?'—':r.attendance+'%'}</b></div></div>`;
  box.prepend(el);
}
'''
if 'function assessmentReadinessCalc(d)' not in s:
    marker='async function openAssessmentCycleView()'
    if marker not in s: raise SystemExit('student assessment marker missing')
    s=s.replace(marker,helper+'\n'+marker,1)
old="renderAssessmentCycle(d);$('assessmentLoading').classList.add('hidden');"
new="renderAssessmentCycle(d);renderAssessmentReadiness(d);$('assessmentLoading').classList.add('hidden');"
if old in s:s=s.replace(old,new,1)
elif new not in s:raise SystemExit('student readiness call target missing')
p.write_text(s,encoding='utf-8')

# Admin assessment page
p=Path('assessment-admin.html')
a=p.read_text(encoding='utf-8')
if 'function adminReadiness(r,c)' not in a:
    marker='async function load(){'
    helper2=r'''function adminReadiness(r,c){const w=c.weights||{},num=v=>v==null?null:Number(v),att=num(r.attendance_rate),hw=num(r.homework_rate),q=num(r.quiz_ratio),completion=num(r.platform_completion_rate)??0;let quality=num(r.platform_quality_ratio);if(quality==null&&Number(r.platform_completed||0)===0)quality=0;const pq=(num(w.platform_quality)??60)/100,pc=(num(w.platform_completion)??40)/100,platform=quality==null?null:Math.round((quality*pq+completion*pc+Number.EPSILON)*10)/10;if(!r.data_complete||[att,hw,q,platform].some(v=>v==null||!Number.isFinite(v)))return null;return Math.round((q*(num(w.quizzes)??40)/100+platform*(num(w.platform)??30)/100+hw*(num(w.homework)??20)/100+att*(num(w.attendance)??10)/100+Number.EPSILON)*10)/10}'''
    if marker not in a:raise SystemExit('admin load marker missing')
    a=a.replace(marker,helper2+marker,1)
a=a.replace('grid-template-columns:165px 80px 90px 90px 135px 135px 110px 110px 100px','grid-template-columns:165px 80px 90px 90px 135px 135px 110px 110px 105px 100px',1)
a=a.replace('min-width:1080px','min-width:1190px',1)
a=a.replace('<div>بعد الشامل</div><div>الحالة</div>','<div>بعد الشامل</div><div>الاستعداد</div><div>الحالة</div>',1)
a=a.replace("$('weightNote').innerHTML=c.weights_approved?'تم اعتماد أوزان مؤشر الاستعداد.':", "$('weightNote').innerHTML=c.weights_approved?'<b>الأوزان المعتمدة:</b> 40% كويزات + 30% تدريبات المنصة + 20% الواجب + 10% الحضور. <span class=\"small\">داخل المنصة: 60% جودة الأداء + 40% الإكمال.</span>':",1)
old="const platform=`${r.platform_completed||0} / ${r.platform_available||0}<div class=\"small muted\">إكمال ${pct(r.platform_completion_rate)}${r.platform_quality_ratio==null?'':' · أداء '+pct(r.platform_quality_ratio)}</div>`;return `<div class=\"row\">"
new="const platform=`${r.platform_completed||0} / ${r.platform_available||0}<div class=\"small muted\">إكمال ${pct(r.platform_completion_rate)}${r.platform_quality_ratio==null?'':' · أداء '+pct(r.platform_quality_ratio)}</div>`;const ready=adminReadiness(r,c);return `<div class=\"row\">"
if old in a:a=a.replace(old,new,1)
elif 'const ready=adminReadiness(r,c);return' not in a:raise SystemExit('admin row readiness target missing')
old="<div>${r.post_cutoff_attempts?`<span class=\"pill\">${r.post_cutoff_attempts} محاولة</span>`:'—'}</div><div>${r.data_complete?"
new="<div>${r.post_cutoff_attempts?`<span class=\"pill\">${r.post_cutoff_attempts} محاولة</span>`:'—'}</div><div class=\"score\">${ready==null?'<span class=\"pill amber\">مبدئي</span>':ready+'%'}</div><div>${r.data_complete?"
if old in a:a=a.replace(old,new,1)
elif 'ready==null' not in a:raise SystemExit('admin readiness cell target missing')
p.write_text(a,encoding='utf-8')
