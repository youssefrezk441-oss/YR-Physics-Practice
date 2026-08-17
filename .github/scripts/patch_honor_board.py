from pathlib import Path
import re
p=Path('student.html')
s=p.read_text(encoding='utf-8')
css=Path('.github/scripts/honor-board.css').read_text(encoding='utf-8')
view=Path('.github/scripts/honor-board-view.html').read_text(encoding='utf-8')
js=Path('.github/scripts/honor-board.js').read_text(encoding='utf-8')

if '/* YR Honors Arena */' not in s:
    anchor='/* Student login redesign */'
    if anchor not in s: raise SystemExit('honor css anchor missing')
    s=s.replace(anchor,css+'\n\n'+anchor,1)

new_card='<button id="openHonor" class="card studentNavCard" type="button"><div class="studentNavIcon">🏆</div><h3>لوحة الشرف</h3><p>بطولة التميز: الصدارة، الصعود، أبطال الفئات وتحدي المجموعات.</p></button>'
if new_card not in s:
    s,n=re.subn(r'<button id="openHonor" class="card studentNavCard" type="button">.*?</button>',new_card,s,count=1,flags=re.S)
    if n!=1: raise SystemExit('honor card anchor missing')

if '<section id="honorView" class="hidden">' not in s:
    anchor='<section id="trainingMenuView" class="hidden">'
    if anchor not in s: raise SystemExit('honor view anchor missing')
    s=s.replace(anchor,view+'\n'+anchor,1)

if "'honorView'" not in s:
    anchor="'classTestsView','comingSoonView'"
    if anchor not in s: raise SystemExit('honor views list anchor missing')
    s=s.replace(anchor,"'classTestsView','honorView','comingSoonView'",1)

if 'async function honorFn()' not in s:
    anchor='function pctText(v)'
    if anchor not in s: raise SystemExit('honor js anchor missing')
    s=s.replace(anchor,js+'\n'+anchor,1)

old="$('openHonor').onclick=()=>openSoon('🏆 لوحة الشرف','نعمل حاليًا على تجهيز لوحة شرف ديناميكية تعتمد على بيانات الحصص والتدريبات.','dashboardView');"
new="$('openHonor').onclick=()=>openHonorView();$('honorBackBtn').onclick=()=>showOnly('dashboardView');document.querySelectorAll('[data-honor-grade]').forEach(b=>b.onclick=()=>renderHonorGrade(b.dataset.honorGrade));"
if old in s:
    s=s.replace(old,new,1)
elif new not in s:
    raise SystemExit('honor event anchor missing')

p.write_text(s,encoding='utf-8')
