#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LETTERS = ['أ', 'ب', 'ج', 'د'];
const FORBIDDEN_PUBLIC_KEYS = new Set([
  'correct', 'reason', 'hint', 'source_answer', 'source_answer_letter',
  'answer_spec', 'display_answer', 'explanation', 'accepted_forms', 'tolerance_abs',
]);

export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  const source = String(text).replace(/^\uFEFF/, '');
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') { row.push(field); field = ''; }
    else if (character === '\n') {
      row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = '';
    } else field += character;
  }
  if (quoted) throw new Error('Unclosed quoted CSV field.');
  if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  const [headers, ...records] = rows.filter((candidate) => candidate.some((value) => value !== ''));
  if (!headers?.length) return [];
  return records.map((values, rowIndex) => {
    if (values.length !== headers.length) throw new Error(`CSV row ${rowIndex + 2} has ${values.length} fields; expected ${headers.length}.`);
    return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
  });
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const readUtf8 = (path) => readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
const requiredText = (value, label) => {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`Missing ${label}.`);
  return text;
};
const difficulty = (value) => ({ 'سهل': 'easy', 'متوسط': 'medium', 'صعب': 'hard' })[String(value).trim()] ?? 'medium';
const trackKey = (value) => ({ 'الحصة': 'class', 'المنزلي': 'home' })[String(value).trim()];

function inspectForAnswerLeaks(value, path = '$', leaks = []) {
  if (Array.isArray(value)) value.forEach((item, index) => inspectForAnswerLeaks(item, `${path}[${index}]`, leaks));
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_PUBLIC_KEYS.has(key)) leaks.push(`${path}.${key}`);
      inspectForAnswerLeaks(child, `${path}.${key}`, leaks);
    }
  }
  return leaks;
}

