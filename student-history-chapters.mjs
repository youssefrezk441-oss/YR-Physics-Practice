/* Read-only classification of practice attempts by curriculum chapter.
 * An unmatched legacy activity is UNKNOWN, never silently assigned by its title or date.
 * Only explicit server metadata or a verified course slug can establish chapter ownership.
 */
const VERIFIED_COURSES = new Map([
  ["third-secondary-electricity-chapter-1", "1"],
  ["foundation-physics", "foundation"]
]);
const CHAPTER_FIELDS = ["chapter_number", "chapter_index", "curriculum_chapter_number"];
const CHAPTER_ID_FIELDS = ["chapter_slug", "curriculum_chapter_slug"];
export function chapterFromMetadata(record) {
  if (!record || typeof record !== "object") return null;
  for (const key of CHAPTER_FIELDS) {
    if (record[key] == null) continue;
    const n = Number(record[key]);
    if (Number.isInteger(n) && n >= 1 && n <= 30) return String(n);
  }
  for (const key of CHAPTER_ID_FIELDS) {
    const slug = String(record[key] || "").trim().toLowerCase();
    const match = slug.match(/^(?:chapter|ch)[-_](\d{1,2})$/);
    if (match && Number(match[1]) > 0) return String(Number(match[1]));
  }
  const course = String(record.course_slug || "").trim().toLowerCase();
  if (VERIFIED_COURSES.has(course)) return VERIFIED_COURSES.get(course);
  // Future course naming convention must include the literal "chapter-N" suffix.
  // Generic grade-specific course names are not sufficient evidence of a chapter.
  const match = course.match(/(?:^|-)chapter-(\d{1,2})$/);
  return match && Number(match[1]) > 0 ? String(Number(match[1])) : null;
}
export function resolveAttemptChapter(attempt, sets = []) {
  const slug = String(attempt?.slug || "").trim();
  const linked = slug ? sets.find(x => String(x.slug || "") === slug) : null;
  const signals = [chapterFromMetadata(attempt), chapterFromMetadata(linked)].filter(Boolean);
  if (new Set(signals).size > 1) return "unknown"; // Never accept conflicting metadata.
  return signals[0] || "unknown";
}
export function splitHistoryByChapter(attempts = [], sets = []) {
  const groups = new Map();
  for (const attempt of attempts) {
    if (attempt?.status === "in_progress") continue;
    const key = resolveAttemptChapter(attempt, sets);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(attempt);
  }
  return groups;
}
export function historyChapterOptions(groups = new Map()) {
  const chapters = [...new Set(["1", "2", ...groups.keys()].filter(x => /^\d+$/.test(x)))]
    .sort((a, b) => Number(a) - Number(b));
  return [...chapters, ...(groups.has("foundation") ? ["foundation"] : []),
    ...(groups.has("unknown") ? ["unknown"] : []), "all"];
}
export function historyChapterLabel(key) {
  return key === "1" ? "الفصل الأول"
    : key === "2" ? "الفصل الثاني"
    : key === "foundation" ? "التأسيسي"
    : key === "unknown" ? "غير مصنف"
    : key === "all" ? "كل المحاولات"
    : "الفصل " + key;
}
