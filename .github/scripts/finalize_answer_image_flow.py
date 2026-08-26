from pathlib import Path
import re

student = Path('student-base.html')
s = student.read_text(encoding='utf-8')

css_marker = '.studentReviewImageGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-top:10px}'
if css_marker not in s:
    s = s.replace('</style>', '''\n.studentReviewImageGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-top:10px}.studentReviewImage{border:1px solid #e4e7ec;border-radius:12px;overflow:hidden;background:#fff}.studentReviewImage img{display:block;width:100%;height:auto;max-height:520px;object-fit:contain;background:#fff}.studentReviewImageMeta{padding:7px 9px;font-size:10px;color:#667085}.studentReviewImage a{display:block}@media(max-width:650px){.studentReviewImageGrid{grid-template-columns:1fr}}\n</style>''', 1)

if 'let answerImages={};let answerImageUploads=0;' not in s:
    s = s.replace('let answerImages={};', "let answerImages={};let answerImageUploads=0;\nfunction syncAnswerImageSubmitState(){const b=$('finishBtn');if(b)b.disabled=answerImageUploads>0}", 1)

s = s.replace("answers={};answerImages={};qIndex=0;", "answers={};answerImages={};answerImageUploads=0;qIndex=0;", 1)

bind_pattern = r"async function bindAnswerImageControls\(q\)\{.*?\n\}\n\nfunction renderQuestion"
bind_replacement = '''async function bindAnswerImageControls(q){
 const wire=(button,input)=>{if(!button||!input)return;button.onclick=()=>{if(answerImageUploads>0)return;input.value='';input.click()};input.onchange=async()=>{const files=[...(input.files||[])];if(!files.length)return;const err=$('answerImageError'),busy=$('answerImageBusy');if(err){err.textContent='';err.classList.add('hidden')}if(busy){busy.textContent='جاري ضغط وحفظ الصورة...';busy.classList.remove('hidden')}button.disabled=true;answerImageUploads++;syncAnswerImageSubmitState();try{for(const f of files){if(answerImageRows(q.id).length>=3)break;await uploadAnswerImage(q.id,f)}renderQuestion()}catch(e){if(err){err.textContent='تعذر حفظ الصورة: '+String(e.message||e);err.classList.remove('hidden')}else showMsg(String(e.message||e))}finally{answerImageUploads=Math.max(0,answerImageUploads-1);button.disabled=false;syncAnswerImageSubmitState();if(busy)busy.classList.add('hidden')}}};
 wire($('answerCameraBtn'),$('answerCameraInput'));
 wire($('answerGalleryBtn'),$('answerGalleryInput'));
 document.querySelectorAll('[data-remove-answer-image]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await removeAnswerImage(q.id,b.dataset.removeAnswerImage);renderQuestion()}catch(e){showMsg(e.message);b.disabled=false}})
}

function renderQuestion'''
s2,n = re.subn(bind_pattern, bind_replacement, s, count=1, flags=re.S)
if n != 1:
    raise SystemExit(f'bindAnswerImageControls patch count={n}')
s = s2

submit_pattern = r"async function submitAttempt\(auto=false\)\{.*?\nfunction renderResult"
submit_replacement = '''async function submitAttempt(auto=false){if(!attemptId)return;if(answerImageUploads>0){if(auto){setTimeout(()=>submitAttempt(true),400)}else showMsg('انتظر حتى يكتمل حفظ الصورة قبل تسليم التدريب.');return}const unanswered=questions.filter(q=>!answers[q.id]||(q.type==='mcq'&&!answers[q.id].selected_choice_id)||(q.type==='numeric'&&answers[q.id].numeric_value==null)||(q.type==='short_text'&&!String(answers[q.id].text_answer||'').trim()&&!answerImageRows(q.id).length)).length;if(!auto&&unanswered>0&&!confirm('لديك '+unanswered+' سؤال بدون إجابة. هل تريد التسليم؟'))return;try{$('finishBtn').disabled=true;stopTimer();const d=await fn({action:'submit_attempt',attempt_id:attemptId,answers:Object.values(answers)});renderResult(d);showOnly('resultView')}catch(e){showMsg(e.message);$('finishBtn').disabled=false}}
function renderResult'''
s2,n = re.subn(submit_pattern, submit_replacement, s, count=1, flags=re.S)
if n != 1:
    raise SystemExit(f'submitAttempt patch count={n}')
s = s2

