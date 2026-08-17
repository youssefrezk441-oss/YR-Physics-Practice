from pathlib import Path

p = Path('student.html')
s = p.read_text(encoding='utf-8')
css = Path('.github/scripts/student-class-tests.css').read_text(encoding='utf-8')
view = Path('.github/scripts/student-class-tests-view.html').read_text(encoding='utf-8')
js = Path('.github/scripts/student-class-tests.js').read_text(encoding='utf-8')

if '/* Student class tests indicator */' not in s:
    anchor = '/* Student login redesign */'
    if anchor not in s:
        raise SystemExit('tests css anchor missing')
    s = s.replace(anchor, css + '\n' + anchor, 1)

old_card = '<button id="openClassTests" class="card studentNavCard" type="button"><div class="studentNavIcon">🧪</div><h3>اختبارات الحصص</h3><p>متوسط ونتائج الكويزات والاختبارات الشاملة.</p><span class="soonBadge">قريبًا</span></button>'
new_card = '<button id="openClassTests" class="card studentNavCard" type="button"><div class="studentNavIcon">🧪</div><h3>اختبارات الحصص</h3><p>متوسط الدرجات، أفضل نتيجة، اتجاه الأداء وتفاصيل كل اختبار.</p></button>'
if old_card in s:
    s = s.replace(old_card, new_card, 1)
elif new_card not in s:
    raise SystemExit('class tests card anchor missing')

if '<section id="classTestsView" class="hidden">' not in s:
    anchor = '<section id="commitmentView" class="hidden">'
    if anchor not in s:
        raise SystemExit('tests view insertion anchor missing')
    s = s.replace(anchor, view + '\n' + anchor, 1)

old_views = "['loginView','dashboardView','trainingMenuView','indicatorsMenuView','availableTrainingsView','completedTrainingsView','platformIndicatorsView','commitmentView','comingSoonView','practiceView','resultView','reviewView']"
new_views = "['loginView','dashboardView','trainingMenuView','indicatorsMenuView','availableTrainingsView','completedTrainingsView','platformIndicatorsView','commitmentView','classTestsView','comingSoonView','practiceView','resultView','reviewView']"
if old_views in s:
    s = s.replace(old_views, new_views, 1)
elif new_views not in s:
    raise SystemExit('student views class tests anchor missing')

if 'async function classTestsFn()' not in s:
    anchor = 'function pctText(v)'
    if anchor not in s:
        raise SystemExit('class tests js insertion anchor missing')
    s = s.replace(anchor, js + '\n' + anchor, 1)

old_event = "$('openClassTests').onclick=()=>openSoon('🧪 اختبارات الحصص','قريبًا — سيتم عرض نتائج الكويزات والاختبارات الشاملة بعد ربط بيانات الحصص بصفحة الطالب.','indicatorsMenuView');"
new_event = "$('openClassTests').onclick=()=>openClassTestsView();$('backClassTestsMenu').onclick=()=>showOnly('indicatorsMenuView');"
if old_event in s:
    s = s.replace(old_event, new_event, 1)
elif new_event not in s:
    raise SystemExit('class tests event anchor missing')

p.write_text(s, encoding='utf-8')
