#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseCsv } from './import_workshop_package.mjs';

const QUESTION_NUMBERS = [...Array.from({ length: 34 }, (_, index) => index + 1), 81, 82, ...Array.from({ length: 10 }, (_, index) => index + 83)];
const MCQ_NUMBERS = new Set([...Array.from({ length: 34 }, (_, index) => index + 1), 81, 82]);
const OPTIONS = ['أ', 'ب', 'ج', 'د'].map((value) => ({ value, label: `الاختيار ${value}` }));
const MULTI_MCQ_LABELS = new Map([
  [5, ['المطلوب 1', 'المطلوب 2', 'المطلوب 3', 'المطلوب 4']],
  [9, ['ربع دورة', 'نصف دورة', 'ثلث دورة']],
  [13, ['1-أ', '1-ب', '2-أ', '2-ب']],
  [14, ['المطلوب 1', 'المطلوب 2']],
  [29, ['المطلوب 1', 'المطلوب 2']],
  [34, ['المطلوب 1', 'المطلوب 2']],
  [82, ['المسار 1', 'المسار 2']],
]);
const ESSAY_LABELS = new Map([
  [83, ['الحالة الدائرية', 'الحالة المربعة']],
  [84, ['المطلوب 1', 'المطلوب 2']],
  [85, ['قيمة z']],
  [86, ['الشكل 1 — النقطة a', 'الشكل 1 — النقطة b', 'الشكل 2 — النقطة a', 'الشكل 2 — النقطة b']],
  [87, ['الرسم والاتجاه']],
  [88, ['مقارنة كثافات الفيض']],
  [89, ['ميل منحنى B–I', 'ميل منحنى B–1/d']],
  [90, ['التغير عند غلق المفتاح']],
  [91, ['تحديد موضع النقطة k']],
  [92, ['اتجاه التيار']],
]);
const SKILLS = [
  { id: 'HW-MAG-001', name: 'الفيض المغناطيسي وعلاقته بكثافة المجال والمساحة', order: 1 },
  { id: 'HW-MAG-002', name: 'زاوية السطح والعمودي على الملف', order: 2 },
  { id: 'HW-MAG-003', name: 'تغير الفيض والدوران والمنحنيات', order: 3 },
  { id: 'HW-MAG-004', name: 'وحدات الكميات المغناطيسية والنفاذية', order: 4 },
  { id: 'HW-MAG-005', name: 'اتجاه المجال حول سلك مستقيم', order: 5 },
  { id: 'HW-MAG-006', name: 'مقدار كثافة الفيض حول سلك مستقيم', order: 6 },
  { id: 'HW-MAG-007', name: 'العلاقات البيانية B–I وB–1/d', order: 7 },
  { id: 'HW-MAG-008', name: 'الدوائر الكهربائية وتأثيرها في المجال', order: 8 },
];

