from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'missing pattern: {label}')
    return text.replace(old, new, 1)

# ---------- student.html ----------
p = Path('student.html')
s = p.read_text(encoding='utf-8')

s = replace_once(s,
    '.honorTopRow{display:grid;grid-template-columns:54px minmax(180px,1.5fr) 84px repeat(4,72px);',
    '.honorTopRow{display:grid;grid-template-columns:54px minmax(180px,1.6fr) 92px 82px 82px;',
    'student top row grid')
s = s.replace('.honorTopRow{min-width:760px}', '.honorTopRow{min-width:650px}')

s = replace_once(s,
    '<div class="honorStats"><div class="honorStat"><span>طلاب مؤهلون للترتيب</span><b id="honorEligible">—</b></div><div class="honorStat"><span id="honorHighestLabel">أعلى مؤشر استعداد</span><b id="honorHighest">—</b></div><div class="honorStat"><span>استعداد مكتمل</span><b id="honorRiseStat">—</b></div><div class="honorStat"><span>المجموعة المتصدرة</span><b id="honorLeadingGroup">—</b></div><div class="honorStat"><span>درجات شامل مدخلة</span><b id="honorGoldCommit">—</b></div></div>',
    '<div class="honorStats"><div class="honorStat"><span>طلاب مؤهلون للترتيب</span><b id="honorEligible">—</b></div><div class="honorStat"><span id="honorHighestLabel">أعلى مؤشر استعداد</span><b id="honorHighest">—</b></div><div class="honorStat"><span>تقييمات قيد المراجعة</span><b id="honorRiseStat">—</b></div><div class="honorStat"><span>المجموعة المتصدرة</span><b id="honorLeadingGroup">—</b></div><div class="honorStat"><span>درجات شامل مدخلة</span><b id="honorGoldCommit">—</b></div></div>',
    'student stats')

old_sections = '''<div class="honorSectionTitle"><div><h3>🏁 سباق الـ Top 10</h3><p>الشامل والاستعداد والكويزات والمنصة لكل متصدر.</p></div></div><div id="honorTop10" class="honorTopList"></div>
<div class="honorSectionTitle"><div><h3 id="honorRiserTitle">📈 نجوم الصعود</h3><p id="honorRiserDesc">أكبر تحسن بين آخر كويزين مسجلين، والغياب يُحسب صفرًا.</p></div></div><div id="honorRisers" class="honorRisers"></div>
<div class="honorSectionTitle"><div><h3>🎖️ أبطال الفئات</h3><p>طرق متعددة للتميز والظهور على اللوحة.</p></div></div><div id="honorCategories" class="honorCategories"></div>'''
new_sections = '''<div class="honorSectionTitle"><div><h3>🏁 سباق الـ Top 10</h3><p>ترتيب مختصر وواضح: النتيجة الحالية، الشامل، والاستعداد.</p></div></div><div id="honorTop10" class="honorTopList"></div>
<div class="honorSectionTitle"><div><h3>🎖️ أبطال الفئات</h3><p>أبطال الشامل والاستعداد والكويزات والمنصة — كل فئة مستقلة.</p></div></div><div id="honorCategories" class="honorCategories"></div>
<div class="honorSectionTitle"><div><h3>⭐ أوسمة الالتزام الكامل</h3><p>الحضور والواجب الكامل يُكرّمان كوسام جماعي عند التعادل على 100%، وليس كترتيب مصطنع.</p></div></div><div id="honorAwards" class="honorCategories"></div>
<div class="honorSectionTitle"><div><h3 id="honorRiserTitle">📈 نجوم الصعود</h3><p id="honorRiserDesc">أكبر تحسن بين آخر كويزين مسجلين، والغياب يُحسب صفرًا.</p></div></div><div id="honorRisers" class="honorRisers"></div>'''
s = replace_once(s, old_sections, new_sections, 'student section order')

start = s.index('function honorTopRows(rows,phase)')
end = s.index('function honorRiserCards(rows,phase)', start)
new_top = '''function honorTopRows(rows,phase){if(!(rows||[]).length)return '<div class="honorEmpty">لا توجد بيانات مكتملة كافية للترتيب حتى الآن.</div>';const final=phase==='final';return `<div class="honorTopRow honorTopHead"><div>المركز</div><div>الطالب</div><div>${final?'النهائي':'الاستعداد'}</div><div>الشامل</div><div>الاستعداد</div></div>`+rows.map(s=>`<div class="honorTopRow"><div><div class="honorRankNum">${s.rank}</div></div><div><div class="honorStudentName">${esc(s.full_name)}</div><div class="honorStudentMeta">${esc(s.group_code||'')} · ${honorBadges(s.badges)}</div></div><div class="honorOverallCell"><b>${honorPct(s.overall)}</b><div class="honorOverallBar"><i style="width:${Math.max(0,Math.min(100,Number(s.overall||0)))}%"></i></div></div>${honorMetricCell('الشامل',s.comprehensive_score)}${honorMetricCell('الاستعداد',s.readiness_score)}</div>`).join('')}
'''
s = s[:start] + new_top + s[end:]

