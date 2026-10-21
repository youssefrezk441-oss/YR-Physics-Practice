import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const files = execFileSync('git', ['ls-files', '*.html'], { encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter(Boolean);

let checked = 0;
const failures = [];
for (const file of files) {
  const html = readFileSync(file, 'utf8');
  const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)];
  for (let index = 0; index < scripts.length; index += 1) {
    const attributes = scripts[index][1];
    const source = scripts[index][2];
    if (/\bsrc\s*=/i.test(attributes) || !source.trim()) continue;
    const moduleScript = /\btype\s*=\s*["']module["']/i.test(attributes);
    const result = spawnSync(process.execPath, ['--check', `--input-type=${moduleScript ? 'module' : 'commonjs'}`], {
      input: source,
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    });
    checked += 1;
    if (result.status !== 0) failures.push(`${file} inline script ${index + 1}: ${result.stderr.trim()}`);
  }
}

if (failures.length) throw new Error(failures.join('\n\n'));
console.log(`Inline JavaScript syntax OK: ${checked} scripts in ${files.length} HTML pages.`);
