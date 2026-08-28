from pathlib import Path
import base64
import gzip

ROOT = Path(__file__).resolve().parents[1]

source = ROOT / 'reference-assets' / 'lesson1-relative-velocity.html.gz.b64'
target = ROOT / 'references' / 'second-secondary' / 'lesson-1-relative-velocity.html'
target.parent.mkdir(parents=True, exist_ok=True)
target.write_bytes(gzip.decompress(base64.b64decode(source.read_text(encoding='utf-8').strip())))

student = ROOT / 'student.html'
text = student.read_text(encoding='utf-8')
marker = '/* شرح الحصص patch v1 */'

if marker not in text:
    patch = r'''
  /* شرح الحصص patch v1 */
  if(!html.includes('id="openReferences"')){
    html=html.replace(
      '<div class="studentHomeGrid">',
      '<div class="studentHomeGrid"><button id="openReferences" class="card studentNavCard referenceHomeCard" type="button"><div class="studentNavIcon">📖</div><h3>مرجع الشرح</h3><p>راجع أفكار وقوانين كل حصة بعد الشرح.</p></button>'
    );
  }

  if(!html.includes('id="referencesView"')){
    html=html.replace(
      '<section id="trainingMenuView"',
      `<section id="referencesView" class="hidden">
<div class="studentSubHead"><div><h2>📖 مرجع الشرح</h2><p class="sectionIntro">ارجع لطريقة التفكير والقوانين والأفكار الأساسية لكل حصة بعد انتهاء الشرح.</p></div><button id="backReferences" class="btn secondary studentBack">العودة للرئيسية</button></div>
<div class="studentSubGrid two">
  <a id="refB2Lesson1" class="card studentNavCard referenceLessonCard" href="./references/second-secondary/lesson-1-relative-velocity.html" target="_blank" rel="noopener"><div class="studentNavIcon">🧭</div><h3>الدرس الأول</h3><p>متجهات السرعة والسرعة النسبية — الصف الثاني الثانوي.</p><span class="referenceBadge">متاح الآن</span></a>
</div>
<div id="referencesEmpty" class="card hidden"><div class="empty">لا يوجد مرجع شرح منشور لصفك حاليًا.</div></div>
</section>
<section id="trainingMenuView"`
    );
  }

  html=html.replace("'dashboardView','trainingMenuView'","'dashboardView','referencesView','trainingMenuView'");

  if(html.includes("$('openTrainings').onclick=()=>showOnly('trainingMenuView');")){
    html=html.replace(
      "$('openTrainings').onclick=()=>showOnly('trainingMenuView');",
      "$('openReferences').onclick=()=>{const isSecond=gradeLabel(profile?.grade_level)==='الصف الثاني الثانوي';$('refB2Lesson1').classList.toggle('hidden',!isSecond);$('referencesEmpty').classList.toggle('hidden',isSecond);showOnly('referencesView')};$('backReferences').onclick=()=>showOnly('dashboardView');$('openTrainings').onclick=()=>showOnly('trainingMenuView');"
    );
  }else{
    throw new Error('تعذر ربط زر مرجع الشرح');
  }

  const referencesCss=`
@media(min-width:761px){.studentHomeGrid{grid-template-columns:repeat(4,minmax(0,1fr))}}
.referenceHomeCard{border-color:#bfdbfe;background:linear-gradient(180deg,#f8fbff,#fff)}
.referenceHomeCard .studentNavIcon{background:#dbeafe}
.referenceLessonCard{border-color:#c7d2fe;background:linear-gradient(180deg,#fbfdff,#fff)}
.referenceBadge{position:absolute;top:14px;left:14px;background:#ecfdf3;color:#027a48;border:1px solid #a7f3d0;border-radius:999px;padding:5px 9px;font-size:11px;font-weight:900}
html[data-theme="dark"] .referenceHomeCard,html[data-theme="dark"] .referenceLessonCard{background:#111827;border-color:#334155}
html[data-theme="dark"] .referenceHomeCard .studentNavIcon{background:#1e3a5f}
html[data-theme="dark"] .referenceBadge{background:#052e16;color:#86efac;border-color:#166534}
`;
  html=html.replace('</style>',referencesCss+'</style>');
'''
    anchor = '  const journeyCss=`'
    if anchor not in text:
        raise RuntimeError('Could not find student.html patch anchor')
    text = text.replace(anchor, patch + '\n' + anchor, 1)
    student.write_text(text, encoding='utf-8')

print('Student reference patch prepared successfully.')
