import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const root = new URL('../../', import.meta.url);
const manifestRaw = readFileSync(new URL('../../workshops/third-secondary-term-2-lesson-2-book-homework/public-content.json', import.meta.url));
const manifest = JSON.parse(manifestRaw.toString('utf8'));
const questions = manifest.questions;
const suffix = 'assets/workshops/ch2-l2-book-homework/';

test('complete lesson-two student content is exactly 95 multiple-choice and 20 essays', () => {
  assert.equal(manifest.workshop.slug, 'third-secondary-term-2-lesson-2-book-homework');
  assert.equal(manifest.workshop.status, 'draft');
  assert.equal(questions.length, 115);
  assert.equal(questions.filter(q=>q.response_kind==='mcq').length, 95);
  assert.equal(questions.filter(q=>q.response_kind==='essay_self_review').length, 20);
  assert.equal(questions.reduce((s,q)=>s+q.parts.length,0),139);
  assert.deepEqual(questions.map(q=>q.source_number),Array.from({length:115},(_,i)=>i+1));
  assert.equal(new Set(questions.map(q=>q.id)).size,115);
});

test('all 115 images are present, nonempty JPEGs, and match pinned SHA256 hashes', () => {
  const paths = new Set();
  for(const q of questions){
    assert.ok(q.image.startsWith(suffix));
    assert.ok(!paths.has(q.image),'reused source image '+q.image);
    paths.add(q.image);
    const path=resolve(new URL('../../', import.meta.url).pathname,q.image);
    assert.ok(existsSync(path),'missing '+path);
    assert.ok(statSync(path).size>20000,'unexpectedly small JPEG '+path);
    const bytes=readFileSync(path);
    assert.equal(bytes[0],0xff);
    assert.equal(bytes[1],0xd8);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),q.image_sha256,'image hash mismatch '+q.image);
  }
  assert.equal(paths.size,115);
});

test('public manifest never exposes any teacher-only answers or sensitive identifiers', () => {
  const text=manifestRaw.toString('utf8');
  for(const token of ['model_answer','answer_spec','display_answer','service_role','private-answer-keys','correct_option']){
    assert.ok(!text.includes(token),'private field in public manifest: '+token);
  }
  for(const q of questions)for(const part of q.parts){
    assert.ok(part.input_type==='text'||part.input_type==='mcq');
    if(part.input_type==='mcq')assert.deepEqual(part.options.map(o=>o.value),['أ','ب','ج','د']);
  }
});
