from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]
p = ROOT / 'student.html'
text = p.read_text(encoding='utf-8')

# Remove the helper from the temporary loader document. That document is replaced
# by student-base.html, so functions defined here do not survive reliably.
start_marker = '  async function openProtectedExplanationReference(slug){'
end_marker = '  /* شرح الحصص patch v1 */'
start = text.find(start_marker)
end = text.find(end_marker, start if start >= 0 else 0)
if start >= 0:
    if end < 0:
        raise SystemExit('Could not find end of old protected reference helper')
    # also trim preceding blank space to keep the loader tidy
    trim = start
    while trim > 0 and text[trim-1] in ' \t\n':
        trim -= 1
    text = text[:trim] + '\n\n' + text[end:]

handler = "$('openReferences').onclick=()=>{const isSecond=gradeLabel(profile?.grade_level)==='الصف الثاني الثانوي';$('refB2Lesson1').classList.toggle('hidden',!isSecond);$('referencesEmpty').classList.toggle('hidden',isSecond);showOnly('referencesView')};$('backReferences').onclick=()=>showOnly('dashboardView');$('refB2Lesson1').onclick=()=>openProtectedExplanationReference('lesson-1-relative-velocity');$('openTrainings').onclick=()=>showOnly('trainingMenuView');"

protected_fn = r"""window.openProtectedExplanationReference=async function(slug){
  const w=window.open('about:blank','_blank');
  if(!w){alert('اسمح بفتح النوافذ المنبثقة للمنصة ثم حاول مرة أخرى.');return}
  try{
    w.document.open();
    w.document.write('<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>جاري فتح المرجع...</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1220;color:#fff;font-family:Arial,sans-serif}.box{text-align:center;padding:30px}.spin{width:42px;height:42px;border:4px solid #334155;border-top-color:#60a5fa;border-radius:50%;margin:0 auto 16px;animation:s 1s linear infinite}@keyframes s{to{transform:rotate(360deg)}}</style></head><body><div class="box"><div class="spin"></div><b>جاري التحقق وفتح مرجع الشرح...</b></div></body></html>');
    w.document.close();
    const {data,error}=await sb.functions.invoke('student-explanation-reference',{body:{slug}});
    if(error){
      let message=error.message||'تعذر فتح مرجع الشرح';
      try{if(error.context&&typeof error.context.json==='function'){const payload=await error.context.json();message=payload?.message||payload?.error||message}}catch{}
      throw new Error(message)
    }
    if(!data?.ok||!data?.html)throw new Error(data?.message||'تعذر فتح مرجع الشرح');
    w.document.open();
    w.document.write(data.html);
    w.document.close();
    try{w.opener=null}catch{}
  }catch(e){
    const msg=String(e?.message||'تعذر فتح مرجع الشرح');
    const safe=msg.replace(/[&<>]/g,c=>c==='&'?'&amp;':c==='<'?'&lt;':'&gt;');
    try{
      w.document.open();
      w.document.write('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>تعذر فتح المرجع</title><style>body{font-family:Arial,sans-serif;background:#0b1220;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0}.e{max-width:520px;padding:26px;border:1px solid #7f1d1d;background:#1f1115;border-radius:16px;line-height:1.8;margin:20px}</style><body><div class="e"><b>تعذر فتح مرجع الشرح.</b><br>'+safe+'</div></body></html>');
      w.document.close();
    }catch{}
  }
};"""

injected = protected_fn + handler
old_literal = json.dumps(handler, ensure_ascii=False)
new_literal = json.dumps(injected, ensure_ascii=False)

if new_literal in text:
    pass
elif old_literal in text:
    text = text.replace(old_literal, new_literal, 1)
else:
    raise SystemExit('Could not find reference click handler for injection')

p.write_text(text, encoding='utf-8')
print('Protected reference click function moved into final student document.')
