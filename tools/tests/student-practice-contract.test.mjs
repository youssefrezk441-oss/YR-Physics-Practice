import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../../supabase/functions/student-practice/index.ts', import.meta.url), 'utf8')
  .replace(/^import .*;\n/gm, '');
const practice = stripTypeScriptTypes(source);
const user = '11111111-1111-4111-8111-111111111111';
const set = '22222222-2222-4222-8222-222222222222';
const attempt = '33333333-3333-4333-8333-333333333333';
const question = '44444444-4444-4444-8444-444444444444';

function mockPractice({ role = 'student', adminActive = true } = {}) {
  let handle;
  let count = 0;
  let response;
  const writes = [];
  const sql = async (parts, ...parameters) => {
    const query = parts.join('?').replace(/\s+/g, ' ');
    if (query.includes('public.admin_profiles')) return [{ is_active: adminActive }];
    if (query.includes('public.student_profiles')) return [{ is_active: true, grade_level: '3 ثانوي' }];
    if (query.includes('where ts.slug=')) return [{ id: set, grade_scope: [3], attempts_allowed: 1 }];
    if (query.includes('pg_advisory_xact_lock')) { writes.push('lock'); return []; }
    if (query.includes('count(*)::int as n from public.attempts')) { writes.push('count'); return [{ n: count }]; }
    if (query.includes('insert into public.attempts')) { count++; writes.push('attempt'); return [{ id: attempt }]; }
    if (query.includes('for update of a')) return [{ id: attempt, status: 'in_progress', training_set_id: set }];
    if (query.includes('join public.questions q')) return [{ id: question, type: 'numeric', points: 1, numeric_answer: 0 }];
    if (query.includes('insert into public.responses')) { response = { numeric: parameters[3], status: parameters[7] }; return []; }
    if (query.includes('update public.attempts')) return [{ id: attempt, score: parameters[1] }];
    throw new Error('Unexpected query ' + query);
  };
  let transaction = Promise.resolve();
  sql.begin = (work) => {
    const queued = transaction.then(() => work(sql));
    transaction = queued.catch(() => {});
    return queued;
  };
  runInNewContext(practice, {
    Deno: { env: { get: () => undefined }, serve(fn) { handle = fn; } },
    createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: user, app_metadata: { role } } } }) } }),
    postgres: () => sql, Request, Response, console,
  });
  return {
    writes,
    response: () => response,
    invoke: (body) => handle(new Request('http://localhost/', {
      method: 'POST', headers: { Authorization: 'Bearer synthetic' }, body: JSON.stringify(body),
    })),
  };
}

test('numeric training grades a real zero and stores an empty answer as unanswered', async () => {
  const { invoke, response } = mockPractice();
  const submit = async (value) => {
    const result = await invoke({ action: 'submit_attempt', attempt_id: attempt, answers: [{ question_id: question, numeric_value: value }] });
    assert.equal(result.status, 200);
    return (await result.json()).results[0];
  };
  assert.equal((await submit(null)).awarded_points, 0);
  assert.deepEqual(response(), { numeric: null, status: 'incorrect' });
  assert.equal((await submit(0)).awarded_points, 1);
  assert.deepEqual(response(), { numeric: 0, status: 'correct' });
});

test('inactive admins cannot preview legacy training and active admins still can', async () => {
  for (const adminActive of [false, true]) {
    const { invoke } = mockPractice({ role: 'admin', adminActive });
    assert.equal((await invoke({ action: 'ping' })).status, adminActive ? 200 : 401);
  }
});

test('two concurrent requests for a one-attempt training reserve one attempt', async () => {
  const { invoke, writes } = mockPractice();
  const start = () => invoke({ action: 'start', slug: 'synthetic' });
  const responses = await Promise.all([start(), start()]);
  assert.deepEqual(responses.map(result => result.status).sort(), [200, 403]);
  assert.deepEqual(writes, ['lock', 'count', 'attempt', 'lock', 'count']);
});
