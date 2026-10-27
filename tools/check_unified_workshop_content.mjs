import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const manifestPath = 'workshops/third-secondary-term-2-lecture-1/public-content.json';
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const failures = [];
const requireContract = (condition, message) => { if (!condition) failures.push(message); };
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const forbiddenKeys = new Set([
  'correct', 'reason', 'hint', 'source_answer', 'source_answer_letter',
  'answer_spec', 'display_answer', 'explanation', 'accepted_forms', 'tolerance_abs',
]);

function findLeaks(value, path = '$', leaks = []) {
  if (Array.isArray(value)) value.forEach((item, index) => findLeaks(item, `${path}[${index}]`, leaks));
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (forbiddenKeys.has(key)) leaks.push(`${path}.${key}`);
      findLeaks(child, `${path}.${key}`, leaks);
    }
  }
  return leaks;
}

requireContract(manifest.schema_version === 1, 'Unsupported public workshop schema version.');
requireContract(manifest.workshop?.slug === 'third-secondary-term-2-lecture-1', 'Unexpected workshop slug.');
requireContract(manifest.workshop?.status === 'draft', 'L1 must stay draft until staging approval.');
requireContract(Array.isArray(manifest.questions) && manifest.questions.length === 36, 'L1 must contain 36 questions.');
requireContract(manifest.questions.filter((question) => question.track === 'class').length === 18, 'L1 class track must contain 18 questions.');
requireContract(manifest.questions.filter((question) => question.track === 'home').length === 18, 'L1 home track must contain 18 questions.');
requireContract(manifest.questions.filter((question) => question.kind === 'image').length === 22, 'L1 must contain 22 original images.');
requireContract(manifest.questions.filter((question) => question.kind === 'concept').length === 14, 'L1 must contain 14 concept checks.');
requireContract(new Set(manifest.questions.map((question) => question.id)).size === 36, 'L1 question ids must be unique.');
requireContract(new Set(manifest.skills.map((skill) => skill.id)).size === 15, 'L1 must contain 15 unique skills.');

for (const question of manifest.questions) {
  requireContract(['class', 'home'].includes(question.track), `${question.id}: invalid track.`);
  requireContract(question.parts?.length >= 1, `${question.id}: missing question part.`);
  requireContract(question.parts?.every((part) => part.input_type === 'mcq' && part.options?.length === 4), `${question.id}: invalid public MCQ contract.`);
  if (question.kind === 'image') {
    requireContract(/^assets\/workshops\/ch2-l1\/BANK-L01-Q\d+\.png$/.test(question.image ?? ''), `${question.id}: unsafe image path.`);
    try { requireContract(sha256(question.image) === question.image_sha256, `${question.id}: image hash mismatch.`); }
    catch { failures.push(`${question.id}: image is missing.`); }
  } else {
    requireContract(question.image === null && question.image_sha256 === null, `${question.id}: concept must not reference an image.`);
    requireContract(typeof question.prompt === 'string' && question.prompt.trim().length > 0, `${question.id}: concept prompt is missing.`);
  }
}

const leaks = findLeaks(manifest);
requireContract(leaks.length === 0, `Public workshop answer fields found: ${leaks.join(', ')}`);

if (failures.length) throw new Error(failures.join('\n'));
console.log('Unified workshop content OK: 36 questions, 18/18 tracks, 22 verified images, 14 concepts, no answer keys.');
