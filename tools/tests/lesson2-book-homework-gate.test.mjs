import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../../lesson2-book-homework.html', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../../lecture1-homework.js', import.meta.url), 'utf8');
const student = readFileSync(new URL('../../student.html', import.meta.url), 'utf8');
const slug = 'third-secondary-term-2-lesson-2-book-homework';

test('lesson two uses existing authenticated paper-homework page', () => {
  assert.ok(page.includes('data-workshop-slug="'+slug+'"'));
  assert.ok(page.includes('src="lecture1-homework.js'));
  assert.ok(ui.includes("sb.functions.invoke('paper-homework'"));
  assert.ok(page.includes('95'));
  assert.ok(page.includes('20'));
});

test('all shared paper-homework UI elements exist in lesson-two wrapper', () => {
  const ids = [...ui.matchAll(/\$\('([a-z][a-z0-9]*)'\)/gi)].map(m => m[1]);
  assert.ok(ids.length >= 20, 'could not derive shared UI requirements');
  for (const id of new Set(ids)) assert.ok(page.includes('id="'+id+'"'), 'missing element: '+id);
});

test('grade-three navigation card is visible without relying on ping while server guards access', () => {
  assert.ok(student.includes('openLesson2BookHomework'));
  assert.ok(student.includes("action:'ping',workshop_slug:'"+slug+"'"));
  assert.ok(student.includes("lesson2BookAllowed=gradeLabel(profile?.grade_level)==='الصف الثالث الثانوي'"));
  assert.ok(student.includes("l2BookButton.classList.toggle('hidden',!lesson2BookAllowed)"));
  assert.ok(student.includes("if(lesson2BookAllowed)sb.functions.invoke('paper-homework'"));
  assert.ok(!student.includes('lesson2BookAllowed=!error&&data?.ok&&data?.available===true'));
  assert.ok(!student.includes("lesson2BookAllowed=false;l2BookButton.classList.add('hidden')"));
});

test('no teacher-only keys leak into student-facing HTML', () => {
  for (const word of ['private-answer-keys', 'answer_spec', 'model_answer', 'display_answer']) {
    assert.ok(!page.includes(word), 'teacher-only data is exposed: '+word);
  }
});