export function validateWorkshopPackage(packageDirectory) {
  const root = resolve(packageDirectory);
  const paths = {
    inventory: resolve(root, '01_سجل_فرز_173_المحدث.csv'),
    teacherKeys: resolve(root, '02_مفتاح_المعلم_والحل_المستقل.csv'),
    coverage: resolve(root, '03_تغطية_أفكار_المحاضرة_الأولى.csv'),
    importJson: resolve(root, '04_بيانات_الورشة_للاستيراد_للمعلم.json'),
    quality: resolve(root, '05_تقرير_التنفيذ_والجودة.md'),
    images: resolve(root, 'الصور_الأصلية_المختارة'),
  };
  for (const [label, path] of Object.entries(paths)) {
    if (!existsSync(path)) throw new Error(`Missing package ${label}: ${path}`);
  }

  const data = JSON.parse(readUtf8(paths.importJson));
  const questions = Array.isArray(data.questions) ? data.questions : [];
  const inventory = parseCsv(readUtf8(paths.inventory));
  const teacherKeys = parseCsv(readUtf8(paths.teacherKeys));
  const coverage = parseCsv(readUtf8(paths.coverage));
  const issues = [];
  const warnings = [];
  const ids = new Set();
  const teacherById = new Map(teacherKeys.map((row) => [row['معرف السؤال'], row]));
  const inventoryById = new Map(inventory.map((row) => [row['معرف السؤال'], row]));
  const reserved = new Set(inventory
    .filter((row) => ['محجوز للامتحان النهائي المعدل', 'مستخدم بالمحاضرة المعتمدة'].includes(row['حالة نهائية بعد الامتحان الجديد']))
    .map((row) => row['معرف السؤال']));
  const sectionCounts = { class: 0, home: 0 };
  let imageCount = 0;
  let conceptCount = 0;

  for (const question of questions) {
    const id = requiredText(question.id, 'question id');
    if (ids.has(id)) issues.push(`${id}: duplicate question id.`);
    ids.add(id);
    const track = trackKey(question.section);
    if (!track) issues.push(`${id}: invalid section ${question.section}.`);
    else sectionCounts[track] += 1;
    if (!Number.isInteger(question.serial) || question.serial < 1) issues.push(`${id}: invalid section order.`);
    if (!/^MAG-\d{3}$/.test(String(question.skill))) issues.push(`${id}: invalid skill id.`);
    if (!LETTERS.includes(question.correct)) issues.push(`${id}: answer must be one of أ/ب/ج/د.`);
    if (reserved.has(id)) issues.push(`${id}: selected question is reserved by the inventory.`);

    if (question.kind === 'image') {
      imageCount += 1;
      const filename = requiredText(question.filename, `${id} image filename`);
      const imagePath = resolve(paths.images, filename);
      if (relative(paths.images, imagePath).startsWith('..') || isAbsolute(relative(paths.images, imagePath))) issues.push(`${id}: unsafe image path.`);
      else if (!existsSync(imagePath)) issues.push(`${id}: image file is missing.`);
      else if (sha256(readFileSync(imagePath)) !== question.sha256) issues.push(`${id}: image SHA256 does not match.`);
      const inventoryRow = inventoryById.get(id);
      if (!inventoryRow) issues.push(`${id}: image question is absent from the 173-question inventory.`);
      else if (inventoryRow['حالة نهائية بعد الامتحان الجديد'] !== 'مختار لورشة المحاضرة الأولى') {
        issues.push(`${id}: inventory state does not allow workshop use.`);
      }
    } else if (question.kind === 'concept') {
      conceptCount += 1;
      if (!question.options || typeof question.options !== 'object' || Array.isArray(question.options)) issues.push(`${id}: concept options are missing.`);
      else if (!Object.hasOwn(question.options, question.correct)) issues.push(`${id}: correct option is not present in concept options.`);
      if (question.filename || question.sha256) issues.push(`${id}: concept question unexpectedly references an image.`);
    } else issues.push(`${id}: unsupported question kind ${question.kind}.`);

    const teacher = teacherById.get(id);
    if (!teacher) issues.push(`${id}: teacher-key row is missing.`);
    else {
      if (teacher['الحرف الصحيح للمعلم'] !== question.correct) issues.push(`${id}: JSON and teacher CSV answers differ.`);
      if ((teacher['ملف الصورة'] || '') !== (question.filename || '')) issues.push(`${id}: JSON and teacher CSV image names differ.`);
      if ((teacher.SHA256 || '') !== (question.sha256 || '')) issues.push(`${id}: JSON and teacher CSV image hashes differ.`);
    }
  }

  if (questions.length !== 36) issues.push(`Expected 36 questions; found ${questions.length}.`);
  if (sectionCounts.class !== 18 || sectionCounts.home !== 18) issues.push(`Expected 18/18 tracks; found ${sectionCounts.class}/${sectionCounts.home}.`);
  if (imageCount !== 22 || conceptCount !== 14) issues.push(`Expected 22 images and 14 concepts; found ${imageCount}/${conceptCount}.`);
  if (teacherKeys.length !== questions.length) issues.push(`Teacher-key row count ${teacherKeys.length} differs from question count ${questions.length}.`);
  if (inventory.length !== 173) issues.push(`Inventory row count is ${inventory.length}, not 173.`);
  if (coverage.length !== 15) warnings.push(`Coverage file contains ${coverage.length} rows; expected 15 from the source report.`);
  if (readUtf8(paths.quality).includes('{len(imageq)}')) warnings.push('The source quality report contains an unresolved {len(imageq)} placeholder.');

  const skillNames = new Map();
  for (const question of questions) {
    const previous = skillNames.get(question.skill);
    if (previous && previous !== question.skillName) issues.push(`${question.skill}: inconsistent skill names.`);
    skillNames.set(question.skill, question.skillName);
  }

  const tracks = [
    { key: 'class', title: 'ورشة الحصة', mode: 'interactive', order: 1, policy: { max_unique_attempts: 2, reveal_after_attempts: 2, auto_reveal_mcq: true } },
    { key: 'home', title: 'التدريب المنزلي', mode: 'final_submit', order: 2, policy: { require_all_answers: true, allow_review_after_submit: true } },
  ];
  const publicQuestions = questions.map((question) => {
    const track = trackKey(question.section);
    const options = question.kind === 'concept'
      ? LETTERS.map((value) => ({ value, label: String(question.options[value] ?? '') }))
      : LETTERS.map((value) => ({ value, label: value }));
    return {
      id: question.id,
      track,
      order: question.serial,
      source_kind: question.kind === 'image' ? 'original_bank_image' : 'authored_concept',
      kind: question.kind,
      title: question.title,
      prompt: question.kind === 'concept' ? question.stem : null,
      image: question.kind === 'image' ? `assets/workshops/ch2-l1/${question.filename}` : null,
      image_sha256: question.kind === 'image' ? question.sha256 : null,
      skill: question.skill,
      skill_name: question.skillName,
      difficulty: difficulty(question.level),
      parts: [{ key: 'main', label: 'اختر الإجابة الصحيحة', input_type: 'mcq', options }],
    };
  });
  const publicManifest = {
    schema_version: 1,
    workshop: {
      slug: 'third-secondary-term-2-lecture-1',
      title: data.name,
      grade_level: 'الصف الثالث الثانوي',
      academic_term: 'second',
      lecture_no: 1,
      status: 'draft',
    },
    tracks,
    skills: [...skillNames].map(([id, name], index) => ({ id, name, order: index + 1 })),
    questions: publicQuestions,
  };
  const leaks = inspectForAnswerLeaks(publicManifest);
  if (leaks.length) issues.push(`Public output contains answer fields: ${leaks.join(', ')}`);

  const privateImport = {
    schema_version: 1,
    workshop_slug: publicManifest.workshop.slug,
    public_content_sha256: sha256(Buffer.from(JSON.stringify(publicManifest))),
    keys: questions.map((question) => ({
      question_ref: question.id,
      part_key: 'main',
      input_type: 'mcq',
      answer_spec: { option: question.correct },
      display_answer: question.correct,
      feedback_hint: question.hint,
      explanation: question.reason,
      source_answer: question.source_answer || null,
      source_answer_letter: question.source_answer_letter || null,
      correction_note: question.notes || null,
    })),
  };
  const report = {
    ok: issues.length === 0,
    package_directory: root,
    counts: { questions: questions.length, class: sectionCounts.class, home: sectionCounts.home, images: imageCount, concepts: conceptCount, skills: skillNames.size },
    source_counts: { inventory_rows: inventory.length, teacher_key_rows: teacherKeys.length, coverage_rows: coverage.length },
    corrected_source_keys: questions.filter((question) => question.source_answer_letter && question.source_answer_letter !== question.correct).map((question) => ({ id: question.id, source: question.source_answer_letter, reviewed: question.correct, note: question.notes })),
    issues,
    warnings,
  };
  return { publicManifest, privateImport, report };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) throw new Error(`Unexpected argument: ${argv[index]}`);
    const key = argv[index].slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    args[key] = argv[index + 1]; index += 1;
  }
  return args;
}

