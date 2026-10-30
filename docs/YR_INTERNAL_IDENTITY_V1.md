# YR Physics Practice — Approved Internal Information Architecture

**Decision:** Approved by platform owner on 2026-10-30.
**North star:** رحلة منظّمة من الفهم إلى الإتقان.
**Status:** APPROVED INFORMATION ARCHITECTURE. Not an authorization to publish the existing draft visual implementation as-is.

## 1. Principle: stable destinations, scoped academic content

Avoid a flat board of mixed workshops or one large sidebar per curriculum chapter. The permanent primary navigation is **functional**; each functional area has a **curriculum-chapter scope** (الفصل الأول، الفصل الثاني، and future chapters dynamically). Never mix chapters by default within a student's training, errors, or honors.

The academic scope must also respect the student's **grade, educational track, active group, enrollment and relevant curriculum**, so a second-secondary student does not see unrelated third-secondary material. Only display real eligible content and actual recorded results.

## 2. Permanent primary navigation

| Destination | Purpose | Sub-pages / content |
|---|---|---|
| **مساحتي** | Personalized home | Next actual available action, recent activity, reliable chapter summaries, progress and indicators |
| **التعلّم** | Complete study and practice catalog | Chapter selector → lectures, workshops, class/homework, quizzes/exams, reviews, completed attempts |
| **مراجعتي** | Mistakes and skill-level remediation | Chapter selector → actual errors from workshops, homework and exams, and proven weak skills where supported |
| **الإنجازات** | Recognition and motivation | Chapter-specific honor boards, rising stars, special recognition, and archived prior rounds |
| **حسابي** | Account and preferences | Profile, group/code (code read-only), password, theme, sign out |

**Where are مؤشراتي?** A dedicated "أدائي وتقدّمي" detail screen under **مساحتي**. Show quiz scores, workshop attempts, attendance and evaluation cycles grouped by chapter/term where records support that split. No metric should be fabricated or inferred from unrelated data.

## 3. Hierarchy within each destination

### التعلّم
1. Select **الفصل الأول / الفصل الثاني / additional future chapter** (chapter labels come from eligible catalog/config; do not hardcode an upper bound of two).
2. Within selected chapter, show only available: **المحاضرات، ورش الحصة، التدريب المنزلي، الواجبات، الاختبارات، المراجعات، المحاولات المكتملة**.
3. Organize activities by **lecture**, then type, so L1/L2/L3 don't spill into an unordered list. Show clear status and resume action from actual student records.
4. A direct deep link carries grade/chapter/activity identity. Opening a direct workshop maintains the same enforced account/profile gate.

### مراجعتي
1. Select chapter first.
2. Show chapter-specific **errors**, **unmastered questions** and **skill insights** based only on real source data.
3. Separate workshop, homework and test mistakes where their sources are actually connected.
4. Show actionable review/retry routes; if a source or insight has not been implemented, state "غير متاح بعد" rather than inventing a count.

### الإنجازات
1. **لوحات الشرف** have an independent context by chapter **and edition/round**, not a single global mutable board.
2. Example: **الفصل الأول** (previous board / archive) vs **الفصل الثاني** (current edition). Both may coexist; never overwrite the historical view when creating the next board.
3. Other categories: **نجوم الصعود** and **تكريمات خاصة**, only when supported by real data.
4. Grade and track remain separate for fairness; preserve existing ranking rules until an explicit requirements change.

### مساحتي
Show actionable blocks rather than repeating the navigation tiles:
- **خطوتي التالية** from real eligible open work.
- **آخر نشاط** with source and chapter.
- **أدائي وتقدّمي** (chapter-aware if the data supports it).
- **مراجعة مقترحة** based on actual attempts, not generic invented recommendations.
- Useful school/admin notices only if there is real data.
Empty states must be dignified, clear and informative.

### حسابي
Provide the existing profile-completion/editing and password flows without bypassing any required administrative approval. Student code is immutable.

## 4. Responsive navigation

**Desktop / wide tablet:** persistent RTL sidebar on the **right**, compact/collapsible where space is tight. Main area is task-focused and may show local chapter tabs. Sidebar does not become a tree with every lecture.

**Mobile:** four-entry bottom navigation **مساحتي، التعلّم، مراجعتي، المزيد**. "المزيد" exposes الإنجازات، حسابي. During exam/workshop answering, hide the bottom navigation/sidebar and provide a dedicated **وضع التركيز** with a clear back path, question progress, accessible options and complete scientific diagrams.

## 5. Approved visual brand

- Approved `assets/yr-mastery-mark.svg` and YR Physics Practice wordmark.
- Palette: forest `#0E5948`, deep `#133D33`, paper `#F6F8F3`, white `#FFFFFF`, line `#DCE6DD`, gold `#D6A149` (mastery accent).
- Tajawal for Arabic UI; preserve proper mathematical direction and legible science typography.
- The four stages **افهم → طبّق → تدرّب → أتقن** represent the teaching method, NOT an invented personal proficiency indicator.
- Light and dark mode, 320/390/768/1440 px, no horizontal scroll, visible focus, keyboard/screen-reader navigation, reduced motion.
- Questions, circuit diagrams, choices, student answers and score semantics take precedence over decoration.

## 6. Architecture / migration requirements

- Audit the existing published student app, its compiled artifact (`student-base.html` → `student.html`), separate workshop links, mistakes screens, and honor board before implementing navigation.
- Separate **content metadata / category / chapter / lecture / grade / track** from visual UI. Support future chapters and new board editions without creating new top-level navigation entries.
- Preserve existing URLs or add compatibility redirects, existing element IDs and handlers, and direct workshop/deep-link functionality.
- Do not expose other students' data; leave Supabase Auth, admin approvals, registration, profile enforcement and RLS unchanged unless specifically required and tested.
- Keep honor calculations server-owned; never alter ranking or score formulas as part of visual restructuring.
- Wire chapter selection to actual available catalogs, no phantom activities or performance metrics.
- Test responsive navigation, browsing between chapters, chapter isolation, current vs archived boards, logout, profile completion, and all direct training links before publishing.

## 7. Work sequence / release gates

1. **Inventory and information map** of existing real pages/data sources and chapter mapping.
2. **Navigation + page shell prototype**, including desktop right sidebar and mobile bottom navigation, test in isolation.
3. Chapter-specific catalog for **التعلّم** and **مراجعتي**, followed by chapter-specific versioned **الإنجازات**.
4. Real personalized dashboard / performance data; then workshop focus mode.
5. Regression and visual tests, production publish only after completed review and approval.

### Relation to draft PR #43

PR #43 currently implements an earlier **three-card dashboard** concept. That layout was **superseded by this approved navigation architecture** and MUST NOT be merged as the final navigation. Its brand tokens, logo and typography are reusable, but sidebar, chapter-scoped navigation and content architecture need redesign first. Remain draft; no production deployment.

**Decision summary:** Fixed menu by functional purpose; chapter scoping inside each relevant destination; learning and mistakes are isolated by chapter; multiple historical/current honor boards coexist; mobile and exam layouts are purpose-built.
