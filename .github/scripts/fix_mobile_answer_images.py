from pathlib import Path
import re

p = Path("student-base.html")
s = p.read_text(encoding="utf-8")

old_picker = '<div class="toolbar" style="margin-top:10px"><label class="btn primary answerImagePicker">📷 صوّر الحل الآن<input id="answerCameraInput" type="file" accept="image/*" capture="environment"></label><label class="btn secondary answerImagePicker">🖼️ اختر صورة من الجهاز<input id="answerGalleryInput" type="file" accept="image/*" multiple></label></div>'
new_picker = '<div class="toolbar" style="margin-top:10px"><button id="answerCameraBtn" type="button" class="btn primary answerImagePicker">📷 صوّر الحل الآن</button><button id="answerGalleryBtn" type="button" class="btn secondary answerImagePicker">🖼️ اختر صورة من الجهاز</button><input id="answerCameraInput" class="answerImageNativeInput" type="file" accept="image/*" capture="environment"><input id="answerGalleryInput" class="answerImageNativeInput" type="file" accept="image/*" multiple></div>'
if old_picker not in s:
    raise SystemExit("current picker marker not found")
s = s.replace(old_picker, new_picker, 1)

css_old = ".answerImagePicker input{display:none}"
css_new = ".answerImagePicker input{display:none}.answerImageNativeInput{position:fixed!important;left:-10000px!important;top:-10000px!important;width:1px!important;height:1px!important;opacity:.01!important;padding:0!important;border:0!important}"
if css_old not in s:
    raise SystemExit("picker css marker not found")
s = s.replace(css_old, css_new, 1)

html_pattern = r'function answerImageHtml\(qid\)\{.*?\nasync function answerImageLoad'
html_replacement = '''function answerImageHtml(qid){const rows=answerImageRows(qid);if(!rows.length)return '';return '<div class="answerImageList">'+rows.map(x=>'<div class="answerImageItem"><button type="button" class="answerImageRemove" data-remove-answer-image="'+esc(x.id)+'" title="حذف الصورة">×</button><img src="'+esc(x.preview_url)+'" alt="صورة إجابة الطالب"><div class="answerImageMeta">✅ تم الحفظ · '+answerImageSize(x.size_bytes)+'</div></div>').join('')+'</div>'}
async function answerImageLoad'''
s2, n = re.subn(html_pattern, html_replacement, s, count=1, flags=re.S)
if n != 1:
    raise SystemExit(f"answer image html marker not found or duplicated: {n}")
s = s2

upload_pattern = r'async function uploadAnswerImage\(qid,file\)\{.*?\n\}\nasync function removeAnswerImage'
upload_replacement = '''async function uploadAnswerImage(qid,file){
 const key=String(qid),rows=answerImageRows(key);if(rows.length>=3)throw new Error('الحد الأقصى 3 صور للسؤال الواحد.');
 const blob=await compressAnswerImage(file);const{data:{session},error:sessionError}=await sb.auth.getSession();if(sessionError||!session?.user)throw new Error('انتهت جلسة الدخول. سجّل الدخول من جديد.');
 const randomPart=(globalThis.crypto&&typeof globalThis.crypto.randomUUID==='function')?globalThis.crypto.randomUUID():(Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));
 const ext=blob.type==='image/webp'?'webp':'jpg',path=session.user.id+'/'+attemptId+'/'+key+'/'+Date.now()+'-'+randomPart+'.'+ext;
 const up=await sb.storage.from('answer-images').upload(path,blob,{contentType:blob.type,upsert:false,cacheControl:'3600'});if(up.error)throw new Error('تعذر حفظ الصورة في التخزين: '+(up.error.message||'خطأ غير معروف'));
 const reg=await sb.rpc('register_answer_image',{p_attempt_id:attemptId,p_question_id:key,p_object_path:path});if(reg.error){await sb.storage.from('answer-images').remove([path]);throw new Error('تم رفع الصورة لكن تعذر ربطها بالإجابة: '+(reg.error.message||'خطأ غير معروف'));}
 const row=Array.isArray(reg.data)?reg.data[0]:(reg.data||{});if(!row?.id){await sb.storage.from('answer-images').remove([path]);throw new Error('تعذر تأكيد حفظ الصورة. حاول مرة أخرى.');}
 let previewUrl='';const signed=await sb.storage.from('answer-images').createSignedUrl(path,3600);if(!signed.error&&signed.data?.signedUrl)previewUrl=signed.data.signedUrl;if(!previewUrl)previewUrl=URL.createObjectURL(blob);
 const rec={...row,id:row.id,object_path:path,size_bytes:Number(row.size_bytes||blob.size),preview_url:previewUrl,deleted:false};answerImages[key]=[...(answerImages[key]||[]),rec];
 const old=answers[key]||{};answers[key]={...old,question_id:key,has_image:true,text_answer:String(old.text_answer||'').trim()?old.text_answer:'إجابة مصورة مرفوعة'};
}
async function removeAnswerImage'''
s2, n = re.subn(upload_pattern, upload_replacement, s, count=1, flags=re.S)
if n != 1:
    raise SystemExit(f"upload function marker not found or duplicated: {n}")
s = s2

bind_pattern = r'async function bindAnswerImageControls\(q\)\{.*?\n\}\n\nfunction renderQuestion'
bind_replacement = '''async function bindAnswerImageControls(q){
 const wire=(button,input)=>{if(!button||!input)return;button.onclick=()=>{input.value='';input.click()};input.onchange=async()=>{const files=[...(input.files||[])];if(!files.length)return;const err=$('answerImageError'),busy=$('answerImageBusy');if(err){err.textContent='';err.classList.add('hidden')}if(busy){busy.textContent='جاري ضغط وحفظ الصورة...';busy.classList.remove('hidden')}button.disabled=true;try{for(const f of files){if(answerImageRows(q.id).length>=3)break;await uploadAnswerImage(q.id,f)}renderQuestion()}catch(e){if(err){err.textContent='تعذر حفظ الصورة: '+String(e.message||e);err.classList.remove('hidden')}else showMsg(String(e.message||e))}finally{button.disabled=false;if(busy)busy.classList.add('hidden')}}};
 wire($('answerCameraBtn'),$('answerCameraInput'));
 wire($('answerGalleryBtn'),$('answerGalleryInput'));
 document.querySelectorAll('[data-remove-answer-image]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await removeAnswerImage(q.id,b.dataset.removeAnswerImage);renderQuestion()}catch(e){showMsg(e.message);b.disabled=false}})
}

function renderQuestion'''
s2, n = re.subn(bind_pattern, bind_replacement, s, count=1, flags=re.S)
if n != 1:
    raise SystemExit(f"bind function marker not found or duplicated: {n}")
s = s2

p.write_text(s, encoding="utf-8")