const skillFor = (number) => {
  if ([4, 6, 7, 8, 13, 14, 83, 84, 85].includes(number)) return 'HW-MAG-002';
  if ([2, 5, 9, 10, 15].includes(number)) return 'HW-MAG-003';
  if ([16, 89].includes(number)) return 'HW-MAG-004';
  if ([17, 19, 20, 21, 22, 34, 86, 87, 91, 92].includes(number)) return 'HW-MAG-005';
  if ([18, 23, 24, 25, 26, 27, 28, 29, 30, 81, 82, 88].includes(number)) return 'HW-MAG-006';
  if ([31, 32].includes(number)) return 'HW-MAG-007';
  if ([33, 90].includes(number)) return 'HW-MAG-008';
  return 'HW-MAG-001';
};
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const normalize = (value) => String(value ?? '').normalize('NFKC').trim();
const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith('--') || !argv[index + 1]) throw new Error('Arguments must be --name value pairs.');
    args[argv[index].slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = argv[index + 1];
  }
  return args;
};
const splitIndependentAnswer = (value, count) => {
  const parts = normalize(value).split(/\s*؛\s*/).filter(Boolean);
  if (parts.length === count) return parts.map((part) => part.replace(/^\([^)]*\)\s*/, '').replace(/^[^:：]+[:：]\s*/, '').trim());
  return null;
};
function essayAnswers(number, value) {
  const answer = normalize(value);
  if (number === 86) {
    const match = answer.match(/^\(1\)\s*a\s*([^،]+)،\s*b\s*([^؛]+)؛\s*\(2\)\s*a\s*([^،]+)،\s*b\s*(.+)$/);
    if (!match) throw new Error('Could not parse the four reviewed demands for essay 86.');
    return match.slice(1).map(normalize);
  }
  const labels = ESSAY_LABELS.get(number) ?? ['الإجابة'];
  if (labels.length === 1) return [answer];
  const split = splitIndependentAnswer(answer, labels.length);
  if (!split) throw new Error(`Could not parse ${labels.length} reviewed essay answers for ${number}.`);
  return split;
}
function mcqAnswers(value) {
  const answer = normalize(value);
  if (!answer.includes(':')) {
    const match = answer.match(/[أبجد]/);
    return match ? [match[0]] : [];
  }
  return answer.split('|').map((part) => part.split(':').at(-1)?.trim().match(/[أبجد]/)?.[0]).filter(Boolean);
}
function assertJpeg(buffer, number) {
  if (buffer.length < 20_000 || buffer[0] !== 0xff || buffer[1] !== 0xd8) throw new Error(`Question ${number} is not a valid high-resolution JPEG.`);
}

