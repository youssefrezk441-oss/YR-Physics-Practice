from pathlib import Path

p=Path('student-base.html')
s=p.read_text(encoding='utf-8')

def once(old,new,label):
    global s
    if old not in s:
        raise SystemExit(f'missing patch target: {label}')
    s=s.replace(old,new,1)

css=r'''
.answerImageBox{margin-top:12px;border:1px dashed #98a2b3;border-radius:14px;padding:13px;background:#f8fafc}.answerImageHead{display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap}.answerImageHead b{font-size:13px}.answerImageHint{font-size:11px;color:#667085;line-height:1.6;margin-top:5px}.answerImagePicker{display:inline-flex;align-items:center;gap:7px;margin-top:10px;cursor:pointer}.answerImagePicker input{display:none}.answerImageList{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin-top:11px}.answerImageItem{position:relative;border:1px solid #e4e7ec;border-radius:12px;overflow:hidden;background:#fff;min-height:105px}.answerImageItem img{width:100%;height:120px;object-fit:contain;display:block;background:#fff}.answerImageMeta{padding:6px 8px;font-size:10px;color:#667085}.answerImageRemove{position:absolute;top:6px;left:6px;width:28px;height:28px;border:0;border-radius:999px;background:rgba(190,18,60,.92);color:#fff;font-weight:900;cursor:pointer}.answerImageBusy{padding:12px;text-align:center;color:#475467;font-size:12px}.answerImageError{margin-top:8px;padding:8px 10px;border-radius:9px;background:#fff1f3;color:#be123c;font-size:11px}.answerModeSep{display:flex;align-items:center;gap:8px;color:#98a2b3;font-size:11px;margin:12px 0}.answerModeSep:before,.answerModeSep:after{content:"";height:1px;background:#e4e7ec;flex:1}html[data-theme="dark"] .answerImageBox{background:#111827;border-color:#475569}html[data-theme="dark"] .answerImageItem{background:#0f172a;border-color:#334155}html[data-theme="dark"] .answerImageItem img{background:#fff}@media(max-width:650px){.answerImageList{grid-template-columns:1fr 1fr}.answerImageItem img{height:135px}}
'''
once('</style>',css+'</style>','answer image css')

helpers=r'''
let answerImages={};
function answerImageRows(qid){return (answerImages[String(qid)]||[]).filter(x=>!x.deleted)}
function answerImageSize(n){const k=Math.max(0,Number(n||0))/1024;return k>=1024?(k/1024).toFixed(1)+' MB':Math.round(k)+' KB'}
function answerImageHtml(qid){const rows=answerImageRows(qid);if(!rows.length)return '';return '<div class="answerImageList">'+rows.map(x=>'<div class="answerImageItem"><button type="button" class="answerImageRemove" data-remove-answer-image="'+esc(x.id)+'" title="حذف الصورة">×</button><img src="'+esc(x.preview_url)+'" alt="صورة إجابة الطالب"><div class="answerImageMeta">'+answerImageSize(x.size_bytes)+'</div></div>').join('')+'</div>'}
async function answerImageLoad(file){return await new Promise((resolve,reject)=>{const img=new Image(),u=URL.createObjectURL(file);img.onload=()=>{URL.revokeObjectURL(u);resolve(img)};img.onerror=()=>{URL.revokeObjectURL(u);reject(new Error('تعذر قراءة الصورة.'))};img.src=u})}
function answerImageCanvasBlob(canvas,type,quality){return new Promise(resolve=>canvas.toBlob(resolve,type,quality))}
async function compressAnswerImage(file){
 if(!file||!String(file.type||'').startsWith('image/'))throw new Error('اختر صورة فقط.');
 const img=await answerImageLoad(file),maxDim=1600,scale=Math.min(1,maxDim/Math.max(img.naturalWidth||img.width,img.naturalHeight||img.height)),w=Math.max(1,Math.round((img.naturalWidth||img.width)*scale)),h=Math.max(1,Math.round((img.naturalHeight||img.height)*scale));
 const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d',{alpha:false});ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);ctx.drawImage(img,0,0,w,h);
 let quality=.86,blob=null;for(;quality>=.54;quality-=.06){blob=await answerImageCanvasBlob(canvas,'image/webp',quality);if(blob&&blob.size<=360*1024)break}
 if(!blob)blob=await answerImageCanvasBlob(canvas,'image/jpeg',.75);
 if(!blob)throw new Error('تعذر ضغط الصورة.');
 if(blob.size>1572864)throw new Error('الصورة كبيرة جدًا حتى بعد الضغط. صوّر الورقة بشكل أقرب وأوضح.');
 return blob;
}
async function uploadAnswerImage(qid,file){
 const key=String(qid),rows=answerImageRows(key);if(rows.length>=3)throw new Error('الحد الأقصى 3 صور للسؤال الواحد.');
 const blob=await compressAnswerImage(file);const{data:{session}}=await sb.auth.getSession();if(!session?.user)throw new Error('انتهت جلسة الدخول.');
 const ext=blob.type==='image/webp'?'webp':'jpg',path=session.user.id+'/'+attemptId+'/'+key+'/'+Date.now()+'-'+crypto.randomUUID()+'.'+ext;
 const up=await sb.storage.from('answer-images').upload(path,blob,{contentType:blob.type,upsert:false,cacheControl:'3600'});if(up.error)throw new Error(up.error.message||'تعذر رفع الصورة.');
 const reg=await sb.rpc('register_answer_image',{p_attempt_id:attemptId,p_question_id:key,p_object_path:path});if(reg.error){await sb.storage.from('answer-images').remove([path]);throw new Error(reg.error.message||'تعذر تسجيل الصورة.');}
 const row=reg.data||{};const rec={...row,id:row.id,object_path:path,size_bytes:blob.size,preview_url:URL.createObjectURL(blob),deleted:false};answerImages[key]=[...(answerImages[key]||[]),rec];
 const old=answers[key]||{};answers[key]={...old,question_id:key,has_image:true,text_answer:String(old.text_answer||'').trim()?old.text_answer:'إجابة مصورة مرفوعة'};
}
async function removeAnswerImage(qid,id){
 const key=String(qid),row=(answerImages[key]||[]).find(x=>String(x.id)===String(id)&&!x.deleted);if(!row)return;
 const mark=await sb.rpc('mark_answer_image_deleted',{p_image_id:row.id});if(mark.error)throw new Error(mark.error.message||'تعذر حذف الصورة.');
 const rm=await sb.storage.from('answer-images').remove([row.object_path]);if(rm.error)console.warn('answer image storage remove',rm.error);
 row.deleted=true;if(row.preview_url)URL.revokeObjectURL(row.preview_url);
 const left=answerImageRows(key),old=answers[key]||{};if(!left.length&&String(old.text_answer||'')==='إجابة مصورة مرفوعة')answers[key]={question_id:key,text_answer:''};else answers[key]={...old,has_image:left.length>0};
}
async function bindAnswerImageControls(q){
 const input=$('answerImageInput');if(input)input.onchange=async()=>{const files=[...(input.files||[])];if(!files.length)return;const err=$('answerImageError'),busy=$('answerImageBusy');if(err)err.textContent='';if(busy)busy.classList.remove('hidden');input.disabled=true;try{for(const f of files){if(answerImageRows(q.id).length>=3)break;await uploadAnswerImage(q.id,f)}renderQuestion()}catch(e){if(err){err.textContent=e.message;err.classList.remove('hidden')}else showMsg(e.message)}finally{input.disabled=false;if(busy)busy.classList.add('hidden')}};
 document.querySelectorAll('[data-remove-answer-image]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await removeAnswerImage(q.id,b.dataset.removeAnswerImage);renderQuestion()}catch(e){showMsg(e.message);b.disabled=false}})
}
'''
once('function renderQuestion(){',helpers+'\nfunction renderQuestion(){','answer image helpers')

