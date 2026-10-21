import { readFileSync } from 'node:fs';

const l3 = readFileSync('supabase/functions/lecture3-workshop/index.ts', 'utf8');
const l4 = readFileSync('supabase/functions/lecture4-workshop/index.ts', 'utf8');
const l6 = readFileSync('supabase/functions/lecture6-workshop/index.ts', 'utf8');

const checks = [
  [l3.includes('!MCQ_OPTIONS.includes(normalized)'), 'Lecture 3 must reject answers outside its MCQ options.'],
  [l4.includes("mode==='mcq'&&!MCQ_OPTIONS.includes(String(normalized))"), 'Lecture 4 must reject answers outside its MCQ options.'],
  [l6.includes("const choices=[...safeArray(spec?.options)]") && l6.includes("const allowed=new Set([...choices,spec?.option]"), 'Lecture 6 must build the allowed choice set from the verified key.'],
  [l6.includes("mode==='mcq_letter'&&!choices.length") && l6.includes("choices.push('أ','ب','ج','د')"), 'Lecture 6 must preserve the standard MCQ options when a legacy key has no options array.'],
  [l6.includes("if(!allowed.has(String(normalized)))return j({error:'invalid_answer'"), 'Lecture 6 must reject answers outside the allowed choice set.'],
];

const failed = checks.filter(([ok]) => !ok).map(([, message]) => message);
if (failed.length) throw new Error(failed.join('\n'));
console.log('Workshop input guards OK for lectures 3, 4 and 6.');
