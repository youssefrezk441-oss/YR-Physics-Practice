from pathlib import Path
import re


def f(name): return Path(name).read_text(encoding='utf-8')
def w(name,s): Path(name).write_text(s,encoding='utf-8')
def rep(s,a,b,label):
    if b in s: return s
    if a not in s: raise SystemExit('missing '+label)
    return s.replace(a,b,1)

# sessions-admin.html
n='sessions-admin.html';s=f(n)
if "['مكتمل بإتقان',mastered]" not in s:
    new="""function updateStats(){let present=0,absent=0,mastered=0,done=0,partial=0,notSubmitted=0,legacyDone=0,scored=0,testAbsent=0,pending=0;for(const r of rows){if(r.attendance==='absent'){absent++;if($('hasHomework').checked)notSubmitted++;if($('hasTest').checked)testAbsent++}else{present++;if($('hasHomework').checked){if(r.homework_status==='mastered')mastered++;else if(r.homework_status==='done')done++;else if(r.homework_status==='partial')partial++;else if(r.homework_status==='not_submitted')notSubmitted++;else if(r.homework_status==='legacy_done')legacyDone++;else notSubmitted++}if($('hasTest').checked){if(r.test_score===''||r.test_score==null)pending++;else scored++}}}
let cards=[['الحضور',present],['الغياب',absent]];if($('hasHomework').checked){cards.push(['مكتمل بإتقان',mastered],['مكتمل',done],['ناقص',partial],['لم يسلم',notSubmitted]);if(legacyDone)cards.push(['تم — سجل سابق',legacyDone])}if($('hasTest').checked)cards.push(['أدى الاختبار',scored],['غائب عن الاختبار',testAbsent],['لم تدخل الدرجة',pending]);$('stats').innerHTML=cards.map(x=>`<div class=\"stat\"><b>${x[1]}</b><span>${x[0]}</span></div>`).join('');$('saveSummary').textContent=`حاضر ${present} · غائب ${absent}`+($('hasHomework').checked?` · بإتقان ${mastered} · مكتمل ${done} · ناقص ${partial} · لم يسلم ${notSubmitted}`+(legacyDone?` · سجل سابق ${legacyDone}`:''):'')+($('hasTest').checked?` · درجات ناقصة ${pending}`:'')}"""
    s,k=re.subn(r"function updateStats\(\)\{.*?\n\nfunction renderRows\(\)",new+'\n\nfunction renderRows()',s,count=1,flags=re.S)
    if k!=1: raise SystemExit('missing updateStats')
a='''<select data-field="homework" ${r.attendance==='absent'?'disabled':''}><option value="done" ${r.homework_status==='done'?'selected':''}>تم</option><option value="partial" ${r.homework_status==='partial'?'selected':''}>ناقص</option><option value="not_submitted" ${r.homework_status==='not_submitted'?'selected':''}>لم يسلم</option></select>'''
b='''<select data-field="homework" ${r.attendance==='absent'?'disabled':''}><option value="legacy_done" ${r.homework_status==='legacy_done'?'selected':'disabled hidden'}>تم — سجل سابق</option><option value="mastered" ${r.homework_status==='mastered'?'selected':''}>مكتمل بإتقان</option><option value="done" ${r.homework_status==='done'?'selected':''}>مكتمل</option><option value="partial" ${r.homework_status==='partial'?'selected':''}>ناقص</option><option value="not_submitted" ${r.homework_status==='not_submitted'?'selected':''}>لم يسلم</option></select>'''
s=rep(s,a,b,'homework select');w(n,s)

