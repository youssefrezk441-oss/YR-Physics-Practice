import { readFileSync } from 'node:fs';

const leaks = [];
let checked = 0;
for (const filename of ['b2-lesson1-workshop.html', 'b2-lesson2-workshop.html']) {
  const source = readFileSync(filename, 'utf8');
  const match = source.match(/const ALL=(\[.*?\]);\nconst STORE_KEY=/s);
  if (!match) throw new Error(`B2 question bank was not found: ${filename}`);
  const questions = JSON.parse(match[1]);
  checked += questions.length;
  for (const question of questions) {
    const accepted = String(question.accepted || '').trim();
    if (accepted) {
      const labelsOnly = String(question.grading || '').startsWith('AUTO-NUMERIC')
        && accepted.split(';').every((part) => /^[^=]+=$/.test(part.trim()));
      if (!labelsOnly) leaks.push(`${filename} ${question.id}: accepted`);
    }
    if (String(question.tolerance || '').trim()) leaks.push(`${filename} ${question.id}: tolerance`);
    for (const [index, group] of (question.choiceGroups || []).entries()) {
      if ((group.accepted || []).length) leaks.push(`${filename} ${question.id}: choiceGroups[${index}].accepted`);
    }
  }
}

if (leaks.length) throw new Error(`Client-visible B2 answer contracts found:\n${leaks.join('\n')}`);
console.log(`B2 public answer-key check OK: ${checked} question contracts across both lessons contain labels only.`);
