import { readFileSync, readdirSync } from 'node:fs';

const read = path => readFileSync(path, 'utf8');
const functions = Object.fromEntries(['lecture3-workshop', 'lecture4-workshop', 'lecture6-workshop']
  .map(name => [name, read(`supabase/functions/${name}/index.ts`)]));
const azhar = read('supabase/functions/azhar-exam-public/index.ts');
const artifact = read('tools/build_pages_artifact.mjs');
const versioning = read('supabase/migrations/20261022090000_answer_key_versioning_foundation.sql');
const migrationText = readdirSync('supabase/migrations')
  .filter(name => name.endsWith('.sql'))
  .map(name => read(`supabase/migrations/${name}`))
  .join('\n');

const failures = [];
const requireContract = (condition, message) => { if (!condition) failures.push(message); };

for (const [name, source] of Object.entries(functions)) {
  requireContract(source.includes('auth.getUser('), `${name} must verify the bearer token on the server.`);
  requireContract(source.includes("a.role==='admin'") || source.includes('a.role === "admin"'), `${name} must keep admin workshop access read-only.`);
  requireContract(source.includes('pg_advisory_xact_lock'), `${name} must serialize attempts per student/question.`);
  requireContract(source.includes('readWorkshopJson(req)'), `${name} must enforce the shared request-size and JSON contract.`);
  requireContract(source.includes('expectedAttempts(body?.expected_attempts_count)'), `${name} must accept an optimistic progress version.`);
  requireContract(source.includes('isStaleProgress(expected, attempts)') || source.includes('isStaleProgress(expected,attempts)'), `${name} must reject stale-tab writes without counting an attempt.`);
  requireContract(!source.includes('body?.user_id') && !source.includes('body.user_id'), `${name} must never accept a target student ID from the browser.`);
}

requireContract(
  functions['lecture6-workshop'].includes("if(action==='reveal')") &&
    functions['lecture6-workshop'].includes('select bank_no,parts_schema from public.l6_workshop_questions where bank_no=${bankNo} and active=true'),
  'lecture6-workshop reveal must verify the active question and part before returning a key.',
);
requireContract(
  azhar.includes('PUBLIC_EXAM_ENABLED') && azhar.includes('else if (!PUBLIC_EXAM_ENABLED)'),
  'The paused Azhar Edge Function must deny all non-admin actions by default.',
);
requireContract(
  artifact.includes("'chemsteroo/'") && artifact.includes("'azhar-comprehensive-exam.html'"),
  'The Pages artifact must keep Chemsteroo and the Azhar student page paused.',
);
for (const internal of ["'.github/'", "'.grading/'", "'supabase/'", "'tools/'", "'whatsapp-bridge/'"]) {
  requireContract(artifact.includes(internal), `The Pages artifact must exclude internal source path ${internal}.`);
}

const publicCreates = [...migrationText.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z0-9_]+)/gi)]
  .map(match => match[1]);
for (const table of new Set(publicCreates)) {
  requireContract(
    new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`, 'i').test(migrationText),
    `Migration-created public table ${table} must enable RLS.`,
  );
}

for (const required of [
  'private.answer_key_versions',
  'private.answer_key_activations',
  'private.grading_decision_history',
  'private.regrade_impact_previews',
  'private.regrade_approvals',
  'private.regrade_execution_events',
  'private.reject_history_mutation',
  'revoke all on private.answer_key_versions from public, anon, authenticated',
]) {
  requireContract(versioning.includes(required), `Answer-key audit foundation is missing: ${required}.`);
}
requireContract(
  !/\b(update|delete\s+from|truncate)\s+(?:public|private)\./i.test(versioning),
  'The answer-key foundation migration must not modify or delete existing records.',
);

if (failures.length) throw new Error(failures.join('\n'));
console.log(`Supabase security contracts OK: ${Object.keys(functions).length} workshop functions and ${new Set(publicCreates).size} migration-created public tables checked.`);