old_cat_start = s.index('function honorCategories(g)')
old_cat_end = s.index('function honorGroupCard', old_cat_start)
new_cat = '''function honorCategories(g){const c=[['🧠','أبطال الشامل','comprehensive','comprehensive_score'],['🎯','أبطال الاستعداد','readiness','readiness_score'],['🧪','فرسان الكويزات','quizzes','quiz_score'],['🚀','نجوم المنصة','platform','platform_score']];return c.map(([icon,title,key,field])=>`<div class="honorCategory"><div class="honorCategoryTitle"><div class="honorCategoryIcon">${icon}</div><h4>${title}</h4></div>${honorLeaderRows(g.leaders?.[key]||[],field)}</div>`).join('')}
function honorAwardCard(icon,title,pack){const a=pack||{},people=a.students||[],shown=people.slice(0,8),more=Math.max(0,Number(a.count||0)-shown.length);return `<div class="honorCategory"><div class="honorCategoryTitle"><div class="honorCategoryIcon">${icon}</div><h4>${title}</h4></div><div style="font-size:30px;font-weight:950;margin:5px 0">${Number(a.count||0)}</div><div class="small muted">طالب/ة حققوا 100%</div>${shown.length?`<div class="podiumBadges" style="justify-content:flex-start;margin-top:10px">${shown.map(x=>`<span class="honorBadge">${esc(x.full_name)}</span>`).join('')}${more?`<span class="honorBadge">+${more}</span>`:''}</div>`:'<div class="honorEmpty" style="padding:12px">لا يوجد حاصلون على الوسام حتى الآن.</div>'}</div>`}
function honorAwards(g){return honorAwardCard('📅','وسام الحضور الكامل',g.awards?.perfect_attendance)+honorAwardCard('📚','وسام الواجب الكامل',g.awards?.perfect_homework)}
'''
s = s[:old_cat_start] + new_cat + s[old_cat_end:]

old_personal = "if(!p.eligible)return `<div class=\"honorPersonal\"><div class=\"honorRankOrb\"><div><b>—</b><span>مركزك</span></div></div><div><h3>مكانك في السباق</h3><p>${esc(p.message||'بانتظار اكتمال البيانات.')}</p>"
new_personal = "if(!p.eligible)return `<div class=\"honorPersonal\"><div class=\"honorRankOrb\"><div><b>${p.review_pending?'⏳':'—'}</b><span>${p.review_pending?'قيد المراجعة':'مركزك'}</span></div></div><div><h3>${p.review_pending?'ترتيبك قيد المراجعة':'مكانك في السباق'}</h3><p>${esc(p.message||'بانتظار اكتمال البيانات.')}</p>"
s = replace_once(s, old_personal, new_personal, 'student pending personal')

s = s.replace("$('honorRiseStat').textContent=`${Number(g.stats?.readiness_ready||0)} / ${Number(g.stats?.participants||0)}`;", "$('honorRiseStat').textContent=Number(g.stats?.pending_review_students||0);")
s = replace_once(s, "$('honorCategories').innerHTML=honorCategories(g);$('honorGroups').innerHTML", "$('honorCategories').innerHTML=honorCategories(g);$('honorAwards').innerHTML=honorAwards(g);$('honorGroups').innerHTML", 'student awards render')

p.write_text(s, encoding='utf-8')

# ---------- admin-honor.html ----------
p = Path('admin-honor.html')
s = p.read_text(encoding='utf-8')

s = replace_once(s,
    '.row{display:grid;grid-template-columns:70px minmax(210px,1.5fr) 110px repeat(4,100px);gap:8px;align-items:center;min-width:900px;',
    '.row{display:grid;grid-template-columns:70px minmax(210px,1.6fr) 120px 110px 110px;gap:8px;align-items:center;min-width:700px;',
    'admin top row grid')

s = replace_once(s,
    '<div class="stat"><span>استعداد مكتمل</span><b id="readyCount">—</b></div>',
    '<div class="stat"><span>تقييمات قيد المراجعة</span><b id="readyCount">—</b></div>',
    'admin pending stat')

