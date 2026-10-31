import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const repositoryRoot = new URL('../../', import.meta.url);

async function renderStudentShell() {
  const loader = readFileSync(new URL('student.html', repositoryRoot), 'utf8');
  const base = readFileSync(new URL('student-base.html', repositoryRoot), 'utf8');
  const script = loader.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'student.html loader script was not found');

  let rendered = '';
  const boot = { outerHTML: '' };
  const context = {
    fetch: async () => ({ text: async () => base }),
    document: {
      open() {},
      write(value) { rendered += String(value); },
      close() {},
      getElementById(id) {
        assert.equal(id, 'boot');
        return boot;
      },
    },
  };

  await vm.runInNewContext(script, context);
  assert.equal(boot.outerHTML, '', 'student loader fell back to its error state');
  assert.ok(rendered.includes('<!doctype html>'), 'student shell was not rendered');
  return rendered;
}

test('groups third-secondary workshops under first- and second-term menus', async () => {
  const html = await renderStudentShell();
  const ids = [
    'openFirstTermWorkshops', 'openSecondTermWorkshops',
    'firstTermWorkshopsView', 'secondTermWorkshopsView',
    'firstTermWorkshopsGrid', 'secondTermWorkshopsGrid',
    'openLecture3Workshop', 'openLecture4Workshop',
    'openLecture5Workshop', 'openLecture6Workshop',
    'openChapterMistakes', 'openCh2Mistakes', 'openLecture1Homework', 'openUnifiedL1Workshop',
    'openReferences', 'openLesson1Review35',
  ];

  for (const id of ids) {
    assert.equal(html.split(`id="${id}"`).length - 1, 1, `${id} must appear exactly once`);
  }

  const firstMenu = html.indexOf('id="openFirstTermWorkshops"');
  const secondMenu = html.indexOf('id="openSecondTermWorkshops"');
  const firstGrid = html.indexOf('id="firstTermWorkshopsGrid"');
  const secondGrid = html.indexOf('id="secondTermWorkshopsGrid"');
  assert.ok(firstMenu < firstGrid && secondMenu < firstGrid, 'term cards must stay on the dashboard');

  for (const id of ['openChapterMistakes', 'openLecture3Workshop', 'openLecture4Workshop', 'openLecture5Workshop', 'openLecture6Workshop']) {
    const position = html.indexOf(`id="${id}"`);
    assert.ok(position > firstGrid && position < secondGrid, `${id} must be inside the first-term menu`);
  }
  for (const id of ['openCh2Mistakes', 'openLecture1Homework', 'openUnifiedL1Workshop']) {
    assert.ok(html.indexOf(`id="${id}"`) > secondGrid, `${id} must be inside the second-term menu`);
  }

  assert.match(html, /'firstTermWorkshopsView','secondTermWorkshopsView'/);
  assert.match(html, /showOnly\('firstTermWorkshopsView'\)/);
  assert.match(html, /showOnly\('secondTermWorkshopsView'\)/);
  assert.match(html, /secondTermWorkshopsButton\.classList\.add\('hidden'\)/);
  assert.match(html, /secondTermWorkshopsButton\.classList\.toggle\('hidden',!\(unifiedL1Allowed\|\|lecture1HomeworkAllowed\|\|ch2MistakesAllowed\|\|review35Allowed\)\)/);
  assert.match(html, /functions\.invoke\('paper-homework',\{body:\{action:'ping',workshop_slug:'third-secondary-term-2-lecture-1-homework'\}\}\)/);
  assert.match(html, /functions\.invoke\('student-ch2-mistakes',\{body:\{action:'ping'\}\}\)/);
  assert.match(html, /ch2MistakesAllowed=!error&&data\?\.ok&&data\?\.available/);
  assert.match(html, /third-secondary-term-2-lesson-1-review-35/);
});
