import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const student = readFileSync(new URL("student.html", root), "utf8");
const navigation = readFileSync(new URL("student-workspace-navigation-v1.js", root), "utf8");
const workshop = readFileSync(new URL("workshop.js", root), "utf8");

test("review35 is injected into the existing student launcher with server eligibility", () => {
  assert.match(student, /openLesson1Review35/);
  assert.match(student, /review35Allowed=!error&&data\?\.ok/);
  assert.match(student, /third-secondary-term-2-lesson-1-review-35/);
});

test("chapter 2 workspace includes the review35 launcher's real DOM id", () => {
  assert.match(navigation, /"openUnifiedL1Workshop","openLecture1Homework","openLesson1Review35"/);
  assert.match(navigation, /\["openLesson1Review35","مراجعة الدرس الأول/);
  assert.match(navigation, /MutationObserver\(scheduledRefresh\)/);
});

test("review35 only exposes class track and old home deep links are rejected", () => {
  assert.match(workshop, /fallbackTracks=requestedSlug==='third-secondary-term-2-lesson-1-review-35'/);
  assert.match(workshop, /\[\{track_key:'class',title:'ورشة المراجعة',mode:'interactive'\}\]/);
  assert.match(workshop, /app\.tracks\.some\(track=>track\.track_key===initialTrack\)/);
  assert.doesNotMatch(workshop, /if\(\['class','home'\]\.includes\(deepTrack\|\|nav\.track\)\)/);
});

test("homework-only workshop only exposes its actual home track", () => {
  assert.match(workshop, /requestedSlug==='third-secondary-term-2-lecture-1-homework'/);
  assert.match(workshop, /\[\{track_key:'home',title:'تسجيل إجابات الواجب الورقي',mode:'final_submit'\}\]/);
});