review_pattern = r"async function openAttemptReview\(id\)\{.*?\nlet soonReturnView="
review_replacement = '''async function loadStudentReviewAnswerImages(attemptId,rows){const{data,error}=await sb.from('response_answer_images').select('question_id,object_path,size_bytes,image_order').eq('attempt_id',attemptId).is('deleted_at',null).order('image_order');if(error){console.warn('student review answer images',error);return}const byQuestion=new Map;for(const x of(data||[])){const key=String(x.question_id),list=byQuestion.get(key)||[];const signed=await sb.storage.from('answer-images').createSignedUrl(x.object_path,900);if(!signed.error&&signed.data?.signedUrl)list.push({...x,url:signed.data.signedUrl});byQuestion.set(key,list)}for(const q of rows)q.answer_images=byQuestion.get(String(q.question_id))||[]}
function studentReviewAnswerImageHtml(q){const imgs=Array.isArray(q.answer_images)?q.answer_images:[];if(!imgs.length)return '';return '<div class="studentReviewImageGrid">'+imgs.map((x,i)=>'<div class="studentReviewImage"><a href="'+esc(x.url)+'" target="_blank" rel="noopener"><img src="'+esc(x.url)+'" alt="صورة إجابتك '+(i+1)+'"></a><div class="studentReviewImageMeta">📷 صورة الحل '+Number(x.image_order||i+1)+' · '+answerImageSize(x.size_bytes)+'</div></div>').join('')+'</div>'}
async function openAttemptReview(id){try{clearMsg();const d=await fn({action:'attempt_review',attempt_id:id});const a=d.attempt||{},rows=d.questions||[];await loadStudentReviewAnswerImages(id,rows);$('reviewTitle').textContent=a.title||'تصحيح المحاولة';$('reviewSummary').textContent=(a.status==='submitted'?'بعض الإجابات المقالية ما زالت قيد المراجعة — ':'تم اعتماد التصحيح — ')+(a.score==null?'':Number(a.score)+' من '+Number(a.max_score)+' درجة')+(a.percentage==null?'':' — '+Number(a.percentage)+'%');$('reviewDetails').innerHTML=rows.map((q,i)=>{const m=reviewStatusMeta(q.grading_status);const grade=q.grading_status==='review'?'قيد المراجعة':Number(q.awarded_points||0)+' / '+Number(q.points)+' درجة';let student='';const answerImagesHtml=studentReviewAnswerImageHtml(q),hasAnswerImages=Array.isArray(q.answer_images)&&q.answer_images.length>0;if(q.type==='mcq')student=q.selected_choice_text?((q.selected_choice_label?esc(q.selected_choice_label)+' — ':'')+reviewText(q.selected_choice_text)):'لم تتم الإجابة';else if(q.type==='numeric')student=q.numeric_value==null?'لم تتم الإجابة':esc(q.numeric_value)+' '+esc(q.unit_text||'');else{const raw=String(q.text_answer||'').trim(),typed=raw==='إجابة مصورة مرفوعة'?'':raw;student=typed?reviewText(typed):(hasAnswerImages?'تم إرفاق الحل كصورة.':'لم تتم الإجابة')}let correct='';if(q.type==='mcq'&&q.correct_choice_text)correct='<div class="reviewBox"><b>الإجابة الصحيحة:</b> '+(q.correct_choice_label?esc(q.correct_choice_label)+' — ':'')+reviewText(q.correct_choice_text)+'</div>';else if(q.type==='numeric'&&q.correct_numeric_answer!=null)correct='<div class="reviewBox"><b>الإجابة الصحيحة:</b> '+esc(q.correct_numeric_answer)+' '+esc((q.accepted_units||[])[0]||'')+'</div>';else if(q.type==='short_text'&&q.model_answer)correct='<div class="reviewBox"><b>الإجابة النموذجية:</b><div style="margin-top:5px">'+reviewText(q.model_answer)+'</div></div>';const note=q.feedback?'<div class="teacherNote"><b>'+(q.type==='short_text'&&q.grading_status!=='review'?'ملاحظة مستر يوسف:':'التغذية الراجعة:')+'</b> '+reviewText(q.feedback)+'</div>':'';return '<div class="answerCard '+m.cls+'"><div class="toolbar" style="justify-content:space-between"><b>'+m.icon+' السؤال '+(i+1)+' — '+esc(q.question_code||'')+'</b><span class="pill">'+esc(grade)+'</span></div><div style="margin:9px 0;font-weight:800;line-height:1.7">'+reviewText(q.stem)+'</div>'+reviewAsset(q,'stem_image')+'<div class="reviewBox"><b>إجابتك:</b><div style="margin-top:5px">'+student+'</div>'+answerImagesHtml+'</div>'+correct+note+(q.explanation?'<div class="small" style="margin-top:9px"><b>الشرح:</b> '+reviewText(q.explanation)+'</div>':'')+reviewAsset(q,'explanation_image')+'</div>'}).join('');showOnly('reviewView');queueMicrotask(()=>upgradeFractions($('reviewDetails')))}catch(e){showMsg(e.message)}}
let soonReturnView='''
s2,n = re.subn(review_pattern, review_replacement, s, count=1, flags=re.S)
if n != 1:
    raise SystemExit(f'openAttemptReview patch count={n}')
s = s2

student.write_text(s, encoding='utf-8')

reviews = Path('reviews-admin.html')
r = reviews.read_text(encoding='utf-8')
script_tag = '<script type="module" src="./reviews-answer-images.js"></script>'
if script_tag not in r:
    if '</body></html>' not in r:
        raise SystemExit('reviews-admin closing marker missing')
    r = r.replace('</body></html>', script_tag+'\n</body></html>', 1)
reviews.write_text(r, encoding='utf-8')
