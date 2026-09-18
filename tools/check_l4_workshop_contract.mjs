import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataFile = join(root, 'assets/l4-workshop/questions/questions_public.json');
const questions = JSON.parse(readFileSync(dataFile, 'utf8'));
const errors = [];
const fail = message => errors.push(message);

if (!Array.isArray(questions) || questions.length !== 187) fail('Expected 187 questions.');
if (questions.filter(q => q.track === 'class').length !== 30) fail('Expected 30 class questions.');
if (questions.filter(q => q.track === 'home').length !== 157) fail('Expected 157 home questions.');

const banks = new Set();
const trackOrders = { class: new Set(), home: new Set() };
const supported = new Set(['mcq','numeric','multi_numeric','multi_qualitative','ratio','structured_text','symbolic']);

for (const q of questions) {
  if (banks.has(q.bank_no)) fail(`Duplicate bank number ${q.bank_no}.`);
  banks.add(q.bank_no);
  if (!supported.has(q.grading_mode)) fail(`Unsupported grading mode for ${q.bank_no}.`);
  if (!trackOrders[q.track]) fail(`Invalid track for ${q.bank_no}.`);
  else if (trackOrders[q.track].has(q.track_order)) fail(`Duplicate ${q.track} order ${q.track_order}.`);
  else trackOrders[q.track].add(q.track_order);
  if (q.answer_schema?.type !== q.grading_mode) fail(`Schema/mode mismatch for ${q.bank_no}.`);
  if (q.grading_mode !== 'mcq' && !q.answer_schema?.parts?.length) fail(`Missing answer parts for ${q.bank_no}.`);
  if (q.grading_mode === 'mcq' && JSON.stringify(q.answer_schema?.options) !== JSON.stringify(['أ','ب','ج','د'])) fail(`Invalid MCQ options for ${q.bank_no}.`);

  const image = join(dirname(dataFile), q.image.replace(/^images\//, ''));
  if (!existsSync(image)) { fail(`Missing image for ${q.bank_no}.`); continue; }
  const bytes = readFileSync(image);
  if (bytes.toString('ascii', 1, 4) !== 'PNG') { fail(`Invalid PNG for ${q.bank_no}.`); continue; }
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (width !== q.image_width || height !== q.image_height) fail(`Image dimensions mismatch for ${q.bank_no}.`);
  const sha = createHash('sha256').update(bytes).digest('hex');
  if (sha !== q.image_sha256) fail(`Image hash mismatch for ${q.bank_no}.`);
}

const critical = new Map([
  [311, ['symbolic', ['main']]],
  [381, ['multi_qualitative', ['main']]],
  [383, ['multi_qualitative', ['main']]],
  [384, ['symbolic', ['main']]],
  [392, ['multi_qualitative', ['A1','A2']]]
]);
for (const [bank, [mode, parts]] of critical) {
  const q = questions.find(item => item.bank_no === bank);
  if (!q || q.grading_mode !== mode || JSON.stringify(q.answer_schema.parts.map(p => p.key)) !== JSON.stringify(parts)) {
    fail(`Critical answer contract mismatch for ${bank}.`);
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('Lecture 4 contract OK: 187 questions, 187 images, tracks 30/157.');
