import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const content = JSON.parse(readFileSync(new URL('workshops/third-secondary-term-2-lecture-1-homework/public-content.json', root), 'utf8'));

test('publishes exactly the reviewed 46-question structure without keys', () => {
  assert.equal(content.questions.length, 46);
  assert.equal(content.questions.filter(q => q.response_kind === 'mcq').length, 36);
  assert.equal(content.questions.filter(q => q.response_kind === 'essay_self_review').length, 10);
  assert.equal(content.questions.flatMap(q => q.parts).length, 64);
  assert.deepEqual(content.questions.map(q => q.source_number), [...Array.from({length:34},(_,i)=>i+1),81,82,...Array.from({length:10},(_,i)=>i+83)]);
  const serialized = JSON.stringify(content);
  for (const forbidden of ['answer_spec','display_answer','model_answer','explanation','الإجابة المستقلة']) assert.equal(serialized.includes(forbidden), false, `${forbidden} leaked into public content`);
});

test('every original image exists, is substantial and matches its reviewed hash', () => {
  for (const question of content.questions) {
    const url = new URL(question.image, root);
    assert.equal(existsSync(url), true, question.image);
    assert.ok(statSync(url).size > 20_000, `${question.image} is unexpectedly small`);
    assert.equal(createHash('sha256').update(readFileSync(url)).digest('hex'), question.image_sha256);
  }
});

test('private answer package stays ignored and validates the Q86 correction when present', () => {
  const privateUrl = new URL('.workshop-private/third-secondary-term-2-lecture-1-homework/private-import.json', root);
  if (!existsSync(privateUrl)) return;
  const privateData = JSON.parse(readFileSync(privateUrl, 'utf8'));
  const q86a2 = privateData.keys.find(key => key.question_ref === 'EXAM-L01-HW-Q086' && key.part_key === 'part_3');
  assert.ok(q86a2);
  assert.match(q86a2.display_answer, /يمين/);
  assert.doesNotMatch(q86a2.display_answer, /أعلى/);
});
