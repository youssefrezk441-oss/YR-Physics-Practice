import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../../lesson2-book-homework.html', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../../lecture1-homework.js', import.meta.url), 'utf8');
const student = readFileSync(new URL('../../student.html', import.meta.url), 'utf8');
const slug = 'third-secondary-term-2-lesson-2-book-homework';

test('lesson two uses the existing authenticated paper homework contract', () => {
  assert.match(page, new RegExp('data-workshop-slug="'+slug+'"'));
  assert.match(page, /src="lecture1-homework\\.js/);
  assert.match(ui, /sb\\.functions\\.invoke\\('paper-homework'/);
  assert.match(page, /95/);
  assert.match(page, /20/);
});

test('all paper-homework UI elements exist in lesson-two wrapper', () => {
  const ids = [...ui.matchAll(/\\$\\('([a-z][a-z0-9]*)'\\)/gi)].map(m => m[1]);
  for (const id of new Set(ids)) assert.ok(page.includes('id="'+id+'"'), 'missing element: '+id);
});

test('chapter-two student launcher fails closed until server publishes the homework', () => {
  assert.match(student, /id=\\?"openLesson2BookHomework\\?"/);
  assert.match(student, /action:'ping',workshop_slug:'third-secondary-term-2-lesson-2-book-homework'/);
  assert.match(student, /lesson2BookAllowed=!error&&data\\?\\.ok&&data\\?\\.available===true/);
  assert.match(student, /lesson2BookAllowed=false;l2BookButton\\.classList\\.add\\('hidden'\\)/);
});

test('no teacher-only answer key is published in the HTML wrapper', () => {
  assert.doesNotMatch(page, /(?:private-answer-keys|answer_spec|model_answer|display_answer)/);
});
