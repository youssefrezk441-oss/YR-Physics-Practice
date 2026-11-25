import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../../supabase/migrations/20261125061700_beiny_beinak_private_inbox.sql',import.meta.url),'utf8');
const js=readFileSync(new URL('../../beiny-beinak.js',import.meta.url),'utf8');
test('private owner mapping and disabled by default',()=>{assert.match(sql,/enabled boolean not null default false/);assert.match(sql,/create table by_private\.owners/);assert.match(sql,/revoke all on all tables in schema by_private from public,anon,authenticated/);assert.match(sql,/alter table by_private\.owners enable row level security/);assert.match(sql,/identity_mode='hidden' and display_name is null/)});
test('RPC uses live role checks, explicit student ownership, and invoker wrapper',()=>{assert.match(sql,/uid uuid:=auth\.uid\(\)/);assert.match(sql,/o\.thread_id=th\.id and o\.user_id=uid/);assert.match(sql,/private\.student_account_reviews/);assert.match(sql,/public\.by_inbox[\s\S]+security invoker/);assert.match(sql,/BY_DISABLED/)});
test('message input, concurrency, read and reply state are separately enforced',()=>{assert.match(sql,/char_length\(body\) between 1 and 3000/);assert.match(sql,/pg_advisory_xact_lock/);assert.match(sql,/unique\(thread_id,sender_role,request_key\)/);assert.match(sql,/answered_student_seq=greatest\(answered_student_seq,context_value\)/);assert.match(sql,/teacher_read_seq=greatest\(teacher_read_seq,seq_value\)/)});
test('browser uses text nodes, no persistent private message cache',()=>{assert.match(js,/\.textContent=text/);assert.doesNotMatch(js,/\.innerHTML\s*=|localStorage|sessionStorage|console\./);assert.match(js,/crypto\.randomUUID/);assert.match(js,/pagehide/);assert.match(js,/SIGNED_OUT|onAuthStateChange/)});