# student-base.html
n='student-base.html';s=f(n)
s=rep(s,"function homeworkAr(v,has){if(!has)return{t:'لا يوجد واجب',c:'trendUnknown'};if(v==='done')return{t:'تم الواجب',c:'trendDone'};if(v==='partial')return{t:'واجب ناقص',c:'trendPartial'};if(v==='not_submitted')return{t:'لم يسلم',c:'trendMissing'};return{t:'غير مسجل',c:'trendUnknown'}}","function homeworkAr(v,has){if(!has)return{t:'لا يوجد واجب',c:'trendUnknown'};if(v==='mastered')return{t:'مكتمل بإتقان',c:'trendPresent'};if(v==='done')return{t:'مكتمل',c:'trendDone'};if(v==='partial')return{t:'ناقص',c:'trendPartial'};if(v==='not_submitted')return{t:'لم يسلم',c:'trendMissing'};if(v==='legacy_done')return{t:'تم — سجل سابق',c:'trendUnknown'};return{t:'غير مسجل',c:'trendUnknown'}}",'student labels')
s=rep(s,"$('commitmentHomeworkDetail').textContent=s.homework_rate==null?'لا توجد واجبات بحالة قابلة للحساب':`تم ${s.homework_done||0} · ناقص ${s.homework_partial||0} · لم يسلم ${s.homework_not_submitted||0}`;","$('commitmentHomeworkDetail').textContent=s.homework_rate==null?'لا توجد واجبات مسجلة':`بإتقان ${s.homework_mastered||0} · مكتمل ${s.homework_done||0} · ناقص ${s.homework_partial||0} · لم يسلم ${s.homework_not_submitted||0}`+(Number(s.homework_legacy_done||0)?` · سجل سابق ${s.homework_legacy_done}`:'');",'commitment breakdown')
s=rep(s,"const unknown=Number(s.homework_unknown||0);$('commitmentFootnote').textContent='مؤشر الالتزام يقيس الانضباط والمتابعة وليس المستوى العلمي مباشرة.'+(unknown?` يوجد ${unknown} واجب قديم حالته غير مسجلة وتم استبعاده من حساب الواجب حتى لا يؤثر عليك.`:'')","const unknown=Number(s.homework_unknown||0);$('commitmentFootnote').textContent='مؤشر الالتزام يقيس الانضباط والمتابعة وليس المستوى العلمي مباشرة. الواجب المُكلّف يدخل في الحساب دائمًا.'+(unknown?` يوجد ${unknown} واجب حالته غير مسجلة ويُحسب صفرًا حتى تصحيحها.`:'')",'commitment footnote')
s=rep(s,"const homeworkDetail=Number(h.done||0)+' كامل · '+Number(h.partial||0)+' ناقص · '+Number(h.not_submitted||0)+' لم يسلم';","const homeworkDetail=Number(h.mastered||0)+' بإتقان · '+Number(h.done||0)+' مكتمل · '+Number(h.partial||0)+' ناقص · '+Number(h.not_submitted||0)+' لم يسلم'+(Number(h.legacy_done||0)?' · '+Number(h.legacy_done)+' سجل سابق':'');",'assessment breakdown')
s=rep(s,"function honorBadges(list){return (list||[]).map(x=>`<span class=\"honorBadge\">${esc(x)}</span>`).join('')}","function honorBadges(list){return (list||[]).map(x=>x==='واجب كامل'?'إتقان الواجب':x).map(x=>`<span class=\"honorBadge\">${esc(x)}</span>`).join('')}",'honor badge')
s=s.replace("honorAwardCard('📚','وسام الواجب الكامل',g.awards?.perfect_homework)","honorAwardCard('📚','وسام إتقان الواجب',g.awards?.perfect_homework)");w(n,s)

# student.html
n='student.html';s=f(n)
s=rep(s,"function journeyHomeworkText(v,has){if(!has)return 'لا يوجد واجب';if(v==='done')return 'واجب كامل';if(v==='partial')return 'واجب ناقص';if(v==='not_submitted')return 'لم يسلّم';return 'غير مسجل'}","function journeyHomeworkText(v,has){if(!has)return 'لا يوجد واجب';if(v==='mastered')return 'مكتمل بإتقان';if(v==='done')return 'مكتمل';if(v==='partial')return 'ناقص';if(v==='not_submitted')return 'لم يسلّم';if(v==='legacy_done')return 'تم — سجل سابق';return 'غير مسجل'}",'journey label')
s=rep(s,"$('journeyHomeworkDetail').textContent=Number(h.done||0)+' كامل · '+Number(h.partial||0)+' ناقص · '+Number(h.not_submitted||0)+' لم يسلّم';","$('journeyHomeworkDetail').textContent=Number(h.mastered||0)+' بإتقان · '+Number(h.done||0)+' مكتمل · '+Number(h.partial||0)+' ناقص · '+Number(h.not_submitted||0)+' لم يسلّم'+(Number(h.legacy_done||0)?' · '+Number(h.legacy_done)+' سجل سابق':'');",'journey breakdown');w(n,s)

# student-ledger-admin.html
n='student-ledger-admin.html';s=f(n)
s=rep(s,"!v.has_homework?'لا يوجد':v.homework_status==='done'?'تم':v.homework_status==='partial'?'ناقص':v.homework_status==='not_submitted'?'لم يسلم':'غير مسجل'","!v.has_homework?'لا يوجد':v.homework_status==='mastered'?'مكتمل بإتقان':v.homework_status==='done'?'مكتمل':v.homework_status==='partial'?'ناقص':v.homework_status==='not_submitted'?'لم يسلم':v.homework_status==='legacy_done'?'تم — سجل سابق':'غير مسجل'",'ledger label');w(n,s)

# admin-honor.html
n='admin-honor.html';s=f(n)
s=rep(s,"function badges(a){return(a||[]).map(x=>`<span class=\"badge\">${esc(x)}</span>`).join('')}","function badges(a){return(a||[]).map(x=>x==='واجب كامل'?'إتقان الواجب':x).map(x=>`<span class=\"badge\">${esc(x)}</span>`).join('')}",'admin honor badge')
s=s.replace("awardCard('📚 وسام الواجب الكامل',g.awards?.perfect_homework)","awardCard('📚 وسام إتقان الواجب',g.awards?.perfect_homework)")
s=s.replace('الحضور والواجب الكامل يُعرضان كأوسمة جماعية عند 100% بدل ترتيب المتعادلين.','الحضور الكامل وإتقان الواجب يُعرضان كأوسمة جماعية عند 100% بدل ترتيب المتعادلين.');w(n,s)

print('Homework rubric v2 frontend patch completed')
