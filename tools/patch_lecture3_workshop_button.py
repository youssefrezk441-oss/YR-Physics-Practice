from pathlib import Path

p=Path('student.html')
s=p.read_text(encoding='utf-8')

if 'ورشة المحاضرة الثالثة — طلاب الصف الثالث فقط' in s:
    print('already patched')
    raise SystemExit(0)

anchor='  const referencesCss=`'
if anchor not in s:
    raise SystemExit('referencesCss anchor not found')

patch=r'''  /* ورشة المحاضرة الثالثة — طلاب الصف الثالث فقط */
  if(!html.includes('id="openLecture3Workshop"')){
    html=html.replace(
      '<div class="studentHomeGrid">',
      '<div class="studentHomeGrid"><button id="openLecture3Workshop" class="card studentNavCard hidden" type="button"><div class="studentNavIcon">🧪</div><h3>ورشة المحاضرة الثالثة</h3><p>تدريب تفاعلي على أفكار المحاضرة الثالثة.</p></button>'
    );
  }

  const workshopProfileAnchor="renderProfileMeta();const chapterJourneyButton=$('openChapterJourney');";
  if(!html.includes(workshopProfileAnchor)) throw new Error('تعذر ربط صلاحية ورشة المحاضرة الثالثة');
  html=html.replace(
    workshopProfileAnchor,
    "renderProfileMeta();const lecture3WorkshopButton=$('openLecture3Workshop');if(lecture3WorkshopButton)lecture3WorkshopButton.classList.toggle('hidden',gradeLabel(profile?.grade_level)!=='الصف الثالث الثانوي');const chapterJourneyButton=$('openChapterJourney');"
  );

  const workshopBindAnchor="$('openTrainings').onclick=()=>showOnly('trainingMenuView');";
  if(!html.includes(workshopBindAnchor)) throw new Error('تعذر ربط زر ورشة المحاضرة الثالثة');
  html=html.replace(
    workshopBindAnchor,
    "$('openLecture3Workshop').onclick=()=>{window.location.href='./lecture3-workshop.html'};$('openTrainings').onclick=()=>showOnly('trainingMenuView');"
  );

'''

s=s.replace(anchor,patch+anchor,1)
p.write_text(s,encoding='utf-8')
print('patched student.html')
