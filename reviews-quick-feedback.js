let lastAuto='';

function studentize(text){
  let t=String(text||'').trim();
  const rules=[
    [/^يحدد أن\s*/,'تحديد أن '],
    [/^يحدد\s*/,'تحديد '],
    [/^يحسب\s*/,'حساب '],
    [/^يستخدم\s*/,'استخدام '],
    [/^يعوّض\s*/,'التعويض '],
    [/^يعوض\s*/,'التعويض '],
    [/^يصل إلى\s*/,'الوصول إلى '],
    [/^يصل الي\s*/,'الوصول إلى '],
    [/^يفسر\s*/,'تفسير '],
    [/^يربط\s*/,'توضيح العلاقة: '],
    [/^يذكر\s*/,'ذكر '],
    [/^يستنتج\s*/,'استنتاج '],
    [/^يوضح\s*/,'توضيح '],
    [/^يعرض\s*/,'عرض '],
    [/^يختار\s*/,'اختيار '],
    [/^يدرك\s*/,'إدراك ']
  ];
  for(const [re,repl] of rules){if(re.test(t)){t=t.replace(re,repl);break}}
  return t.replace(/[.،؛]+$/,'');
}

function buildFeedback(){
  const rubric=document.getElementById('rubric');
  const feedback=document.getElementById('feedback');
  if(!rubric||!feedback)return;
  const rows=[...rubric.querySelectorAll('.criterion')];
  if(!rows.length){lastAuto='';return}
  const missing=rows.filter(row=>!row.querySelector('input[type="checkbox"]')?.checked)
    .map(row=>studentize(row.querySelector('.criterionText')?.textContent||''))
    .filter(Boolean);
  const next=missing.length?`ينقص إجابتك: ${missing.join('، ')}.`:'إجابة صحيحة ومكتملة.';
  const current=feedback.value.trim();
  if(current===''||current===lastAuto){feedback.value=next;lastAuto=next}
}

function hook(){
  const rubric=document.getElementById('rubric');
  if(!rubric||rubric.dataset.feedbackHooked==='1')return;
  rubric.dataset.feedbackHooked='1';
  rubric.addEventListener('change',e=>{
    if(e.target?.matches('input[type="checkbox"]'))setTimeout(buildFeedback,0);
  });
  new MutationObserver(()=>setTimeout(buildFeedback,0)).observe(rubric,{childList:true,subtree:true});
  ['allCriteria','clearCriteria'].forEach(id=>document.getElementById(id)?.addEventListener('click',()=>setTimeout(buildFeedback,0)));
  const feedback=document.getElementById('feedback');
  feedback?.addEventListener('input',()=>{
    if(feedback.value.trim()!==lastAuto)lastAuto='';
  });
  buildFeedback();
}

const timer=setInterval(()=>{
  hook();
  if(document.getElementById('rubric'))clearInterval(timer);
},120);
