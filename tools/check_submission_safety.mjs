import { readFileSync } from 'node:fs';

const student = readFileSync('student-base.html', 'utf8');
const azhar = readFileSync('azhar-comprehensive-exam.html', 'utf8');
const azharFunction = readFileSync('supabase/functions/azhar-exam-public/index.ts', 'utf8');
const lecture3 = readFileSync('lecture3-workshop.html', 'utf8');

const checks = [
  [student.includes('submitInFlight') && student.includes('if(!attemptId||submitInFlight)return'), 'Student practice must block duplicate in-flight submissions.'],
  [lecture3.includes('expected_attempts_count:Number(before?.attempts_count||0)') && lecture3.includes('d.duplicate||d.stale'), 'The active Lecture 3 page must send and handle optimistic progress versions.'],
  [azhar.includes('saveChain=Promise.resolve()') && azhar.includes('saveChain=saveChain.catch(()=>{}).then'), 'The paused Azhar page must serialize same-tab saves.'],
  [azharFunction.includes('PUBLIC_EXAM_ENABLED') && azharFunction.includes('else if (!PUBLIC_EXAM_ENABLED)'), 'The Azhar backend source must remain paused by default.'],
];

const failures = checks.filter(([ok]) => !ok).map(([, message]) => message);
if (failures.length) throw new Error(failures.join('\n'));
console.log('Submission safety contracts OK: duplicate-submit guard, workshop versions, serialized legacy saves and Azhar pause checked.');