function writeJson(path, value, mode = 0o644) {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode });
}

function assertPrivateOutput(path, label) {
  const privatePath = resolve(path);
  const repositoryRoot = resolve(process.cwd());
  const relativePath = relative(repositoryRoot, privatePath);
  const insidePrivateDirectory = !relativePath.startsWith('..') &&
    (relativePath === '.workshop-private' || relativePath.startsWith('.workshop-private/'));
  if (!privatePath.startsWith('/tmp/') && !insidePrivateDirectory) {
    throw new Error(`${label} must be under /tmp or the repository .workshop-private directory.`);
  }
  return privatePath;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (!args.package) throw new Error('Usage: --package DIR [--public-output FILE] [--private-output FILE] [--report-output FILE]');
    const result = validateWorkshopPackage(args.package);
    if (args.reportOutput) writeJson(assertPrivateOutput(args.reportOutput, 'Validation report'), result.report, 0o600);
    if (!result.report.ok) throw new Error(`Package validation failed:\n${result.report.issues.join('\n')}`);
    if (args.publicOutput) writeJson(args.publicOutput, result.publicManifest);
    if (args.privateOutput) {
      const privatePath = assertPrivateOutput(args.privateOutput, 'Private answer output');
      writeJson(privatePath, result.privateImport, 0o600);
    }
    console.log(JSON.stringify(result.report, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