old_admin_sections = '''<div class="section"><div class="sectionHead"><div><h3>🏁 Top 10</h3><p id="topDesc">تفاصيل الترتيب الحالي.</p></div></div><div id="top10" class="topList"></div></div>
<div class="section"><div class="sectionHead"><div><h3 id="riserTitle">📈 نجوم الصعود</h3><p id="riserDesc">أكبر تحسن بين آخر كويزين مسجلين.</p></div></div><div id="risers" class="risers"></div></div>
<div class="section"><div class="sectionHead"><div><h3>🎖️ أبطال الفئات</h3><p>الشامل، الاستعداد، الكويزات، المنصة، الواجب والحضور — كل فئة مستقلة.</p></div></div><div id="categories" class="categories"></div></div>'''
new_admin_sections = '''<div class="section"><div class="sectionHead"><div><h3>🏁 Top 10</h3><p id="topDesc">ترتيب مختصر: النتيجة الحالية، الشامل، والاستعداد.</p></div></div><div id="top10" class="topList"></div></div>
<div class="section"><div class="sectionHead"><div><h3>🎖️ أبطال الفئات</h3><p>الشامل، الاستعداد، الكويزات والمنصة — كل فئة مستقلة.</p></div></div><div id="categories" class="categories"></div></div>
<div class="section"><div class="sectionHead"><div><h3>⭐ أوسمة الالتزام الكامل</h3><p>الحضور والواجب الكامل يُعرضان كأوسمة جماعية عند 100% بدل ترتيب المتعادلين.</p></div></div><div id="awards" class="categories"></div></div>
<div class="section"><div class="sectionHead"><div><h3 id="riserTitle">📈 نجوم الصعود</h3><p id="riserDesc">أكبر تحسن بين آخر كويزين مسجلين.</p></div></div><div id="risers" class="risers"></div></div>'''
s = replace_once(s, old_admin_sections, new_admin_sections, 'admin section order')

start = s.index('function topRows(rows,phase)')
end = s.index('function risers(rows,phase)', start)
new_admin_top = '''function topRows(rows,phase){if(!rows?.length)return'<div class="empty">لا توجد بيانات مكتملة كافية للترتيب.</div>';const final=phase==='final';return`<div class="row head"><div>المركز</div><div>الطالب</div><div>${final?'النهائي':'الاستعداد'}</div><div>الشامل</div><div>الاستعداد</div></div>`+rows.map(s=>`<div class="row"><div><div class="rankNo">${s.rank}</div></div><div><div class="studentName">${esc(s.full_name)}</div><div class="meta">${esc(s.group_code||'')} · ${badges(s.badges)}</div></div><div class="overall"><b>${pct(s.overall)}</b><div class="bar"><i style="width:${Math.max(0,Math.min(100,Number(s.overall||0)))}%"></i></div></div>${metric('الشامل',s.comprehensive_score)}${metric('الاستعداد',s.readiness_score)}</div>`).join('')}
'''
s = s[:start] + new_admin_top + s[end:]

cat_start = s.index('function categories(g)')
cat_end = s.index('function groupCard', cat_start)
new_admin_cat = '''function categories(g){const c=[['🧠 أبطال الشامل','comprehensive','comprehensive_score'],['🎯 أبطال الاستعداد','readiness','readiness_score'],['🧪 فرسان الكويزات','quizzes','quiz_score'],['🚀 نجوم المنصة','platform','platform_score']];return c.map(([t,k,f])=>`<div class="category"><h4>${t}</h4>${leaders(g.leaders?.[k]||[],f)}</div>`).join('')}
function awardCard(title,pack){const a=pack||{},shown=(a.students||[]).slice(0,8),more=Math.max(0,Number(a.count||0)-shown.length);return`<div class="category"><h4>${title}</h4><div style="font-size:30px;font-weight:950">${Number(a.count||0)}</div><div class="small">طالب/ة حققوا 100%</div>${shown.length?`<div class="badges" style="justify-content:flex-start;margin-top:10px">${shown.map(x=>`<span class="badge">${esc(x.full_name)}</span>`).join('')}${more?`<span class="badge">+${more}</span>`:''}</div>`:'<div class="small" style="margin-top:10px">لا يوجد حاصلون على الوسام حتى الآن.</div>'}</div>`}
function awards(g){return awardCard('📅 وسام الحضور الكامل',g.awards?.perfect_attendance)+awardCard('📚 وسام الواجب الكامل',g.awards?.perfect_homework)}
'''
s = s[:cat_start] + new_admin_cat + s[cat_end:]

s = s.replace("$('readyCount').textContent=`${Number(g.stats?.readiness_ready||0)} / ${Number(g.stats?.participants||0)}`;", "$('readyCount').textContent=Number(g.stats?.pending_review_students||0);")
s = replace_once(s, "$('categories').innerHTML=categories(g);$('groups').innerHTML", "$('categories').innerHTML=categories(g);$('awards').innerHTML=awards(g);$('groups').innerHTML", 'admin awards render')

p.write_text(s, encoding='utf-8')

print('final honor board patch applied')
