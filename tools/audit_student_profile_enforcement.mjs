import{readFile,readdir}from'node:fs/promises';import{resolve}from'node:path';
const root=resolve(process.cwd()),migration=await readFile(resolve(root,'supabase/migrations/20261028190000_student_identity_registration_v1.sql'),'utf8');
if(!/profile_enforcement_enabled boolean not null default false/.test(migration))throw Error('Profile enforcement must remain disabled by default.');
if(!/not profile_enforcement_enabled or/.test(migration))throw Error('Profile enforcement approval guard is missing.');
const publicFiles=(await readdir(root)).filter(name=>/\.html$/.test(name)&&/(student|workshop|exam|homework|mistakes)/i.test(name));
const functionDirs=await readdir(resolve(root,'supabase/functions'),{withFileTypes:true});
const functions=functionDirs.filter(entry=>entry.isDirectory()&&!entry.name.startsWith('_')).map(entry=>entry.name).sort();
console.log(`Profile-enforcement audit inventory: ${publicFiles.length} relevant public pages, ${functions.length} checked-in Edge Function directories.`);
console.log('Status: enforcement remains blocked pending route-by-route Staging tests and recovery of any deployed source absent from Git.');
