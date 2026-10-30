import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const root=new URL("../../",import.meta.url);
test("default admin URL and named admin homepage serve the same up-to-date dashboard",async()=>{
  const [index,admin]=await Promise.all([
    readFile(new URL("index.html",root),"utf8"),
    readFile(new URL("admin-home.html",root),"utf8")
  ]);
  assert.equal(index,admin,"Update both root index and admin-home together");
  assert.match(index,/id="registrationPriority"/);
  assert.match(index,/href="admin-student-registrations\.html"/);
  assert.match(index,/href="admin-ch1-workshop-analytics\.html"/);
  assert.match(index,/href="admin-ch2-analytics\.html"/);
  assert.doesNotMatch(index,/admin-l3-workshop-analytics\.html/);
  assert.doesNotMatch(index,/id="paperHomeworkAnalyticsCard"/);
});