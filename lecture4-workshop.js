import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, L4_WORKSHOP_FUNCTION } from './assets/l4-workshop/platform-auth-config.js';

// Only public question metadata is loaded. The Edge Function owns all grading.
const DATA_ROOT = './assets/l4-workshop/questions/';
// Images are uploaded directly inside questions/ on the current platform.
const imageURL = q => DATA_ROOT + q.image.replace(/^images\//, '');
const $ = id => document.getElementById(id);
const app = { questions: [], track: null, filter: 'all', current: null, progress: new Map(),
  userId: null, role: null, busy: false, authorized: false, navigation: {}, drafts: new Map(), sb: null };
const partId = (bank, key) => `${bank}:${key}`;
const partsOf = q => q.grading_mode === 'mcq' ? [{ key: 'main' }] : q.answer_schema.parts;
const stateOf = (q, key) => app.progress.get(partId(q.bank_no, key)) || {};
const inTrack = () => app.questions.filter(q => q.track === app.track);
const visible = () => inTrack().filter(q => app.filter === 'all' || q.skill === app.filter);
const currentQuestion = () => app.questions.find(q => q.bank_no === app.current);
const statusNames = { unsolved: 'لم يُحل', mastered: 'إتقان مستقل', assisted: 'تعلّم بمساعدة' };
function statusOf(q) {
  const states = partsOf(q).map(p => stateOf(q, p.key));
  if (states.some(s => s.revealed || s.assisted)) return 'assisted';
  return states.every(s => s.mastered) ? 'mastered' : 'unsolved';
}
function isDone(q) { return partsOf(q).every(p => { const s = stateOf(q, p.key); return s.mastered || s.revealed || s.assisted; }); }
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function notice(message = '') { $('notice').textContent = message; $('notice').hidden = !message; }
function navigationKey() { return `yr-l4-navigation-v2:${app.userId}`; }
function readNavigation() {
  try { app.navigation = JSON.parse(localStorage.getItem(navigationKey()) || '{}') || {}; }
  catch { app.navigation = {}; }
}
function saveNavigation() {
  app.navigation[app.track] = { bank: app.current, skill: app.filter };
  try { localStorage.setItem(navigationKey(), JSON.stringify(app.navigation)); } catch { /* Navigation remains available for this session. */ }
}
function lockPage(message) {
  app.authorized = false;
  app.progress.clear(); app.drafts.clear();
  $('welcome').hidden = true; $('workspace').hidden = true;
  $('answers').replaceChildren(); $('question-image').removeAttribute('src');
  $('image-dialog').close(); $('large-image').removeAttribute('src');
  $('gate').hidden = false; $('gate-message').textContent = message; $('login').hidden = false;
}
const errors = {
  unauthorized: 'انتهت جلسة الدخول. ارجع إلى المنصة وسجّل الدخول مرة أخرى.',
  grade_not_allowed: 'هذه الورشة متاحة لطلاب الصف الثالث الثانوي المفعّلين فقط.',
  admin_read_only: 'حساب الإدارة للمعاينة فقط.',
  invalid_answer: 'راجع صيغة الإجابة ثم أعد المحاولة.',
  invalid_part: 'تعذر مطابقة هذا المطلوب. تواصل مع مستر يوسف.',
  invalid_question: 'تعذر مطابقة السؤال. تواصل مع مستر يوسف.',
  question_not_found: 'السؤال غير متاح على الخادم حاليًا.',
  reveal_not_allowed: 'إظهار الإجابة لم يُتح بعد لهذا المطلوب.',
  reveal_not_applicable: 'هذا السؤال لا يدعم طلب إظهار الإجابة.',
  key_not_found: 'تعذر تصحيح هذا السؤال حاليًا. تواصل مع مستر يوسف.'
};
async function api(action, payload = {}) {
  let result;
  try { result = await app.sb.functions.invoke(L4_WORKSHOP_FUNCTION, { body: { action, ...payload } }); }
  catch { throw new Error('تعذر الاتصال. تحقق من الإنترنت وأعد المحاولة.'); }
  let data = result.data;
  if (result.error) {
    try { data = await result.error.context?.json(); } catch { /* A network error need not have a JSON body. */ }
  }
  if (result.error || !data?.ok) {
    const code = data?.error || data?.code;
    const http = result.error?.context?.status;
    const message = (typeof data?.message === 'string' && /[\u0600-\u06ff]/.test(data.message))
      ? data.message : errors[code] || (http === 401 ? errors.unauthorized : 'تعذر إتمام الطلب. أعد المحاولة؛ المحاولات المحفوظة لدى الخادم لن تتكرر.');
    if (http === 401 || code === 'unauthorized' || code === 'grade_not_allowed') lockPage(message);
    throw new Error(message);
  }
  return data;
}
function validatePublic(data) {
  if (!Array.isArray(data) || data.length !== 187 || data.filter(q => q.track === 'class').length !== 30 || data.filter(q => q.track === 'home').length !== 157) throw new Error('ملف الأسئلة غير مكتمل.');
  const seen = new Set();
  const modes = ['mcq','numeric','multi_numeric','multi_qualitative','ratio','structured_text','symbolic'];
  for (const q of data) {
    if (seen.has(q.bank_no) || !modes.includes(q.grading_mode) || !/^images\/q\d+\.png$/.test(q.image) || !q.answer_schema || (q.grading_mode !== 'mcq' && !q.answer_schema.parts?.length)) throw new Error(`تعذر قراءة بيانات السؤال ${q.bank_no}.`);
    seen.add(q.bank_no);
  }
  // Retain the supplied array and ordering, including all skill metadata.
  return data;
}
async function loadTrack(track) {
  const data = await api('list', { track });
  const source = app.questions.filter(q => q.track === track);
  if (!Array.isArray(data.questions) || data.questions.length !== source.length || !Array.isArray(data.progress)) throw new Error('قائمة الخادم غير مكتملة. أعد المحاولة.');
  const returned = new Map(data.questions.map(q => [Number(q.bank_no), q]));
  for (const q of source) {
    const remote = returned.get(q.bank_no);
    if (!remote || remote.grading_mode !== q.grading_mode) throw new Error(`تعارض في بيانات السؤال ${q.bank_no} بين الملف والخادم.`);
  }
  const banks = new Set(source.map(q => q.bank_no));
  // Preserve feedback in memory across list refreshes; authoritative state is replaced.
  const old = app.progress;
  const next = new Map([...old].filter(([key]) => !banks.has(Number(key.split(':')[0]))));
  for (const row of data.progress) {
    if (!banks.has(Number(row.bank_no))) continue;
    const key = partId(row.bank_no, row.part_key);
    next.set(key, { ...row, display_answer: row.display_answer ?? old.get(key)?.display_answer });
  }
  app.progress = next;
}
async function enterTrack(track) {
  if (app.busy || !app.authorized) return;
  app.busy = true; notice('جارٍ تحميل المسار والتقدم المحفوظ…');
  document.querySelectorAll('[data-track]').forEach(b => b.disabled = true);
  try {
    await loadTrack(track);
    if (!app.authorized) return;
    app.track = track;
    const saved = app.navigation[track];
    app.filter = saved?.skill || 'all';
    const skills = [...new Map(inTrack().map(q => [q.skill, q.skill_name])).entries()];
    $('skill').replaceChildren(new Option('كل المهارات', 'all'), ...skills.map(([key,name]) => new Option(`${key} ${name}`, key)));
    if (app.filter !== 'all' && !skills.some(([key]) => key === app.filter)) app.filter = 'all';
    $('skill').value = app.filter;
    app.current = visible().some(q => q.bank_no === saved?.bank) ? saved.bank : visible()[0].bank_no;
    $('welcome').hidden = true; $('gate').hidden = true; $('workspace').hidden = false;
    $('track-title').textContent = track === 'class' ? 'ورشة الحصة' : 'التدريب المنزلي';
    $('admin-note').hidden = app.role === 'student';
    $('navigator').open = window.innerWidth > 760;
    notice(); saveNavigation(); renderQuestion();
  } catch (error) { notice(error.message); }
  finally { app.busy = false; document.querySelectorAll('[data-track]').forEach(b => b.disabled = false); }
}
function renderProgress() {
  const questions = visible();
  const done = questions.filter(isDone).length;
  const mastered = questions.filter(q => statusOf(q) === 'mastered').length;
  $('progress-text').textContent = `تم حل ${done} من ${questions.length}`;
  $('mastery').textContent = `الإتقان ${Math.round(mastered / questions.length * 100)}٪`;
  $('progress').max = questions.length; $('progress').value = done;
  $('progress').setAttribute('aria-label', `تم حل ${done} من ${questions.length}`);
  $('numbers').replaceChildren(...questions.map(q => {
    const status = statusOf(q);
    const b = el('button', String(q.bank_no));
    b.dataset.bank = q.bank_no; b.dataset.state = status;
    b.setAttribute('aria-current', String(q.bank_no === app.current));
    b.setAttribute('aria-label', `السؤال ${q.bank_no} — ${statusNames[status]}`);
    if (status !== 'unsolved') b.append(el('span', status === 'mastered' ? '✓' : '◐', 'mark'));
    b.onclick = () => navigate(q.bank_no);
    return b;
  }));
  const q = currentQuestion();
  if (q) { $('question-state').textContent = statusNames[statusOf(q)]; $('question-state').dataset.state = statusOf(q); }
}
function navigate(bank) {
  if (app.busy || !app.authorized) return;
  app.current = bank; saveNavigation(); renderQuestion();
  if (window.innerWidth <= 760) $('navigator').open = false;
  $('question').focus({ preventScroll: true });
  $('question').scrollIntoView({ block: 'start', behavior: 'instant' });
}
function renderQuestion() {
  const q = currentQuestion(); if (!q) return;
  $('question-title').textContent = `السؤال ${q.bank_no}`;
  $('skill-name').textContent = `${q.skill} · ${q.skill_name}`;
  const arr = visible(), index = arr.indexOf(q);
  $('position').textContent = `${index + 1} من ${arr.length}`;
  $('page-number').textContent = `${index + 1} / ${arr.length}`;
  $('previous').disabled = index === 0; $('next').disabled = index === arr.length - 1;
  $('question-image').width = q.image_width; $('question-image').height = q.image_height;
  $('question-image').alt = `صورة السؤال ${q.bank_no} كاملة`;
  $('question-image').src = imageURL(q);
  $('question-image').hidden = false; $('image-error').hidden = true;
  $('answers').replaceChildren();
  if (q.grading_mode === 'mcq') renderMCQ(q); else partsOf(q).forEach((part,index) => renderPart(q,part,index));
  renderProgress();
}
function feedbackText(s) {
  if (s.revealed || s.assisted) return 'تعلّم بمساعدة — لا يُحسب إتقانًا مستقلًا.';
  if (s.mastered) return 'إجابة صحيحة — تم إتقان هذا المطلوب.';
  return s.attempts_count ? `محاولات مسجلة: ${s.attempts_count}. راجع خطواتك وحاول مجددًا.` : '';
}
function showFeedback(node, s, response) {
  node.textContent = response?.message || feedbackText(s);
  node.dataset.tone = s.revealed || s.assisted ? 'assisted' : s.mastered ? 'good' : 'wrong';
}
function appendDisplay(parent, s) {
  if (typeof s.display_answer === 'string' && (s.revealed || s.assisted)) parent.append(el('p',s.display_answer,'answer-display'));
}
function optionText(item) {
  const value = typeof item === 'object' && item ? item.normalized ?? item.raw : item;
  const normalized = typeof value === 'string' ? value.trim() : '';
  return ({'ا':'أ','إ':'أ','آ':'أ','a':'أ','b':'ب','c':'ج','d':'د'})[normalized] || normalized;
}
function renderMCQ(q) {
  const state = stateOf(q,'main');
  const wrap = el('div'); const buttons = el('div',undefined,'mcq');
  const tried = new Set((state.tried_answers || []).map(optionText));
  for (const option of q.answer_schema.options) {
    const b = el('button',option);
    const wrong = !state.mastered && tried.has(option);
    if (wrong) { b.className = 'wrong'; b.setAttribute('aria-label', `${option} — محاولة سابقة خاطئة`); }
    b.disabled = app.role !== 'student' || !!state.mastered || !!state.revealed || wrong;
    b.onclick = () => send(q,{key:'main'},option,'attempt');
    buttons.append(b);
  }
  wrap.append(buttons);
  const msg = el('p',undefined,'feedback'); msg.setAttribute('role','status'); showFeedback(msg,state); wrap.append(msg);
  appendDisplay(wrap,state); $('answers').append(wrap);
}
function renderPart(q, part, index) {
  const state = stateOf(q,part.key);
  const form = el('form',undefined,'answer-part'); form.dataset.part = part.key;
  const label = el('label',part.label); const id = `answer-${index}`; label.htmlFor = id;
  const row = el('div',undefined,'input-row'), inputWrap = el('div',undefined,'input-wrap');
  const input = el('input'); input.id = id; input.name = part.key; input.type = 'text'; input.required = true;
  // Text inputs deliberately preserve Arabic digits, slash fractions and symbolic expressions.
  input.dir = part.input === 'numeric' ? 'ltr' : 'auto';
  input.autocomplete = 'off'; input.spellcheck = false; input.maxLength = 500;
  input.value = app.drafts.get(partId(q.bank_no,part.key)) ?? (typeof state.last_answer?.raw === 'string' ? state.last_answer.raw : '');
  input.oninput = () => app.drafts.set(partId(q.bank_no,part.key),input.value);
  input.disabled = app.role !== 'student' || !!state.mastered || !!state.revealed;
  inputWrap.append(input); if (part.unit) inputWrap.append(el('bdi',part.unit,'unit'));
  const submit = el('button','تحقق','submit'); submit.type = 'submit'; submit.disabled = input.disabled;
  row.append(inputWrap,submit); form.append(label,row);
  if (part.input === 'numeric') form.append(el('p','يمكنك كتابة الأرقام العربية أو الإنجليزية والكسور مثل 46/3.','hint'));
  const msg = el('p',undefined,'feedback'); msg.setAttribute('role','status'); showFeedback(msg,state); form.append(msg);
  const canReveal = state.can_reveal || (!state.mastered && Number(state.attempts_count) >= 3);
  if (app.role === 'student' && (canReveal || state.revealed) && !state.mastered) {
    const reveal = el('button',state.revealed ? 'عرض الإجابة مجددًا' : 'إظهار الإجابة','reveal'); reveal.type = 'button';
    reveal.onclick = () => send(q,part,null,'reveal'); form.append(reveal);
  }
  appendDisplay(form,state);
  form.onsubmit = event => { event.preventDefault(); if (input.value.trim()) send(q,part,input.value,'attempt'); };
  $('answers').append(form);
}
async function send(q, part, answer, action) {
  if (app.busy || !app.authorized || app.role !== 'student') return;
  app.busy = true; notice();
  const id = partId(q.bank_no,part.key);
  const disabled = [...$('workspace').querySelectorAll('button,input,select')].map(node => [node,node.disabled]);
  disabled.forEach(([node]) => node.disabled = true);
  $('answers').setAttribute('aria-busy','true');
  try {
    const payload = { bank_no:q.bank_no, part_key:part.key };
    if (action === 'attempt') payload.answer = answer;
    const result = await api(action,payload);
    if (!app.authorized) return;
    const previous = stateOf(q,part.key);
    const tried = [...(previous.tried_answers || [])];
    if (action === 'attempt' && !result.duplicate && !tried.some(v => optionText(v) === answer)) tried.push(answer);
    const state = { ...previous, ...result, tried_answers:tried };
    if (action === 'attempt') state.last_answer = {raw:answer};
    // Server flags remain the only source of correctness and completion.
    app.progress.set(id,state);
    renderQuestion();
    const feedback = q.grading_mode === 'mcq' ? $('answers').querySelector('.feedback') : [...$('answers').querySelectorAll('form')].find(f => f.dataset.part === part.key)?.querySelector('.feedback');
    if (feedback) showFeedback(feedback,state,result);
  } catch (error) { notice(error.message); }
  finally {
    app.busy = false; disabled.forEach(([node,value]) => { if (node.isConnected) node.disabled = value; });
    $('answers').removeAttribute('aria-busy');
  }
}
async function bootstrap() {
  $('retry').hidden = true; $('login').hidden = true;
  try {
    // Wait for the deferred, pinned SDK before initializing the platform session.
    if (document.readyState !== 'complete') await new Promise(resolve => window.addEventListener('load',resolve,{once:true}));
    if (!window.supabase?.createClient) throw new Error('تعذر تحميل مكتبة الاتصال. تحقق من الإنترنت ثم أعد المحاولة.');
    if (!app.sb) {
      app.sb = window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
      app.sb.auth.onAuthStateChange((event,session) => {
        if (event === 'SIGNED_OUT' || (app.userId && session?.user?.id && session.user.id !== app.userId)) {
          lockPage('تغيّرت جلسة الدخول. ارجع إلى المنصة ثم افتح الورشة مجددًا.');
        }
      });
    }
    const {data,error} = await app.sb.auth.getSession();
    if (error) throw new Error('تعذر التحقق من جلسة الدخول. أعد المحاولة.');
    if (!data.session) { location.replace('student.html'); return; }
    const ping = await api('ping');
    if (!['student','admin'].includes(ping.role)) throw new Error('تعذر التحقق من صلاحية الحساب.');
    app.userId = data.session.user.id; app.role = ping.role;
    const response = await fetch(DATA_ROOT+'questions_public.json');
    if (!response.ok) throw new Error('تعذر تحميل ملف الأسئلة. أعد المحاولة.');
    app.questions = validatePublic(await response.json());
    readNavigation(); app.authorized = true;
    $('gate').hidden = true; $('welcome').hidden = false; notice();
  } catch (error) { $('gate-message').textContent = error.message; $('retry').hidden = false; $('login').hidden = false; }
}
document.querySelectorAll('[data-track]').forEach(button => button.onclick = () => enterTrack(button.dataset.track));
$('retry').onclick = bootstrap;
$('back').onclick = () => { if (app.busy) return; $('workspace').hidden = true; $('welcome').hidden = false; document.body.classList.remove('projector'); $('projector').setAttribute('aria-pressed','false'); $('projector').textContent='وضع العرض'; notice(); };
$('skill').onchange = () => {
  if (app.busy) { $('skill').value = app.filter; return; }
  const previous = app.navigation[app.track]?.bank;
  app.filter = $('skill').value;
  const arr = visible(); app.current = arr.some(q => q.bank_no === app.current) ? app.current : arr[0].bank_no;
  $('resume').hidden = !previous || previous === app.current;
  $('resume').onclick = () => { if (app.busy) return; app.filter='all'; $('skill').value='all'; $('resume').hidden=true; navigate(previous); };
  saveNavigation(); renderQuestion();
};
$('previous').onclick = () => { const arr=visible(),i=arr.findIndex(q=>q.bank_no===app.current); if(i>0) navigate(arr[i-1].bank_no); };
$('next').onclick = () => { const arr=visible(),i=arr.findIndex(q=>q.bank_no===app.current); if(i<arr.length-1) navigate(arr[i+1].bank_no); };
$('projector').onclick = () => { const enabled=document.body.classList.toggle('projector'); $('projector').setAttribute('aria-pressed',String(enabled)); $('projector').textContent=enabled?'إنهاء وضع العرض':'وضع العرض'; };
$('question-image').onerror = () => { $('question-image').hidden=true; $('image-error').hidden=false; };
$('retry-image').onclick = () => { $('question-image').hidden=false; $('image-error').hidden=true; $('question-image').src=imageURL(currentQuestion()); };
$('zoom').onclick = () => { $('large-image').src=imageURL(currentQuestion()); $('large-image').alt=$('question-image').alt; $('large-image').classList.remove('enlarged'); $('actual-size').setAttribute('aria-pressed','false'); $('image-dialog').showModal(); };
$('close-image').onclick = () => $('image-dialog').close();
$('actual-size').onclick = () => { const enabled=$('large-image').classList.toggle('enlarged'); $('actual-size').setAttribute('aria-pressed',String(enabled)); };
window.addEventListener('offline',()=>notice('انقطع الاتصال. انتظر عودته قبل إرسال إجابتك.'));
window.addEventListener('online',()=>notice('عاد الاتصال. يمكنك متابعة الحل.'));
// Refresh server progress after switching tabs; never overwrite an in-flight attempt.
document.addEventListener('visibilitychange',async()=>{
  if(document.hidden||!app.authorized||!app.track||app.busy||$('workspace').hidden)return;
  app.busy=true;
  try { await loadTrack(app.track); if(app.authorized) renderQuestion(); }
  catch(error){notice(error.message);} finally{app.busy=false;}
});
bootstrap();