export function buildLecture1HomeworkPackage({ csvPath, pdfPath, publicPath, privatePath, assetsDir }) {
  const rows = parseCsv(readFileSync(csvPath, 'utf8'));
  const byNumber = new Map(rows.map((row) => [Number(row['رقم الصورة']), row]));
  if (rows.length !== 46 || QUESTION_NUMBERS.some((number) => !byNumber.has(number))) throw new Error('The reviewed CSV must contain exactly questions 1–34 and 81–92.');

  const temporary = mkdtempSync(join(tmpdir(), 'yr-l1-homework-'));
  try {
    execFileSync('pdfimages', ['-j', pdfPath, join(temporary, 'question')], { stdio: 'pipe' });
    const extracted = QUESTION_NUMBERS.map((_, index) => join(temporary, `question-${String(index).padStart(3, '0')}.jpg`));
    mkdirSync(assetsDir, { recursive: true });
    mkdirSync(resolve(publicPath, '..'), { recursive: true });
    mkdirSync(resolve(privatePath, '..'), { recursive: true });

    const questions = [];
    const keys = [];
    for (const [index, number] of QUESTION_NUMBERS.entries()) {
      const source = extracted[index];
      const image = readFileSync(source);
      assertJpeg(image, number);
      const fileName = `EXAM-L01-HW-Q${String(number).padStart(3, '0')}.jpg`;
      const target = join(assetsDir, fileName);
      copyFileSync(source, target);
      const relativeImage = `assets/workshops/ch2-l1-homework/${fileName}`;
      const row = byNumber.get(number);
      const isMcq = MCQ_NUMBERS.has(number);
      const labels = isMcq ? (MULTI_MCQ_LABELS.get(number) ?? ['الإجابة']) : (ESSAY_LABELS.get(number) ?? ['الإجابة']);
      const reviewedAnswers = isMcq ? mcqAnswers(row['الإجابة القديمة']) : essayAnswers(number, row['الإجابة المستقلة']);
      if (reviewedAnswers.length !== labels.length) throw new Error(`Question ${number}: expected ${labels.length} reviewed answers, got ${reviewedAnswers.length}.`);
      const questionRef = `EXAM-L01-HW-Q${String(number).padStart(3, '0')}`;
      questions.push({
        id: questionRef,
        track: 'home',
        order: index + 1,
        source_number: number,
        source_kind: 'original_bank_image',
        kind: 'image',
        response_kind: isMcq ? 'mcq' : 'essay_self_review',
        title: `سؤال ${number} — كتاب الامتحان`,
        prompt: null,
        image: relativeImage,
        image_sha256: sha256(image),
        skill: skillFor(number),
        skill_name: SKILLS.find((skill) => skill.id === skillFor(number)).name,
        difficulty: 'medium',
        parts: labels.map((label, partIndex) => ({
          key: labels.length === 1 ? 'main' : `part_${partIndex + 1}`,
          label,
          input_type: isMcq ? 'mcq' : 'text',
          options: isMcq ? OPTIONS : [],
          response_contract: isMcq ? 'paper_mcq_capture' : 'essay_text_or_image_self_review',
        })),
      });
      for (const [partIndex, displayAnswer] of reviewedAnswers.entries()) {
        keys.push({
          question_ref: questionRef,
          part_key: labels.length === 1 ? 'main' : `part_${partIndex + 1}`,
          answer_spec: isMcq ? { option: displayAnswer } : { review_mode: 'self_assessment', model_answer: displayAnswer },
          display_answer: displayAnswer,
          feedback_hint: null,
          explanation: normalize(row['الخطوات']),
          review_judgement: normalize(row['الحكم']),
          correction_note: normalize(row['ملاحظة']) || null,
        });
      }
    }

    const publicManifest = {
      schema_version: 1,
      delivery_contract: 'paper_homework_capture_v1',
      workshop: {
        slug: 'third-secondary-term-2-lecture-1-homework',
        title: 'واجب المحاضرة الأولى — الفصل الثاني',
        subtitle: 'الفيض والمجال المغناطيسي — كتاب الامتحان',
        grade_level: 'الصف الثالث الثانوي',
        academic_term: 'second',
        lecture_no: 1,
        status: 'draft',
      },
      tracks: [{ key: 'home', title: 'تسجيل إجابات الواجب الورقي', mode: 'final_submit', order: 1, policy: { allow_unanswered: true, one_submission: true, essay_self_review: true } }],
      skills: SKILLS,
      questions,
    };
    const publicJson = `${JSON.stringify(publicManifest, null, 2)}\n`;
    const privateImport = {
      schema_version: 1,
      workshop_slug: publicManifest.workshop.slug,
      delivery_contract: publicManifest.delivery_contract,
      public_content_sha256: sha256(publicJson),
      reviewed_source: basename(csvPath),
      keys,
    };
    const report = {
      ok: true,
      generated_at: new Date().toISOString(),
      question_count: questions.length,
      mcq_questions: questions.filter((question) => question.response_kind === 'mcq').length,
      essay_questions: questions.filter((question) => question.response_kind === 'essay_self_review').length,
      image_count: questions.filter((question) => question.image).length,
      part_count: questions.reduce((sum, question) => sum + question.parts.length, 0),
      private_key_count: keys.length,
      source_numbers: QUESTION_NUMBERS,
      independent_science_review: true,
      discrepancy_86_checked_against_original_image: true,
    };
    writeFileSync(publicPath, publicJson);
    writeFileSync(privatePath, `${JSON.stringify(privateImport, null, 2)}\n`, { mode: 0o600 });
    writeFileSync(resolve(publicPath, '..', 'validation-report.json'), `${JSON.stringify(report, null, 2)}\n`);
    return report;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (!args.csv || !args.pdf || !args.public || !args.private || !args.assets) throw new Error('Usage: --csv FILE --pdf FILE --public FILE --private FILE --assets DIR');
    if (!resolve(args.private).includes(`${resolve('.workshop-private')}/`)) throw new Error('Private answer data must be written below .workshop-private/.');
    const report = buildLecture1HomeworkPackage({ csvPath: resolve(args.csv), pdfPath: resolve(args.pdf), publicPath: resolve(args.public), privatePath: resolve(args.private), assetsDir: resolve(args.assets) });
    console.log(JSON.stringify(report));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
