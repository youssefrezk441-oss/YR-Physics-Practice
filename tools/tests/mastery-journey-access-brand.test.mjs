import test from "node:test";
import assert from "node:assert/strict";
import {readFile,stat} from "node:fs/promises";
const root=new URL("../../",import.meta.url);
test("mastery brand uses genuine teacher portrait and readable responsive design",async()=>{
 const html=await readFile(new URL("student-register.html",root),"utf8");
 const css=await readFile(new URL("student-brand-studio-v2.css",root),"utf8");
 const photo=await readFile(new URL("assets/teacher-youssef-selected-20261030.webp",root));
 assert.equal(photo.toString("ascii",0,4),"RIFF");assert.equal(photo.toString("ascii",8,12),"WEBP");
 assert.ok(photo.length>=4000&&photo.length<150000,"Web portrait must be optimized");
 assert.match(html,/class="photoStage yrPhotoEditorial"/);
 assert.match(html,/class="yrBrandLockup"/);
 const mark=await readFile(new URL("assets/yr-mastery-mark.svg",root),"utf8");
 assert.match(mark,/viewBox="0 0 72 72"/);
 assert.equal((mark.match(/<circle /g)||[]).length,4,"Concept C has four mastery-stage dots");
 assert.match(mark,/#D6A149/,"Mastery completion dot is gold");
 assert.doesNotMatch(mark,/↗|arrowTip/);
 assert.ok((html.match(/assets\/yr-mastery-mark\.svg/g)||[]).length>=2,"The approved identity appears in both headers");

 assert.doesNotMatch(html,/class="arrowTip"/);
 assert.match(html,/student-hero-editorial-v3\.css/);
 assert.match(html,/src="assets\/teacher-youssef-selected-20261030.webp"/);
 assert.match(html,/من الفهم إلى الإتقان/);
 for(const part of ["افهم","طبّق","تدرّب","أتقن"])assert.match(html,new RegExp(">"+part+"</span>"));
 assert.match(css,/@media\(max-width:730px\)/);
 assert.match(css,/\.photoStage img/);
 assert.match(css,/\.heroContent/);
 for(const required of ['id="loginTab"','id="registerTab"','id="form"','id="accessLoginForm"','id="turnstileWidget"'])assert.ok(html.includes(required));
});
