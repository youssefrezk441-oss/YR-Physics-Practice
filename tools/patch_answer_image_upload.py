from pathlib import Path
import re

p=Path('student-base.html')
s=p.read_text(encoding='utf-8')

old_picker='''<label class="btn secondary answerImagePicker">اختيار / تصوير<input id="answerImageInput" type="file" accept="image/*" multiple></label>'''
new_picker='''<div class="toolbar" style="margin-top:10px"><label class="btn primary answerImagePicker">📷 صوّر الحل الآن<input id="answerCameraInput" type="file" accept="image/*" capture="environment"></label><label class="btn secondary answerImagePicker">🖼️ اختر صورة من الجهاز<input id="answerGalleryInput" type="file" accept="image/*" multiple></label></div>'''

if old_picker in s:
    s=s.replace(old_picker,new_picker,1)
elif 'id="answerCameraInput"' not in s or 'id="answerGalleryInput"' not in s:
    raise SystemExit('missing direct-camera picker target')

pattern=r'''async function bindAnswerImageControls\(q\)\{.*?\n\}\n\nfunction renderQuestion'''
replacement='''async function bindAnswerImageControls(q){
 const bindInput=input=>{if(!input)return;input.onchange=async()=>{const files=[...(input.files||[])];if(!files.length)return;const err=$('answerImageError'),busy=$('answerImageBusy');if(err){err.textContent='';err.classList.add('hidden')}if(busy)busy.classList.remove('hidden');input.disabled=true;try{for(const f of files){if(answerImageRows(q.id).length>=3)break;await uploadAnswerImage(q.id,f)}renderQuestion()}catch(e){if(err){err.textContent=e.message;err.classList.remove('hidden')}else showMsg(e.message)}finally{input.disabled=false;if(busy)busy.classList.add('hidden')}}};
 bindInput($('answerCameraInput'));
 bindInput($('answerGalleryInput'));
 document.querySelectorAll('[data-remove-answer-image]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await removeAnswerImage(q.id,b.dataset.removeAnswerImage);renderQuestion()}catch(e){showMsg(e.message);b.disabled=false}})
}

function renderQuestion'''

if 'answerCameraInput' not in s.split('async function bindAnswerImageControls(q){',1)[1].split('function renderQuestion',1)[0]:
    s2,n=re.subn(pattern,replacement,s,count=1,flags=re.S)
    if n!=1:
        raise SystemExit(f'bind function target count={n}')
    s=s2

p.write_text(s,encoding='utf-8')
print('student-base.html patched for direct camera capture + gallery upload')
