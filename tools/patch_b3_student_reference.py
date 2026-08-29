from pathlib import Path

p=Path('student.html')
s=p.read_text(encoding='utf-8')
if 'id="refB3Lecture2"' in s:
    print('already patched')
    raise SystemExit(0)

old_btn='''  <button id="refB2Lesson1" class="card studentNavCard referenceLessonCard" type="button"><div class="studentNavIcon">🧭</div><h3>الدرس الأول</h3><p>متجهات السرعة والسرعة النسبية — الصف الثاني الثانوي.</p><span class="referenceBadge">متاح الآن</span></button>'''
new_btn=old_btn+'''\n  <button id="refB3Lecture2" class="card studentNavCard referenceLessonCard" type="button"><div class="studentNavIcon">⚡</div><h3>المحاضرة الثانية — كهربية</h3><p>الطاقة والقدرة ومقاومة الموصل وبداية التوالي والتوازي — الصف الثالث الثانوي.</p><span class="referenceBadge">متاح الآن</span></button>'''
if old_btn not in s: raise SystemExit('B2 reference button anchor not found')
s=s.replace(old_btn,new_btn,1)

old_invoke="const {data,error}=await sb.functions.invoke('student-explanation-reference',{body:{slug}});"
new_invoke="const referenceFunction=slug==='lecture-2-electricity-reference'?'student-explanation-reference-b3':'student-explanation-reference';const {data,error}=await sb.functions.invoke(referenceFunction,{body:{slug}});"
if old_invoke not in s: raise SystemExit('reference invoke anchor not found')
s=s.replace(old_invoke,new_invoke,1)

old_bind="$('openReferences').onclick=()=>{const isSecond=gradeLabel(profile?.grade_level)==='الصف الثاني الثانوي';$('refB2Lesson1').classList.toggle('hidden',!isSecond);$('referencesEmpty').classList.toggle('hidden',isSecond);showOnly('referencesView')};$('backReferences').onclick=()=>showOnly('dashboardView');$('refB2Lesson1').onclick=()=>openProtectedExplanationReference('lesson-1-relative-velocity');$('openTrainings').onclick=()=>showOnly('trainingMenuView');"
new_bind="$('openReferences').onclick=()=>{const grade=gradeLabel(profile?.grade_level),isSecond=grade==='الصف الثاني الثانوي',isThird=grade==='الصف الثالث الثانوي';$('refB2Lesson1').classList.toggle('hidden',!isSecond);$('refB3Lecture2').classList.toggle('hidden',!isThird);$('referencesEmpty').classList.toggle('hidden',isSecond||isThird);showOnly('referencesView')};$('backReferences').onclick=()=>showOnly('dashboardView');$('refB2Lesson1').onclick=()=>openProtectedExplanationReference('lesson-1-relative-velocity');$('refB3Lecture2').onclick=()=>openProtectedExplanationReference('lecture-2-electricity-reference');$('openTrainings').onclick=()=>showOnly('trainingMenuView');"
if old_bind not in s: raise SystemExit('reference binding anchor not found')
s=s.replace(old_bind,new_bind,1)

p.write_text(s,encoding='utf-8')
print('patched student.html')
