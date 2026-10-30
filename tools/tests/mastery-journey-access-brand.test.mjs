import test from "node:test";
import assert from "node:assert/strict";
import {readFile,stat} from "node:fs/promises";
const root=new URL("../../",import.meta.url);
test("mastery brand uses genuine teacher portrait and readable responsive design",async()=>{
 const html=await readFile(new URL("student-register.html",root),"utf8");
 const css=await readFile(new URL("student-brand-studio-v2.css",root),"utf8");
 const photo=await readFile(new URL("assets/teacher-youssef-rezk.jpg",root));
 assert.equal(photo[0],0xff);assert.equal(photo[1],0xd8);
 assert.ok(photo.length>=4000&&photo.length<150000,"Web portrait must be optimized");
 assert.match(html,/class="photoStage"/);
 assert.match(html,/src="assets\/teacher-youssef-rezk.jpg"/);
 assert.match(html,/من الفهم إلى الإتقان/);
 for(const part of ["افهم","طبّق","تدرّب","أتقن"])assert.match(html,new RegExp(">"+part+"</span>"));
 assert.match(css,/@media\(max-width:730px\)/);
 assert.match(css,/\.photoStage img/);
 assert.match(css,/\.journeyHeroText\{margin:15px 0 4px 105px/);
 for(const required of ['id="loginTab"','id="registerTab"','id="form"','id="accessLoginForm"','id="turnstileWidget"'])assert.ok(html.includes(required));
});
