import test from 'node:test';import assert from 'node:assert/strict';
import{normalizeEgyptianPhone,normalizeStudentCode,parseEgyptianNationalId,validateFullName,validatePassword}from'../../supabase/functions/_shared/student-identity-core.ts';
test('normalizes every Egyptian mobile prefix and common international forms',()=>{for(const prefix of ['010','011','012','015'])assert.equal(normalizeEgyptianPhone(`${prefix}12345678`),`+20${prefix.slice(1)}12345678`);assert.equal(normalizeEgyptianPhone('+20 11-2345-6789'),'+201123456789');assert.equal(normalizeEgyptianPhone('00201012345678'),'+201012345678');assert.equal(normalizeEgyptianPhone('201012345678'),'+201012345678');assert.equal(normalizeEgyptianPhone('1012345678'),'+201012345678')});
test('normalizes Arabic and Persian digits',()=>{assert.equal(normalizeEgyptianPhone('٠١٠ ١٢٣٤ ٥٦٧٨'),'+201012345678');assert.equal(normalizeEgyptianPhone('۰۱۵ ۱۲۳۴ ۵۶۷۸'),'+201512345678')});
test('rejects unsupported or malformed phones',()=>assert.throws(()=>normalizeEgyptianPhone('01312345678'),/غير صحيح/));
test('normalizes legacy student codes without changing identity',()=>assert.equal(normalizeStudentCode(' n3-001 '),'N3-001'));
test('extracts a real birth date from an Egyptian national id',()=>assert.deepEqual(parseEgyptianNationalId('٣٠٥٠١٠١٠١٠١٠١٢',new Date('2026-01-01T00:00:00Z')),{id:'30501010101012',birthDate:'2005-01-01',last4:'1012'}));
test('rejects impossible national-id dates',()=>assert.throws(()=>parseEgyptianNationalId('30502310101012'),/تاريخ الميلاد/));
test('accepts compound Arabic four-part names',()=>assert.equal(validateFullName('عبد الرحمن محمد عبد الله علي'),'عبد الرحمن محمد عبد الله علي'));
test('password policy is optional to call but strong when called',()=>{assert.equal(validatePassword('Physics2026!'),'Physics2026!');assert.throws(()=>validatePassword('12345678'),/10 أحرف/)})
