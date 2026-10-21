import { readFileSync } from 'node:fs';

const source = readFileSync('b2-lesson2-workshop.html', 'utf8');
const match = source.match(/const ALL=(\[.*?\]);\nconst STORE_KEY=/s);
if (!match) throw new Error('B2 lesson 2 question bank was not found.');

const questions = JSON.parse(match[1]);
const leaks = [];
for (const question of questions) {
  const accepted = String(question.accepted || '').trim();
  if (accepted) {
    const labelsOnly = String(question.grading || '').startsWith('AUTO-NUMERIC')
      && accepted.split(';').every((part) => /^[^=]+=$/.test(part.trim()));
    if (!labelsOnly) leaks.push(`${question.id}: accepted`);
  }
  if (String(question.tolerance || '').trim()) leaks.push(`${question.id}: tolerance`);
  for (const [index, group] of (question.choiceGroups || []).entries()) {
    if ((group.accepted || []).length) leaks.push(`${question.id}: choiceGroups[${index}].accepted`);
  }
}

if (leaks.length) throw new Error(`Client-visible B2 answer contracts found:\n${leaks.join('\n')}`);
console.log(`B2 public answer-key check OK: ${questions.length} question contracts contain labels only.`);