old="else html+='<label>إجابتك</label><textarea id=\"textAnswer\" placeholder=\"اكتب إجابتك هنا\">'+esc(a.text_answer??'')+'</textarea>';"
new="else{const typed=String(a.text_answer??'')==='إجابة مصورة مرفوعة'?'':String(a.text_answer??'');html+='<label>إجابتك الكتابية <span class=\"small muted\">(اختياري إذا رفعت صورة)</span></label><textarea id=\"textAnswer\" placeholder=\"اكتب إجابتك هنا أو ارفع صورة لحلك بخط يدك\">'+esc(typed)+'</textarea><div class=\"answerModeSep\">أو</div><div class=\"answerImageBox\"><div class=\"answerImageHead\"><div><b>📷 ارفع صورة الحل بخط يدك</b><div class=\"answerImageHint\">صوّر الورقة بوضوح. يتم ضغط الصورة قبل الرفع لتوفير المساحة. الحد الأقصى 3 صور.</div></div><label class=\"btn secondary answerImagePicker\">اختيار / تصوير<input id=\"answerImageInput\" type=\"file\" accept=\"image/*\" multiple></label></div><div id=\"answerImageBusy\" class=\"answerImageBusy hidden\">جاري ضغط ورفع الصورة...</div><div id=\"answerImageError\" class=\"answerImageError hidden\"></div>'+answerImageHtml(q.id)+'</div>'}"
once(old,new,'short text image ui')

old="const ta=$('textAnswer');if(ta)ta.oninput=()=>{answers[q.id]={question_id:q.id,text_answer:ta.value}};$('prevBtn').disabled=qIndex===0;"
new="const ta=$('textAnswer');if(ta)ta.oninput=()=>{const imgs=answerImageRows(q.id);answers[q.id]={question_id:q.id,text_answer:ta.value.trim()?ta.value:(imgs.length?'إجابة مصورة مرفوعة':''),has_image:imgs.length>0}};if(q.type==='short_text')bindAnswerImageControls(q);$('prevBtn').disabled=qIndex===0;"
once(old,new,'bind answer image controls')

old="async function startSet(slug){try{clearMsg();const d=await fn({action:'start',slug});attemptId=d.attempt.id;currentSet=d.training_set;questions=d.questions||[];answers={};qIndex=0;"
new="async function startSet(slug){try{clearMsg();const d=await fn({action:'start',slug});attemptId=d.attempt.id;currentSet=d.training_set;questions=d.questions||[];answers={};answerImages={};qIndex=0;"
once(old,new,'reset answer images')

old="(q.type==='short_text'&&!String(answers[q.id].text_answer||'').trim())"
new="(q.type==='short_text'&&!String(answers[q.id].text_answer||'').trim()&&!answerImageRows(q.id).length)"
once(old,new,'image counts as answer')

p.write_text(s,encoding='utf-8')
print('student-base.html patched for answer image upload')
