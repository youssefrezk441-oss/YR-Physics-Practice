import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { dirname, relative, resolve, sep } from 'node:path';

const root = resolve(process.cwd());
const output = resolve(process.argv[2] || '');

if (!process.argv[2]) throw new Error('Usage: node tools/build_pages_artifact.mjs <new-output-directory>');
if (output === root || !relative(root, output).split(sep).filter(Boolean).length) {
  throw new Error('Refusing to use the repository root as the Pages artifact directory.');
}
if (existsSync(output)) {
  if (readdirSync(output).length) throw new Error(`Output directory must be empty: ${output}`);
} else {
  mkdirSync(output, { recursive: true });
}

// Student access is paused, but the source, admin viewer and Supabase records stay intact.
const excluded = new Set([
  '.brand-version',
  'AGENTS.md',
  'README.md',
  'azhar-comprehensive-exam.html',
]);
const excludedPrefixes = [
  '.deploy',
  '.github/',
  '.grading/',
  'chemsteroo/',
  'supabase/',
  'tools/',
  'whatsapp-bridge/',
  'STUDENT_IDENTITY_',
  'WORKSHOP_',
];

const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

let copied = 0;
for (const file of files) {
  if (excluded.has(file) || excludedPrefixes.some((prefix) => file.startsWith(prefix))) continue;
  const source = resolve(root, file);
  const target = resolve(output, file);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  copied += 1;
}

if (existsSync(resolve(output, 'azhar-comprehensive-exam.html'))) {
  throw new Error('The paused Azhar student exam must not be present in the Pages artifact.');
}
if (!existsSync(resolve(output, 'azhar-exam-submissions-admin.html'))) {
  throw new Error('The Azhar admin submissions viewer must remain available.');
}
if (existsSync(resolve(output, 'chemsteroo'))) {
  throw new Error('The temporarily disabled Chemsteroo site must not be present in the Pages artifact.');
}
for (const internal of ['.github', '.grading', 'supabase', 'tools', 'whatsapp-bridge']) {
  if (existsSync(resolve(output, internal))) {
    throw new Error(`Internal source directory must not be present in the Pages artifact: ${internal}`);
  }
}
if (readdirSync(output).some((name) => name.startsWith('WORKSHOP_'))) {
  throw new Error('Internal workshop delivery documentation must not be present in the Pages artifact.');
}
if (readdirSync(output).some((name) => name.startsWith('STUDENT_IDENTITY_'))) {
  throw new Error('Internal student identity documentation must not be present in the Pages artifact.');
}

// Build the complete student dashboard at publish time instead of assembling it via
// a second HTTP fetch at login. Rendering uses an isolated mock document and never
// contacts Supabase or reads real student data.
const loaderSource = readFileSync(resolve(root, 'student.html'), 'utf8');
const studentBase = readFileSync(resolve(root, 'student-base.html'), 'utf8');
const loaderScript = loaderSource.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
if (!loaderScript) throw new Error('Student page loader is missing');
let renderedStudentHtml = '';
const mockBoot = { set outerHTML(value) { throw new Error('Student page rendering failed: ' + String(value)); } };
await runInNewContext(loaderScript, {
  fetch: async () => ({ text: async () => studentBase }),
  document: {
    open() { renderedStudentHtml = ''; },
    write(value) { renderedStudentHtml += String(value); },
    close() {},
    getElementById(id) { if (id !== 'boot') throw new Error('Unexpected boot lookup: ' + id); return mockBoot; },
  },
}, { timeout: 10000 });
if (!renderedStudentHtml.includes('id="dashboardView"') ||
    !renderedStudentHtml.includes('id="loginView" class="loginStage hidden"') ||
    renderedStudentHtml.includes('yrStudentBoot') ||
    renderedStudentHtml.includes('جاري فتح المنصة')) {
  throw new Error('Compiled student page does not satisfy the no-splash contract');
}
writeFileSync(resolve(output, 'student.html'), renderedStudentHtml, 'utf8');

console.log(`Pages artifact ready: ${copied} tracked files copied; paused student content excluded.; compiled student dashboard rendered directly.`);
