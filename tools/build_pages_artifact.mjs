import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
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
  'azhar-comprehensive-exam.html',
]);
const excludedPrefixes = [
  'chemsteroo/',
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

console.log(`Pages artifact ready: ${copied} tracked files copied; paused student content excluded.`);
