import test from 'node:test';import assert from 'node:assert/strict';
import{normalizeEgyptianPhone,normalizeStudentCode,parseEgyptianNationalId,validateFullName,validatePassword}from'../../supabase/functions/_shared/student-identity-core.ts';
test('normalizes Egyptian phones and Arabic digits',()=>{assert.equal(normalizeEgyptianPhone('٠١٠ ١٢٣٤ ٥٦٧٨'),'+201012345678');assert.equal(normalizeEgyptianPhone('+20 11-2345-6789'),'+201123456789')});
test('rejects unsupported or malformed phones',()=>assert.throws(()=>normalizeEgyptianPhone('01312345678'),/غير صحيح/));
test('normalizes legacy student codes without changing identity',()=>assert.equal(normalizeStudentCode(' n3-001 '),'N3-001'));
test('extracts a real birth date from an Egyptian national id',()=>assert.deepEqual(parseEgyptianNationalId('٣٠٥٠١٠١٠١٠١٠١٢',new Date('2026-01-01T00:00:00Z')),{id:'30501010101012',birthDate:'2005-01-01',last4:'1012'}));
test('rejects impossible national-id dates',()=>assert.throws(()=>parseEgyptianNationalId('30502310101012'),/تاريخ الميلاد/));
test('accepts compound Arabic four-part names',()=>assert.equal(validateFullName('عبد الرحمن محمد عبد الله علي'),'عبد الرحمن محمد عبد الله علي'));
test('password policy is optional to call but strong when called',()=>{assert.equal(validatePassword('Physics2026!'),'Physics2026!');assert.throws(()=>validatePassword('12345678'),/10 أحرف/)})
